import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import type { ModuleKey, StaffRole } from "@/shared/useRole";
import { moduleLabel } from "@/shared/moduleLabels";
import { useIsMobile } from "@/shared/useIsMobile";

/**
 * USERS (admin only) — staff accounts + module grants (Phase 4b, migration 0025).
 * Role labels are titles; ACCESS is the module checkboxes. Admin implies every module,
 * so an admin's checkboxes are shown ticked + disabled. Toggling a box grants/revokes
 * instantly (no redeploy) via admin_upsert_staff.
 *
 * INVITE STAFF (phase-staff-invites) uses the invite-staff edge fn — the cold-email path
 * that creates the account if it doesn't exist yet, grants role + modules, and emails a
 * themed one-click sign-in link. This replaced the old add-by-email quick form, which
 * required the person to have signed in once and couldn't grant modules in one step.
 * DECISION: the invite panel only mints 'staff'/'host' titles (never a cold admin by
 * email); to make someone an admin, invite them then flip their role in the table.
 */

const MONO = "'VT323','Share Tech Mono',monospace";
const ALL_MODULES: ModuleKey[] = ["trivia", "seasons", "drinks", "signage", "website", "events"];
type InviteRole = "staff" | "host";
type InviteStatus = "invited" | "already-staff" | "already-admin" | "error";
interface InviteResult { email: string; status: InviteStatus; detail?: string }

interface StaffRow { profile_id: string; email: string; role: StaffRole; modules: ModuleKey[]; is_self: boolean }

/** Split a free-text address list on commas / whitespace / semicolons / newlines. */
function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

const STATUS_LABEL: Record<InviteStatus, string> = {
  invited: "✓ invited — sign-in link emailed",
  "already-staff": "✓ already staff — grants updated, link emailed",
  "already-admin": "• already an admin — link emailed, grants left as-is",
  error: "⚠ error",
};

function useStaff() {
  return useQuery({
    queryKey: ["admin", "staff", VENUE_ID],
    queryFn: async (): Promise<StaffRow[]> => {
      const { data, error } = await supabase.rpc("admin_list_staff", { p_venue: VENUE_ID });
      if (error) throw error;
      return (data ?? []) as StaffRow[];
    },
  });
}

