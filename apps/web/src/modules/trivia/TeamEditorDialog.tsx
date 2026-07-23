import { useEffect, useRef, useState } from "react";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { log } from "@/shared/log";
import { Modal, Field, input, btnPrimary, btnGhost, btnDanger, checkRow } from "./ui";

/**
 * Normalized team-name key for duplicate detection (owner beat 2026-07-22 — the live
 * "Od-ussey" vs "Od - ussey" / "Scampus Oktober" vs "Scampus  Oktober" bug): lowercase +
 * strip EVERY non-alphanumeric char, so case, spacing, and punctuation differences all
 * collapse to the same key. "Od - ussey" → "odussey" === "Od-ussey" → "odussey".
 */
export function normalizeTeamName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type NamedTeam = { id: string; name: string };

/**
 * Shared team editor (docs/04 ARCH-2). The legacy Scoring.tsx and Teams.tsx each carried
 * their own add/edit-team dialog with duplicated fields and writes; this is the single
 * component both use. It edits a team's identity only — name, is_regular, logo — and
 * syncs the as-registered name (game_teams.display_name) into every non-completed game.
 *
 * SEC-1 (Phase 2, docs/05): the deferred fields land here the RIGHT way. The join PIN is
 * SET/RESET only — never displayed (pin_hash is locked out of every client read; the
 * legacy "show the PIN" behavior is dead). set_team_pin bcrypt-hashes server-side. The
 * roster is read via the staff-only team_roster RPC (staff can't join profiles under RLS).
 * Both are edit-mode only and best-effort (a team must exist first).
 */

interface RosterMember { profile_id: string; display_name: string | null; email: string | null; role: string; }
interface JoinRequest { id: string; profile_id: string; created_at: string; }

// Relative "when requested" phrasing for the pending-requests list (no seconds precision needed).
function relTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export interface EditableTeam {
  id: string;
  name: string;
  is_regular: boolean;
  logo_url: string | null;
}

// Games whose display_name should follow a rename (completed games keep their history).
const LIVE_STATUSES = ["setup", "active", "paused", "stopped"];

