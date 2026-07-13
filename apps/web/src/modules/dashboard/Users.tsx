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
 * instantly (no redeploy) via admin_upsert_staff. Add-by-email requires the person to
 * have signed in once; a cold-email claimable invite is a follow-up (see CLAUDE.md).
 */

const MONO = "'VT323','Share Tech Mono',monospace";
const ALL_MODULES: ModuleKey[] = ["trivia", "seasons", "drinks", "signage", "website", "events"];

interface StaffRow { profile_id: string; email: string; role: StaffRole; modules: ModuleKey[]; is_self: boolean }

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
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("staff");
  const [notice, setNotice] = useState<string | null>(null);

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

  const addStaff = (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const clean = email.trim();
    if (!clean) return;
    upsert.mutate(
      { email: clean, role: newRole, modules: [] },
      { onSuccess: () => { setEmail(""); setNewRole("staff"); setNotice(`✓ ${clean} added as ${newRole}.`); invalidate(); } },
    );
  };

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "24px clamp(14px, 4vw, 48px)", fontFamily: MONO }}>
      <div style={{ fontSize: 20, opacity: 0.6, letterSpacing: 3 }}>BUNKER UNIFIED OS · ADMIN</div>
      <h1 style={{ fontSize: "clamp(30px,5vw,48px)", fontWeight: 700, letterSpacing: 2 }}>USERS &amp; MODULE GRANTS</h1>
      <div className="terminal-separator" style={{ margin: "14px 0 22px" }} />

      {notice && <div style={{ fontSize: 20, marginBottom: 16 }}>{notice}</div>}

      {/* Add staff */}
      <form onSubmit={addStaff} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 24 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 260px" }}>
          <span style={{ fontSize: 16, opacity: 0.7 }}>ADD STAFF BY EMAIL</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@email.com" required style={input} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 16, opacity: 0.7 }}>ROLE</span>
          <select value={newRole} onChange={(e) => setNewRole(e.target.value as StaffRole)} style={input}>
            <option value="staff">staff</option>
            <option value="host">host</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button type="submit" disabled={upsert.isPending} className="u-fill u-ink" style={btnPrimary}>ADD →</button>
      </form>
      <div style={{ fontSize: 15, opacity: 0.55, marginTop: -14, marginBottom: 24 }}>
        The person must have signed in once (email code) before they can be added. Grant modules with the checkboxes below.
      </div>

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
