import { useState } from "react";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { log } from "@/shared/log";
import { Modal, Field, input, btnPrimary, btnGhost, checkRow } from "./ui";

/**
 * Shared team editor (docs/04 ARCH-2). The legacy Scoring.tsx and Teams.tsx each carried
 * their own add/edit-team dialog with duplicated fields and writes; this is the single
 * component both use. It edits a team's identity only — name, is_regular, logo — and
 * syncs the as-registered name (game_teams.display_name) into every non-completed game.
 *
 * SEC-1: contact name/email/PIN are NOT edited here. PINs are pin_hash only (never shown
 * or set in plaintext) and player-owned team contact data belongs to Registration v2
 * (Phase 2). Editing those is intentionally absent.
 */

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
}: {
  mode: "add" | "edit";
  initial?: EditableTeam | null;
  onClose: () => void;
  onSaved: (teamId: string) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [isRegular, setIsRegular] = useState(initial?.is_regular ?? false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(initial?.logo_url ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Team name is required.");
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
      setError(e instanceof Error ? e.message : "Failed to save team");
      setSaving(false);
    }
  };

  return (
    <Modal
      title={mode === "add" ? "ADD TEAM" : "EDIT TEAM"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} style={btnGhost}>CANCEL</button>
          <button type="button" onClick={save} disabled={saving || !name.trim()} style={btnPrimary}>
            {saving ? "SAVING…" : mode === "add" ? "CREATE" : "SAVE"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="TEAM NAME *">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Enter team name" style={input} autoFocus />
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

        {error && <div className="terminal-border" style={{ padding: 10, fontSize: 20 }}>⚠ {error}</div>}
      </div>
    </Modal>
  );
}