export function TeamEditorDialog({
  mode,
  initial,
  onClose,
  onSaved,
  onUseExisting,
}: {
  mode: "add" | "edit";
  initial?: EditableTeam | null;
  onClose: () => void;
  onSaved: (teamId: string) => void;
  /**
   * Add-mode duplicate guard (owner beat 2026-07-22): when the typed name NORMALIZES to an
   * existing ACTIVE venue team, the host is offered "USE EXISTING" instead of creating a
   * duplicate. The caller reuses its existing add-existing path (Scoring adds that team to
   * the current game). If omitted (e.g. the Teams roster, where the team already exists),
   * USE EXISTING just closes — no duplicate is created.
   */
  onUseExisting?: (team: NamedTeam) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [isRegular, setIsRegular] = useState(initial?.is_regular ?? false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(initial?.logo_url ?? null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // Add-mode duplicate confirm (owner beat 2026-07-22). Set when a submit normalizes to an
  // existing team; the confirm offers USE EXISTING (active match) / CREATE ANYWAY (archived-
  // only) / RENAME. null = no pending duplicate.
  const [dup, setDup] = useState<{ active: NamedTeam | null; archived: NamedTeam | null } | null>(null);

  // SEC-1 extras (edit mode only).
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [newPin, setNewPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  // Pending join requests for THIS team. RLS (0019 join_requests_select) returns rows only
  // to team members + venue staff (staff+), so a viewer who can't act sees an empty list and
  // the section never renders. approve_join_request enforces the same authority server-side.
  const [requests, setRequests] = useState<JoinRequest[] | null>(null);
  const [reqBusy, setReqBusy] = useState<string | null>(null);

  const teamId = initial?.id;
  useEffect(() => {
    if (mode !== "edit" || !teamId) return;
    let cancelled = false;
    (async () => {
      const [{ data: pinData }, { data: rosterData }, { data: reqData }] = await Promise.all([
        supabase.rpc("team_has_pin", { p_team_id: teamId }),
        supabase.rpc("team_roster", { p_team_id: teamId }),
        supabase.from("team_join_requests").select("id, profile_id, created_at").eq("team_id", teamId).eq("status", "pending"),
      ]);
      if (cancelled) return;
      setHasPin(pinData === true);
      setRoster((rosterData as RosterMember[] | null) ?? []);
      setRequests((reqData as JoinRequest[] | null) ?? []);
    })();
    return () => { cancelled = true; };
  }, [mode, teamId]);

  const approveRequest = async (requestId: string) => {
    if (!teamId) return;
    setReqBusy(requestId);
    setError(null);
    const { error: e } = await supabase.rpc("approve_join_request", { p_request_id: requestId });
    if (e) { setError(e.message); setReqBusy(null); return; }
    // Optimistic remove; the approved player is now a member, so refresh the roster too.
    setRequests((cur) => (cur ?? []).filter((r) => r.id !== requestId));
    const { data: rosterData } = await supabase.rpc("team_roster", { p_team_id: teamId });
    setRoster((rosterData as RosterMember[] | null) ?? []);
    setReqBusy(null);
    log("[TeamEditor] approved join request", requestId);
  };

  const setPin = async (clear: boolean) => {
    if (!teamId) return;
    if (!clear && !/^\d{4,6}$/.test(newPin)) { setPinMsg("PIN must be 4–6 digits."); return; }
    setPinBusy(true);
    setPinMsg(null);
    const { error: e } = await supabase.rpc("set_team_pin", { p_team_id: teamId, p_pin: clear ? null : newPin });
    setPinBusy(false);
    if (e) { setPinMsg(e.message); return; }
    setNewPin("");
    setHasPin(!clear);
    setPinMsg(clear ? "PIN removed." : "PIN set.");
  };

  const pickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setLogoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const uploadLogo = async (): Promise<string | null> => {
    if (!logoFile) return initial?.logo_url ?? null;
    const ext = logoFile.name.split(".").pop() || "png";
    const path = `team-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error: upErr } = await supabase.storage.from("logos").upload(path, logoFile, { cacheControl: "3600", upsert: false });
    if (upErr) throw upErr;
    return supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
  };

  /** Entry point from the CREATE/SAVE button. Add mode runs the normalized duplicate guard
   *  first; if it fires, the confirm handles the write (or bails). Edit mode saves directly. */
  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Team name is required.");
    setError(null);
    if (mode === "add") {
      // Duplicate guard — ONE venue read (id/name/archived), on submit only (never per
      // keystroke). ~269 rows for this venue; cheap. Normalized match, not exact — that's
      // the whole point (different strings, same crew).
      setChecking(true);
      const { data: existing, error: exErr } = await supabase
        .from("teams")
        .select("id, name, archived")
        .eq("venue_id", VENUE_ID);
      setChecking(false);
      if (exErr) return setError(exErr.message);
      const norm = normalizeTeamName(trimmed);
      const matches = ((existing ?? []) as { id: string; name: string; archived: boolean }[])
        .filter((t) => normalizeTeamName(t.name) === norm);
      const active = matches.find((t) => !t.archived) ?? null;
      const archived = matches.find((t) => t.archived) ?? null;
      if (active || archived) {
        setDup({ active: active ? { id: active.id, name: active.name } : null, archived: archived ? { id: archived.id, name: archived.name } : null });
        return;
      }
    }
    await doSave(trimmed);
  };

  /** The actual write (add insert / edit update). Add mode maps a still-colliding unique
   *  violation to a readable message instead of a raw DB error. */
  const doSave = async (trimmed: string) => {
    setSaving(true);
    setError(null);
    try {
      const logo_url = await uploadLogo();
      if (mode === "add") {
        const { data, error: insErr } = await supabase
          .from("teams")
          .insert({ venue_id: VENUE_ID, name: trimmed, is_regular: isRegular, logo_url })
          .select("id")
          .single();
        if (insErr) throw insErr;
        log("[TeamEditor] created team", data.id);
        onSaved(data.id as string);
      } else if (initial) {
        const { error: updErr } = await supabase.from("teams").update({ name: trimmed, is_regular: isRegular, logo_url }).eq("id", initial.id);
        if (updErr) throw updErr;
        // Follow the rename into live games' display_name (history stays put).
        const { data: live } = await supabase.from("games").select("id").eq("venue_id", VENUE_ID).in("status", LIVE_STATUSES);
        const ids = (live ?? []).map((g) => g.id);
        if (ids.length > 0) {
          await supabase.from("game_teams").update({ display_name: trimmed }).eq("team_id", initial.id).in("game_id", ids);
        }
        log("[TeamEditor] updated team", initial.id);
        onSaved(initial.id);
      }
    } catch (e) {
      // A genuine still-colliding EXACT insert (unique(venue_id,name)) reads better as a
      // plain sentence than a raw Postgres 23505 (owner beat 2026-07-22).
      const err = e as { code?: string; message?: string };
      if (mode === "add" && (err.code === "23505" || /duplicate key|already exists|unique constraint/i.test(err.message ?? ""))) {
        setError(`A team named "${trimmed}" already exists.`);
      } else {
        setError(e instanceof Error ? e.message : "Failed to save team");
      }
      setSaving(false);
    }
  };

  /** Confirm actions. */
  const useExisting = () => {
    const active = dup?.active;
    setDup(null);
    if (!active) return;
    if (onUseExisting) onUseExisting(active);
    else onClose(); // Teams roster (no game to add to): the team already exists, just close.
  };
  const createAnyway = () => {
    setDup(null);
    void doSave(name.trim());
  };
  const renameEdit = () => {
    setDup(null);
    // Return focus to the name field so the host can tweak it.
    setTimeout(() => nameRef.current?.focus(), 0);
  };

  return (
    <>
    <Modal
      title={mode === "add" ? "ADD TEAM" : "EDIT TEAM"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost}>CANCEL</button>
          <button type="button" onClick={save} disabled={saving || checking || !name.trim()} style={btnPrimary}>
            {saving ? "SAVING…" : checking ? "CHECKING…" : mode === "add" ? "CREATE" : "SAVE"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="TEAM NAME *">
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter team name" style={input} autoFocus />
        </Field>

        <label style={checkRow}>
          <input type="checkbox" checked={isRegular} onChange={(e) => setIsRegular(e.target.checked)} />
          <span>REGULAR TEAM (kept in the roster across weeks)</span>
        </label>

        <Field label="LOGO (OPTIONAL)">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {logoPreview ? (
              <img src={logoPreview} alt="Logo preview" style={{ width: 64, height: 64, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />
            ) : (
              <div style={{ width: 64, height: 64, border: "1px solid var(--terminal-green)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5, fontSize: 28 }}>◊</div>
            )}
            <input type="file" accept="image/*" onChange={pickLogo} style={{ ...input, fontSize: 18 }} />
          </div>
        </Field>

        {mode === "edit" && (
          <>
            <div className="terminal-separator" style={{ margin: "4px 0" }} />
            <Field label={`JOIN PIN  ·  ${hasPin === null ? "…" : hasPin ? "SET" : "NOT SET"}`}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="4–6 digits"
                  inputMode="numeric"
                  style={{ ...input, width: 140 }}
                />
                <button type="button" onClick={() => setPin(false)} disabled={pinBusy} style={btnPrimary}>
                  {hasPin ? "RESET PIN" : "SET PIN"}
                </button>
                {hasPin && (
                  <button type="button" onClick={() => setPin(true)} disabled={pinBusy} style={btnGhost}>REMOVE</button>
                )}
              </div>
              <div style={{ fontSize: 16, opacity: 0.6, marginTop: 6 }}>
                Teammates join with this PIN. It's never displayed — set a new one to rotate it.
              </div>
              {pinMsg && <div style={{ fontSize: 18, marginTop: 6 }}>{pinMsg}</div>}
            </Field>

            <Field label={`MEMBERS  ·  ${roster?.length ?? 0}`}>
              {roster == null ? (
                <div style={{ opacity: 0.6, fontSize: 18 }}>Loading…</div>
              ) : roster.length === 0 ? (
                <div style={{ opacity: 0.6, fontSize: 18 }}>No registered members yet (walk-up / paper team).</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {roster.map((m) => (
                    <div key={m.profile_id} style={{ fontSize: 18, display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>{m.display_name || m.email || m.profile_id.slice(0, 8)}</span>
                      <span style={{ opacity: 0.6 }}>{m.role === "captain" ? "★ CAPTAIN" : "member"}</span>
                    </div>
                  ))}
                </div>
              )}
            </Field>

            {requests && requests.length > 0 && (
              <Field label={`PENDING JOIN REQUESTS  ·  ${requests.length}`}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {requests.map((r) => (
                    <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      {/* The requester isn't a member yet, so profiles RLS blocks their name/email
                          (same limit the portal hits) — show a short id, never a wider surface. */}
                      <span style={{ fontSize: 18 }}>
                        player {r.profile_id.slice(0, 6)}
                        <span style={{ opacity: 0.6, marginLeft: 8 }}>{relTime(r.created_at)}</span>
                      </span>
                      <button type="button" onClick={() => approveRequest(r.id)} disabled={reqBusy === r.id} style={btnPrimary}>
                        {reqBusy === r.id ? "…" : "APPROVE"}
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 16, opacity: 0.6, marginTop: 6 }}>
                  Approving adds them to this team's roster.
                </div>
              </Field>
            )}
          </>
        )}

        {error && <div className="terminal-border" style={{ padding: 10, fontSize: 20 }}>⚠ {error}</div>}
      </div>
    </Modal>

    {/* Duplicate-name confirm (owner beat 2026-07-22). Rendered on top of the editor.
        Backdrop / ✕ = RENAME (return to editing), never a silent create. */}
    {dup && (
      <Modal
        title={dup.active ? "SIMILAR TEAM EXISTS" : "SIMILAR ARCHIVED TEAM"}
        onClose={renameEdit}
        footer={
          <>
            <button type="button" onClick={renameEdit} style={btnGhost}>RENAME / EDIT</button>
            {dup.active ? (
              <button type="button" onClick={useExisting} style={btnPrimary}>USE EXISTING</button>
            ) : (
              <button type="button" onClick={createAnyway} style={btnDanger}>CREATE ANYWAY</button>
            )}
          </>
        }
      >
        {dup.active ? (
          <p style={{ fontSize: 22, lineHeight: 1.35 }}>
            A team like <strong>“{name.trim()}”</strong> already exists: <strong>{dup.active.name}</strong>.
            {" "}Add that team to the game, or rename yours?
            {dup.archived && (
              <span style={{ display: "block", marginTop: 10, opacity: 0.7, fontSize: 18 }}>
                (There's also a similar <em>archived</em> team: “{dup.archived.name}”.)
              </span>
            )}
          </p>
        ) : (
          <p style={{ fontSize: 22, lineHeight: 1.35 }}>
            A similar <strong>archived</strong> team exists: <strong>{dup.archived?.name}</strong>. It won't be
            added automatically. Create a brand-new team anyway?
          </p>
        )}
      </Modal>
    )}
    </>
  );
}
