import type { CSSProperties } from "react";
import type { ModuleKey, StaffRole } from "@/shared/useRole";
import { moduleLabel } from "@/shared/moduleLabels";
import {
  EmptyState,
  FormField,
  InlineNotice,
  ListRow,
  StaffPageHeader,
  TapTargetCheckbox,
  ToggleSwitch,
} from "@/shared/ui";
import { ALL_MODULES, STATUS_LABEL, type InviteResult, type InviteRole, type StaffRow } from "./usersShared";

/**
 * /admin/users, v2 presentation (UX overhaul Beat 2, owner decision C).
 *
 * PRESENTATION ONLY. Every mutation, guard and RPC argument lives in `Users.tsx` and
 * is handed down as a callback — this file must never call Supabase. The guards it
 * merely RENDERS are the ones the page (and the RPCs beneath it) already enforce:
 * admin ⇒ all modules on + locked, you cannot change your own role, you cannot remove
 * yourself.
 *
 * Phone (<640, the shared useIsMobile breakpoint): stacked ListRow cards — the 720px
 * table on a 390px screen was audit finding #1. Desktop: the table, which reads fine at
 * that width, rebuilt on the shared primitives (TapTargetCheckbox for the grant cells).
 *
 * DECISION: the cards show email + role and NOT a "never signed in" line — the audit
 * asked for one, but `admin_list_staff` (migration 0027) returns exactly
 * profile_id/email/role/modules/is_self. Surfacing last_sign_in_at needs an RPC change,
 * i.e. a migration, which Beat 2 is not allowed to make. Classic shows no such line
 * either, so nothing regressed; it is a candidate for a later beat.
 */
