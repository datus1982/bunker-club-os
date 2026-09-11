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
 *
 * BEAT 6 (PR 1) — token pass, presentation only. The page root carries `data-st-page`
 * (the token sheet's opt-in hook); text rides the type-role + tier classes; the invite
 * panel is a surface-2 `st-panel`; cards/rows are surface-1. NOT in this PR: the
 * admin-row collapse to one "Full access — admin" line (C4) and the REMOVE danger
 * redesign (D1) — both are PR 3, so REMOVE stays exactly where and what it is (its
 * `u-amber` is re-declared to the calmed #E8B04B by the token sheet).
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
  // DECISION: whole-form invite errors show ONCE, as the field error (see below).
  // A whole-form problem (nothing typed, too many addresses, the edge fn refusing) comes
  // back as a synthetic `—` result row. Show it ONCE, as the field's error line, and keep
  // the results list for real per-address outcomes.
  const inviteError = invite.results?.find((r) => r.status === "error" && r.email === "—");
  const perAddressResults = invite.results?.filter((r) => r.email !== "—") ?? [];

  return (
    <div data-st-page="" style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
      <StaffPageHeader
        eyebrow="SYSTEM ▸ USERS"
        title="Users"
        tag={isLoading ? "LOADING…" : `${rows.length} STAFF`}
      />

      {notice && <InlineNotice kind="warn" message={notice} style={{ marginBottom: 16 }} />}

      {/* ── INVITE STAFF ─────────────────────────────────────────────────────── */}
      <form onSubmit={invite.onSubmit} className="st-panel" style={card}>
        <div className="st-heading st-t1" style={cardHead}>Invite staff</div>

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
          <button type="submit" disabled={invite.pending} className="st-btn st-btn-primary st-body" style={btnPrimary}>
            {invite.pending ? "Sending…" : "Send invite →"}
          </button>
          <span className="st-body st-t2" style={{ flex: "1 1 220px", minWidth: 0 }}>
            Creates the account if new, grants the modules above, and emails a one-click sign-in link.
            They appear below immediately.
          </span>
        </div>

        {perAddressResults.length > 0 && (
          <div style={{ marginTop: 14, borderTop: "1px solid", paddingTop: 12 }}>
            {perAddressResults.map((r, i) => (
              <div
                key={`${r.email}-${i}`}
                className={r.status === "error" ? "st-body st-danger" : "st-body st-t2"}
                style={{ marginBottom: 4 }}
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
        <div className="st-body st-t2">Loading staff…</div>
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

      <div className="st-body st-t2" style={{ marginTop: 18 }}>
        Admins implicitly hold every module (granted &amp; locked). Changes save instantly — no redeploy.
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
          {row.is_self && <span className="st-t2"> (you)</span>}
        </span>
      }
      sub={`ROLE: ${row.role.toUpperCase()}${row.is_self ? " · YOUR ACCOUNT" : ""}`}
      meta={
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
          <div className="st-label st-t2">ACCESS</div>
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
            <button type="button" className="u-amber st-btn st-body" style={removeBtn} onClick={() => onRemove(row)}>
              REMOVE
            </button>
          )}
        </div>
      }
    />
  );
}

/** The desktop grant matrix. Same columns as classic, on the shared checkbox primitive.
 *  DECISION: ToggleSwitch on the phone cards (state reads at arm's length), TapTargetCheckbox
 *  on this matrix + the invite chips (a captioned grid / a multi-select = checkbox semantics). */
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
    // DECISION: keep classic's `minWidth: 720`. Measured natural width of this table is
    // 1126px at a 1024 window / 1184px at 1280 (real data, 3 accounts) — the email column
    // is the long pole — so the pin is inert at desktop widths and only does work in the
    // 640–720 band, where it makes the container scroll instead of squeezing columns.
    // Dropping it would not have made the table fit 1024; it would only have removed a
    // guard. Either way the PAGE never scrolls sideways: the overflow is this box's.
    <div style={{ overflowX: "auto" }}>
      <table className="st-body st-t1" style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
        <thead>
          <tr>
            <th className="st-label st-t2" style={th}>EMAIL</th>
            <th className="st-label st-t2" style={th}>ROLE</th>
            {ALL_MODULES.map((m) => (
              // Module captions WRAP (the rest of the header row does not): "EVENTS &
              // PROMOS" on one line pushed the natural table width past a 1024px window.
              <th key={m} className="st-label st-t2" style={{ ...th, textAlign: "center", whiteSpace: "normal", maxWidth: 96 }}>
                {moduleLabel(m)}
              </th>
            ))}
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.profile_id}>
              <td style={td}>
                {row.email}
                {row.is_self && <span className="st-t2"> (you)</span>}
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
                  <button type="button" className="u-amber st-btn st-body" style={removeBtn} onClick={() => onRemove(row)}>
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

/* GEOMETRY ONLY from here down — surface, ink and text size come from the token
 * classes (`st-panel`, `st-btn`, `st-label`, `st-body`, `st-t*`). An inline colour
 * cannot beat `.terminal-theme * { color: green !important }`, and the sizes now live
 * once, in the type roles. */
const card: CSSProperties = {
  padding: "16px clamp(12px,3vw,20px)",
  marginBottom: 28,
};
const cardHead: CSSProperties = { marginBottom: 12 };
const btnPrimary: CSSProperties = {
  minHeight: 44, padding: "0 18px", cursor: "pointer",
};
const removeBtn: CSSProperties = {
  minHeight: 44, padding: "0 14px", cursor: "pointer",
};
const th: CSSProperties = {
  textAlign: "left", padding: "8px 10px", borderBottom: "1px solid",
  whiteSpace: "nowrap",
};
const td: CSSProperties = {
  padding: "8px 10px", borderBottom: "1px solid", verticalAlign: "middle",
};