export function Users() {
  const qc = useQueryClient();
  const staff = useStaff();
  const narrow = useIsMobile();
  const [notice, setNotice] = useState<string | null>(null);

  // INVITE STAFF panel state.
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("staff");
  const [inviteModules, setInviteModules] = useState<ModuleKey[]>([]);
  const [inviteResults, setInviteResults] = useState<InviteResult[] | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin", "staff", VENUE_ID] });

  const upsert = useMutation({
    mutationFn: async (v: { email: string; role: StaffRole; modules: ModuleKey[] }) => {
      const { error } = await supabase.rpc("admin_upsert_staff", {
        p_venue: VENUE_ID, p_email: v.email, p_role: v.role, p_modules: v.modules,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: unknown) => setNotice(`⚠ ${(e as Error).message}`),
  });

  const remove = useMutation({
    mutationFn: async (profileId: string) => {
      const { error } = await supabase.rpc("admin_remove_staff", { p_venue: VENUE_ID, p_profile: profileId });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: unknown) => setNotice(`⚠ ${(e as Error).message}`),
  });

  const toggleModule = (row: StaffRow, key: ModuleKey) => {
    if (row.role === "admin") return; // admin implies all — nothing to toggle
    const next = row.modules.includes(key) ? row.modules.filter((m) => m !== key) : [...row.modules, key];
    upsert.mutate({ email: row.email, role: row.role, modules: next });
  };

  const changeRole = (row: StaffRow, role: StaffRole) =>
    upsert.mutate({ email: row.email, role, modules: row.modules });

  const invite = useMutation({
    mutationFn: async (v: { emails: string[]; role: InviteRole; modules: ModuleKey[] }) => {
      const { data, error } = await supabase.functions.invoke("invite-staff", { body: v });
      if (error) {
        let msg = error.message;
        try {
          const body = await (error as { context?: Response }).context?.json?.();
          if (body?.error) msg = body.error as string;
        } catch { /* ignore — fall back to error.message */ }
        throw new Error(msg);
      }
      return (data?.results ?? []) as InviteResult[];
    },
    onSuccess: (results) => {
      setInviteResults(results);
      if (results.some((r) => r.status !== "error")) {
        setInviteEmails("");
        invalidate();
      }
    },
    onError: (e: unknown) => setInviteResults([{ email: "—", status: "error", detail: (e as Error).message }]),
  });

  const toggleInviteModule = (key: ModuleKey) =>
    setInviteModules((cur) => (cur.includes(key) ? cur.filter((m) => m !== key) : [...cur, key]));

  const sendInvites = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setInviteResults(null);
    const emails = parseEmails(inviteEmails);
    if (emails.length === 0) { setInviteResults([{ email: "—", status: "error", detail: "Enter at least one email." }]); return; }
    if (emails.length > 20) { setInviteResults([{ email: "—", status: "error", detail: "Max 20 emails per invite." }]); return; }
    invite.mutate({ emails, role: inviteRole, modules: inviteModules });
  };

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "24px clamp(14px, 4vw, 48px)", fontFamily: MONO }}>
      <div style={{ fontSize: 20, opacity: 0.6, letterSpacing: 3 }}>BUNKER UNIFIED OS · ADMIN</div>
      <h1 style={{ fontSize: "clamp(30px,5vw,48px)", fontWeight: 700, letterSpacing: 2 }}>USERS &amp; MODULE GRANTS</h1>
      <div className="terminal-separator" style={{ margin: "14px 0 22px" }} />

      {notice && <div style={{ fontSize: 20, marginBottom: 16 }}>{notice}</div>}

      {/* INVITE STAFF — cold-email onboarding (invite-staff edge fn). */}
      <form onSubmit={sendInvites} style={inviteCard}>
        <div style={{ fontSize: 22, letterSpacing: 1, marginBottom: 12 }}>INVITE STAFF</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 260px", minWidth: 0 }}>
            <span style={{ fontSize: 16, opacity: 0.7 }}>EMAIL(S) — one or more, separated by commas, spaces, or new lines</span>
            <textarea
              value={inviteEmails}
              onChange={(e) => setInviteEmails(e.target.value)}
              placeholder={"person@email.com\nanother@email.com"}
              rows={3}
              style={{ ...input, width: "100%", resize: "vertical", minHeight: 88 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 16, opacity: 0.7 }}>ROLE</span>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as InviteRole)} style={{ ...input, minHeight: 44 }}>
              <option value="staff">staff</option>
              <option value="host">host</option>
            </select>
          </label>
        </div>

        <div style={{ fontSize: 16, opacity: 0.7, margin: "16px 0 6px" }}>ACCESS (modules to grant)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {ALL_MODULES.map((m) => {
            const on = inviteModules.includes(m);
            return (
              <label key={m} style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 12px", cursor: "pointer", border: "1px solid var(--terminal-green)", background: on ? "rgba(0,255,65,0.12)" : "transparent" }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggleInviteModule(m)}
                  aria-label={`grant ${m}`}
                  style={{ width: 20, height: 20, cursor: "pointer", accentColor: "var(--terminal-green)" }}
                />
                <span style={{ fontSize: 18 }}>{moduleLabel(m)}</span>
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 16 }}>
          <button type="submit" disabled={invite.isPending} className="u-fill u-ink" style={btnPrimary}>
            {invite.isPending ? "SENDING…" : "SEND INVITE →"}
          </button>
          <span style={{ fontSize: 15, opacity: 0.55, flex: "1 1 220px", minWidth: 0 }}>
            Creates the account if new, grants the modules above, and emails a one-click sign-in link. They appear below immediately.
          </span>
        </div>

        {inviteResults && (
          <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,255,65,0.25)", paddingTop: 12 }}>
            {inviteResults.map((r, i) => (
              <div key={`${r.email}-${i}`} className={r.status === "error" ? "u-amber" : undefined} style={{ fontSize: 17, marginBottom: 4 }}>
                <b>{r.email}</b> — {STATUS_LABEL[r.status]}{r.detail && r.status === "error" ? `: ${r.detail}` : ""}
              </div>
            ))}
          </div>
        )}
      </form>

      {/* Staff table */}
      {staff.isLoading ? (
        <div style={{ fontSize: 22 }}>LOADING STAFF…</div>
      ) : staff.isError ? (
        <div style={{ fontSize: 20 }}>⚠ {(staff.error as Error)?.message ?? "Unable to load staff."}</div>
      ) : (
        <>
        {narrow && <div className="u-scrollcue">◂ SCROLL TABLE ▸</div>}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720, fontSize: 18 }}>
            <thead>
              <tr>
                <th style={th}>EMAIL</th>
                <th style={th}>ROLE</th>
                {ALL_MODULES.map((m) => <th key={m} style={{ ...th, textAlign: "center" }}>{moduleLabel(m)}</th>)}
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {(staff.data ?? []).map((row) => (
                <tr key={row.profile_id}>
                  <td style={td}>{row.email}{row.is_self && <span style={{ opacity: 0.6 }}> (you)</span>}</td>
                  <td style={td}>
                    <select value={row.role} disabled={row.is_self} onChange={(e) => changeRole(row, e.target.value as StaffRole)} style={{ ...input, fontSize: 16, padding: "10px 6px", minHeight: 44 }}>
                      <option value="staff">staff</option>
                      <option value="host">host</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  {ALL_MODULES.map((m) => {
                    const on = row.role === "admin" || row.modules.includes(m);
                    return (
                      <td key={m} style={{ ...td, textAlign: "center", padding: "2px 4px" }}>
                        {/* Padded label so the effective tap target is ≥44px square (Phase 4c). */}
                        <label style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 44, padding: 10, cursor: row.role === "admin" ? "default" : "pointer" }}>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={row.role === "admin"}
                            onChange={() => toggleModule(row, m)}
                            aria-label={`${m} for ${row.email}`}
                            style={{ width: 20, height: 20, cursor: row.role === "admin" ? "default" : "pointer", accentColor: "var(--terminal-green)" }}
                          />
                        </label>
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: "right" }}>
                    {!row.is_self && (
                      <button type="button" className="u-amber" style={removeBtn} onClick={() => { if (confirm(`Remove ${row.email}?`)) remove.mutate(row.profile_id); }}>REMOVE</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
      <div style={{ fontSize: 15, opacity: 0.55, marginTop: 18 }}>
        Admins implicitly hold every module (checkboxes shown ticked &amp; locked). Changes save instantly — no redeploy.
      </div>
    </div>
  );
}

const inviteCard: React.CSSProperties = {
  border: "1px solid var(--terminal-green)", padding: "16px clamp(12px,3vw,20px)",
  marginBottom: 28, background: "rgba(0,255,65,0.03)",
};
const input: React.CSSProperties = {
  background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)",
  padding: "8px 10px", fontSize: 20, fontFamily: MONO,
};
const btnPrimary: React.CSSProperties = {
  background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)",
  padding: "9px 18px", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: MONO,
};
const removeBtn: React.CSSProperties = {
  background: "transparent", border: "1px solid var(--terminal-amber, #ffb000)",
  padding: "4px 10px", fontSize: 15, cursor: "pointer", fontFamily: MONO,
};
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--terminal-green)", fontSize: 15, letterSpacing: 1, opacity: 0.8, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid rgba(0,255,65,0.2)", verticalAlign: "middle" };