export function UsersV2({
  rows,
  isLoading,
  loadError,
  narrow,
  notice,
  onToggleModule,
  onChangeRole,
  onRemove,
  invite,
}: {
  rows: StaffRow[];
  isLoading: boolean;
  loadError: string | null;
  narrow: boolean;
  notice: string | null;
  onToggleModule: (row: StaffRow, key: ModuleKey) => void;
  onChangeRole: (row: StaffRow, role: StaffRole) => void;
  onRemove: (row: StaffRow) => void;
  invite: {
    emails: string;
    setEmails: (v: string) => void;
    role: InviteRole;
    setRole: (v: InviteRole) => void;
    modules: ModuleKey[];
    toggleModule: (key: ModuleKey) => void;
    results: InviteResult[] | null;
    pending: boolean;
    onSubmit: (e: React.FormEvent) => void;
  };
}) {
  const inviteError = invite.results?.find((r) => r.status === "error" && r.email === "—");

  return (
    <div style={{ padding: "20px clamp(14px, 4vw, 48px) 40px" }}>
      <StaffPageHeader
        eyebrow="SYSTEM ▸ USERS"
        title="USERS"
        tag={isLoading ? "LOADING…" : `${rows.length} STAFF`}
      />

      {notice && <InlineNotice kind="warn" message={notice} style={{ marginBottom: 16 }} />}

      {/* ── INVITE STAFF ─────────────────────────────────────────────────────── */}
      <form onSubmit={invite.onSubmit} style={card}>
        <div style={cardHead}>INVITE STAFF</div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
          <FormField
            label="EMAIL(S)"
            hint="One or more — separate with commas, spaces or new lines."
            error={inviteError ? inviteError.detail : undefined}
            style={{ flex: "1 1 260px" }}
          >
            <textarea
              value={invite.emails}
              onChange={(e) => invite.setEmails(e.target.value)}
              placeholder={"person@email.com\nanother@email.com"}
              rows={3}
              style={{ minHeight: 88 }}
            />
          </FormField>

          <FormField label="ROLE" style={{ flex: narrow ? "1 1 100%" : "0 0 180px" }}>
            <select value={invite.role} onChange={(e) => invite.setRole(e.target.value as InviteRole)}>
              <option value="staff">staff</option>
              <option value="host">host</option>
            </select>
          </FormField>
        </div>

        <FormField label="ACCESS (MODULES TO GRANT)" group style={{ marginTop: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {ALL_MODULES.map((m) => (
              <TapTargetCheckbox
                key={m}
                boxed
                checked={invite.modules.includes(m)}
                onChange={() => invite.toggleModule(m)}
                label={moduleLabel(m)}
              />
            ))}
          </div>
        </FormField>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 16 }}>
          <button type="submit" disabled={invite.pending} className="u-fill u-ink" style={btnPrimary}>
            {invite.pending ? "SENDING…" : "SEND INVITE →"}
          </button>
          <span style={{ fontSize: 15, opacity: 0.55, flex: "1 1 220px", minWidth: 0 }}>
            Creates the account if new, grants the modules above, and emails a one-click sign-in link.
            They appear below immediately.
          </span>
        </div>

        {invite.results && (
          <div style={{ marginTop: 14, borderTop: "1px solid rgba(0,255,65,0.25)", paddingTop: 12 }}>
            {invite.results.map((r, i) => (
              <div
                key={`${r.email}-${i}`}
                className={r.status === "error" ? "u-amber" : undefined}
                style={{ fontSize: 17, marginBottom: 4 }}
              >
                <b>{r.email}</b> — {STATUS_LABEL[r.status]}
                {r.detail && r.status === "error" ? `: ${r.detail}` : ""}
              </div>
            ))}
          </div>
        )}
      </form>

      {/* ── STAFF ────────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div style={{ fontSize: 20, opacity: 0.7 }}>LOADING STAFF…</div>
      ) : loadError ? (
        <InlineNotice kind="warn" message={`⚠ ${loadError}`} />
      ) : rows.length === 0 ? (
        <EmptyState eyebrow="NO STAFF" message="No staff accounts on this venue yet. Invite one above." />
      ) : narrow ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <StaffCard
              key={row.profile_id}
              row={row}
              onToggleModule={onToggleModule}
              onChangeRole={onChangeRole}
              onRemove={onRemove}
            />
          ))}
        </div>
      ) : (
        <StaffTable
          rows={rows}
          onToggleModule={onToggleModule}
          onChangeRole={onChangeRole}
          onRemove={onRemove}
        />
      )}

      <div style={{ fontSize: 15, opacity: 0.55, marginTop: 18 }}>
        Admins implicitly hold every module (shown ON &amp; locked). Changes save instantly — no redeploy.
      </div>
    </div>
  );
}

/** One staff account as a stacked card (phone). Owner decision C. */
function StaffCard({
  row,
  onToggleModule,
  onChangeRole,
  onRemove,
}: {
  row: StaffRow;
  onToggleModule: (row: StaffRow, key: ModuleKey) => void;
  onChangeRole: (row: StaffRow, role: StaffRole) => void;
  onRemove: (row: StaffRow) => void;
}) {
  const isAdmin = row.role === "admin";
  return (
    <ListRow
      stacked
      title={
        // overflowWrap, not ellipsis: a long address must WRAP inside a 390px card.
        <span style={{ display: "block", overflowWrap: "anywhere" }}>
          {row.email}
          {row.is_self && <span style={{ opacity: 0.6 }}> (you)</span>}
        </span>
      }
      sub={`ROLE: ${row.role.toUpperCase()}${row.is_self ? " · YOUR ACCOUNT" : ""}`}
      meta={
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
          <div style={{ fontSize: 14, letterSpacing: 2, opacity: 0.55 }}>ACCESS</div>
          {ALL_MODULES.map((m) => (
            <ToggleSwitch
              key={m}
              label={moduleLabel(m)}
              checked={isAdmin || row.modules.includes(m)}
              disabled={isAdmin}
              lockedHint="ADMIN"
              onChange={() => onToggleModule(row, m)}
              ariaLabel={`${m} for ${row.email}`}
            />
          ))}
        </div>
      }
      actions={
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", width: "100%", flexWrap: "wrap" }}>
          <FormField
            label="ROLE"
            hint={row.is_self ? "You cannot change your own role." : undefined}
            style={{ flex: "1 1 160px" }}
          >
            <select
              value={row.role}
              disabled={row.is_self}
              onChange={(e) => onChangeRole(row, e.target.value as StaffRole)}
              aria-label={`role for ${row.email}`}
            >
              <option value="staff">staff</option>
              <option value="host">host</option>
              <option value="admin">admin</option>
            </select>
          </FormField>
          {!row.is_self && (
            <button type="button" className="u-amber" style={removeBtn} onClick={() => onRemove(row)}>
              REMOVE
            </button>
          )}
        </div>
      }
    />
  );
}

/** The desktop grant matrix. Same columns as classic, on the shared checkbox primitive. */
function StaffTable({
  rows,
  onToggleModule,
  onChangeRole,
  onRemove,
}: {
  rows: StaffRow[];
  onToggleModule: (row: StaffRow, key: ModuleKey) => void;
  onChangeRole: (row: StaffRow, role: StaffRole) => void;
  onRemove: (row: StaffRow) => void;
}) {
  return (
    // DECISION: no minWidth here (classic pins 720px). v2 renders this table only at
    // ≥640px, and the columns measure ~700px at 1024 — the overflowX guard stays as the
    // honest fallback for the 640–700 band instead of forcing a scroll at every width.
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 18 }}>
        <thead>
          <tr>
            <th style={th}>EMAIL</th>
            <th style={th}>ROLE</th>
            {ALL_MODULES.map((m) => (
              <th key={m} style={{ ...th, textAlign: "center" }}>{moduleLabel(m)}</th>
            ))}
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.profile_id}>
              <td style={td}>
                {row.email}
                {row.is_self && <span style={{ opacity: 0.6 }}> (you)</span>}
              </td>
              <td style={td}>
                {/* No FormField here: a table column header IS the caption, so a second
                    visible label would just repeat it. The 44px floor is explicit. */}
                <select
                  value={row.role}
                  disabled={row.is_self}
                  onChange={(e) => onChangeRole(row, e.target.value as StaffRole)}
                  aria-label={`role for ${row.email}`}
                  style={{ minHeight: 44, padding: "8px 6px", minWidth: 110, cursor: row.is_self ? "not-allowed" : "pointer", opacity: row.is_self ? 0.45 : 1 }}
                >
                  <option value="staff">staff</option>
                  <option value="host">host</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              {ALL_MODULES.map((m) => (
                <td key={m} style={{ ...td, textAlign: "center", padding: "2px 4px" }}>
                  <TapTargetCheckbox
                    checked={row.role === "admin" || row.modules.includes(m)}
                    disabled={row.role === "admin"}
                    onChange={() => onToggleModule(row, m)}
                    ariaLabel={`${m} for ${row.email}`}
                  />
                </td>
              ))}
              <td style={{ ...td, textAlign: "right" }}>
                {!row.is_self && (
                  <button type="button" className="u-amber" style={removeBtn} onClick={() => onRemove(row)}>
                    REMOVE
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const card: CSSProperties = {
  border: "1px solid var(--terminal-green)",
  padding: "16px clamp(12px,3vw,20px)",
  marginBottom: 28,
  background: "rgba(0,255,65,0.03)",
};
const cardHead: CSSProperties = { fontSize: 20, letterSpacing: 2, marginBottom: 12 };
const btnPrimary: CSSProperties = {
  background: "var(--terminal-green)", color: "#000",
  border: "1px solid var(--terminal-green)",
  minHeight: 44, padding: "0 18px", fontWeight: 700, cursor: "pointer",
};
// No fontSize here: `.staff-ui button{font-size:1.25rem!important}` pins every staff
// button at 20px, so an inline size would lose silently (classic's 15px already does).
const removeBtn: CSSProperties = {
  background: "transparent", border: "1px solid var(--terminal-amber, #ffb000)",
  minHeight: 44, padding: "0 14px", cursor: "pointer",
};
const th: CSSProperties = {
  textAlign: "left", padding: "8px 10px", borderBottom: "1px solid var(--terminal-green)",
  fontSize: 15, letterSpacing: 1, opacity: 0.8, whiteSpace: "nowrap",
};
const td: CSSProperties = {
  padding: "8px 10px", borderBottom: "1px solid rgba(0,255,65,0.2)", verticalAlign: "middle",
};
