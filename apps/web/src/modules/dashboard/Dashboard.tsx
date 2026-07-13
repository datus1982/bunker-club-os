import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { hasModule, roleAtLeast, useRole, type ModuleKey, type StaffRole } from "@/shared/useRole";
import { useIsMobile } from "@/shared/useIsMobile";
import {
  useSyncStatus, useTonight, useActiveSeason, useScreens, formatAge,
  type Freshness, type ScreenSlot,
} from "./useDashboard";
import { screenHealth, type ScreenHealth } from "@/modules/signage/useSignageAdmin";

/**
 * BUNKER UNIFIED OS home (Phase 4b — the admin shell). One staff-facing landing that
 * shows system state (docs/12 sync freshness, tonight's game, active season) and every
 * module the viewer's role may touch. Deferred from Phase 1 ("wire Dashboard as the host
 * landing page"); the docs/12 freshness panel finally gets a home here too.
 *
 * Gating (0024): module tiles render on an explicit has_module grant (admin implies
 * every module); admin-only surfaces (SEASONS, USERS) gate on rank. Role labels are
 * titles/clearance, not access — a host with only {trivia} sees trivia, not drinks.
 */

const MONO = "'VT323','Share Tech Mono',monospace";
const GREEN = "var(--terminal-green)";

// The global `.terminal-theme *` rule forces green with !important, so non-green
// freshness states are applied via u-* override classes (see terminal-theme.css).
const FRESH_CLASS: Record<Freshness, string> = {
  fresh: "", amber: "u-amber", red: "u-red", idle: "u-idle", never: "u-red",
};
const FRESH_LABEL: Record<Freshness, string> = {
  fresh: "● LIVE", amber: "▲ STALE", red: "■ DOWN", idle: "○ IDLE", never: "■ NO DATA",
};

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Dashboard() {
  const { role, modules } = useRole();
  const now = useClock();
  const sync = useSyncStatus();
  const tonight = useTonight();
  const season = useActiveSeason();
  const screens = useScreens();
  const narrow = useIsMobile();

  const clock = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const day = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();

  return (
    <div className="terminal-theme" style={{ minHeight: "100%", padding: "24px clamp(14px, 4vw, 48px)", fontFamily: MONO }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: narrow ? "flex-start" : "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: narrow ? 2 : 12 }}>
        <div>
          <div style={{ fontSize: 20, opacity: 0.6, letterSpacing: 3 }}>SHELTER AUTHORITY · CIVIL DEFENSE</div>
          <h1 style={{ fontSize: "clamp(34px, 6vw, 56px)", fontWeight: 700, letterSpacing: 2, lineHeight: 1 }}>BUNKER UNIFIED OS</h1>
        </div>
        <div style={{ textAlign: narrow ? "left" : "right" }}>
          <div style={{ fontSize: "clamp(28px, 5vw, 44px)", fontWeight: 700, letterSpacing: 2, color: GREEN }}>{clock}</div>
          <div style={{ fontSize: 18, opacity: 0.7, letterSpacing: 2 }}>{day} · CLEARANCE {(role ?? "—").toUpperCase()}</div>
        </div>
      </header>
      <div className="terminal-separator" style={{ margin: "16px 0 24px" }} />

      {/* ── STATUS BOARD ─────────────────────────────────────────────── */}
      <SectionLabel>SYSTEM STATUS</SectionLabel>
      <div style={statusGrid}>
        {/* Toast sync freshness */}
        <StatusPanel title="TOAST SYNC">
          <FreshRow
            label="SALES"
            state={sync.data?.toastSync.state ?? "never"}
            age={formatAge(sync.data?.toastSync.ageMs ?? null)}
            note={sync.data && !sync.data.toastSync.inWindow ? "outside hours" : undefined}
          />
          <FreshRow
            label="MENU"
            state={sync.data?.menuSync.state ?? "never"}
            age={formatAge(sync.data?.menuSync.ageMs ?? null)}
          />
        </StatusPanel>

        {/* Tonight */}
        <StatusPanel title="TONIGHT">
          {tonight.isLoading ? (
            <Dim>checking…</Dim>
          ) : tonight.data ? (
            <>
              <div style={{ fontSize: 30, fontWeight: 700, color: GREEN, letterSpacing: 1 }}>
                {tonightLabel(tonight.data.status)}
              </div>
              <Dim>{tonight.data.team_count} TEAMS{tonight.data.is_playoff ? " · FINALS" : ""}</Dim>
              {hasModule(role, modules, "trivia") && (
                <Link to="/scoring" className="u-ink" style={jumpLink}>OPEN SCORING →</Link>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 26, opacity: 0.7 }}>NO GAME TODAY</div>
              {hasModule(role, modules, "trivia") && <Link to="/game/setup" className="u-ink" style={jumpLink}>CREATE GAME →</Link>}
            </>
          )}
        </StatusPanel>

        {/* Season */}
        <StatusPanel title="SEASON">
          {season.isLoading ? (
            <Dim>checking…</Dim>
          ) : season.data ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 700, color: GREEN, letterSpacing: 1 }}>{season.data.name}</div>
              <Dim>{season.data.days_remaining} DAYS LEFT</Dim>
              <ol style={{ listStyle: "none", padding: 0, margin: "6px 0 0", fontSize: 18 }}>
                {season.data.top3.map((t) => (
                  <li key={t.rank} style={{ display: "flex", justifyContent: "space-between", gap: 8, opacity: 0.9 }}>
                    <span>#{t.rank} {t.team_name}</span>
                    <span style={{ opacity: 0.7 }}>{t.score}</span>
                  </li>
                ))}
                {season.data.top3.length === 0 && <li style={{ opacity: 0.6 }}>no games scored yet</li>}
              </ol>
            </>
          ) : (
            <div style={{ fontSize: 24, opacity: 0.7 }}>NO ACTIVE SEASON</div>
          )}
        </StatusPanel>

        {/* Screens heartbeat — signage_slots.last_seen via screenHealth() (docs/09/12) */}
        <StatusPanel title="SCREENS">
          {screens.isLoading ? (
            <Dim>checking…</Dim>
          ) : screens.data && screens.data.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {screens.data.map((s) => (
                <div key={s.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 18, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{screenName(s)}</span>
                  <ScreenBadge health={screenHealth(s.last_seen)} />
                </div>
              ))}
            </div>
          ) : (
            <Dim>NO SCREENS PROVISIONED</Dim>
          )}
        </StatusPanel>
      </div>

      {/* ── MODULE GRID ──────────────────────────────────────────────── */}
      <SectionLabel style={{ marginTop: 32 }}>MODULES</SectionLabel>
      <div style={moduleGrid}>
        {TILES.filter((t) => (t.module ? hasModule(role, modules, t.module) : roleAtLeast(role, t.minRole ?? "staff"))).map((t) => (
          <ModuleTile key={t.label} tile={t} tonight={tonight.data} season={season.data} />
        ))}
        <DisplaysTile screens={screens.data ?? []} />
      </div>
    </div>
  );
}

// ── module tiles ─────────────────────────────────────────────────────────

interface Tile {
  label: string; to: string; desc: string;
  module?: ModuleKey;    // shown when the caller holds this grant (admin implied)
  minRole?: StaffRole;   // used for non-module-scoped tiles (admin-only surfaces)
  disabled?: string;     // phase note if not yet built
  hint?: "tonight" | "season";
}

const TILES: Tile[] = [
  { label: "TRIVIA CONTROL", to: "/scoring", desc: "Live scoring console — run the game", module: "trivia", hint: "tonight" },
  { label: "GAME SETUP", to: "/game/setup", desc: "Create a game, rounds & questions", module: "trivia" },
  { label: "TEAMS", to: "/teams", desc: "Regular-team roster & PINs", module: "trivia" },
  { label: "HISTORY", to: "/game/history", desc: "Past games & final boards", module: "trivia" },
  { label: "SEASONS", to: "/admin/seasons", desc: "Standings, playoffs & finals", minRole: "admin", hint: "season" },
  { label: "DRINKS BOARD", to: "/admin/drinks", desc: "Configure the top-drinks screen", module: "drinks" },
  { label: "USERS", to: "/admin/users", desc: "Staff accounts & module grants", minRole: "admin" },
  { label: "SIGNAGE", to: "/signage", desc: "Specials & event screens", module: "signage" },
  { label: "WEBSITE", to: "/", desc: "Public site content", module: "website", disabled: "Phase 3.5" },
];

function ModuleTile({ tile, tonight, season }: { tile: Tile; tonight: ReturnType<typeof useTonight>["data"]; season: ReturnType<typeof useActiveSeason>["data"] }) {
  const hint =
    tile.hint === "tonight"
      ? tonight ? tonightLabel(tonight.status) : "no game today"
      : tile.hint === "season"
      ? season ? season.name : "no active season"
      : undefined;

  const body = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>{tile.label}</span>
        {tile.disabled && <span className="u-amber" style={{ fontSize: 14, letterSpacing: 1 }}>{tile.disabled}</span>}
      </div>
      <div style={{ fontSize: 18, opacity: 0.7, marginTop: 4 }}>{tile.desc}</div>
      {hint && <div style={{ fontSize: 16, color: GREEN, opacity: 0.85, marginTop: 8, letterSpacing: 1 }}>▸ {hint}</div>}
    </>
  );

  if (tile.disabled) {
    return <div style={{ ...tileBase, opacity: 0.5, cursor: "default" }}>{body}</div>;
  }
  return (
    <Link to={tile.to} style={{ ...tileBase, textDecoration: "none", color: GREEN }} className="dash-tile">
      {body}
    </Link>
  );
}

/** DISPLAYS tile — the public screen URLs, opened in new tabs (kiosk targets). */
function DisplaysTile({ screens }: { screens: ScreenSlot[] }) {
  const links = [
    { label: "LEADERBOARD", href: "/leaderboard" },
    { label: "GAME DISPLAY", href: "/game-display" },
    { label: "DRINKS", href: "/drinks" },
    // Signage slot boards — clean kiosk URLs (no ?preview=1, so takeovers/game mode render).
    ...screens.map((s) => ({ label: s.name.toUpperCase(), href: `/signage/s/${s.slug}` })),
  ];
  return (
    <div style={{ ...tileBase, cursor: "default" }}>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1 }}>DISPLAYS</div>
      <div style={{ fontSize: 18, opacity: 0.7, marginTop: 4 }}>Public screen URLs — open on the TVs</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        {links.map((s) => (
          <a key={s.href} href={s.href} target="_blank" rel="noreferrer" style={screenLink}>{s.label} ↗</a>
        ))}
      </div>
    </div>
  );
}

/** Screen label for the STATUS BOARD: name, else TERMINAL n — location. */
function screenName(s: ScreenSlot): string {
  if (s.name) return s.name;
  const n = String(s.terminal_number ?? 0).padStart(2, "0");
  return `TERMINAL ${n}${s.location_label ? ` — ${s.location_label}` : ""}`;
}

function ScreenBadge({ health }: { health: ScreenHealth }) {
  const label = health === "online" ? "● ONLINE" : health === "stale" ? "◐ STALE" : "○ OFFLINE";
  const cls = health === "online" ? "" : health === "stale" ? "u-amber" : "u-red";
  return <span className={cls} style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap" }}>{label}</span>;
}

// ── small presentational bits ───────────────────────────────────────────

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ fontSize: 18, letterSpacing: 4, opacity: 0.6, marginBottom: 12, ...style }}>{children}</div>;
}
function Dim({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 18, opacity: 0.6, letterSpacing: 1 }}>{children}</div>;
}
function StatusPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="terminal-border" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 6, minHeight: 128 }}>
      <div style={{ fontSize: 16, letterSpacing: 3, opacity: 0.6 }}>{title}</div>
      {children}
    </div>
  );
}
function FreshRow({ label, state, age, note }: { label: string; state: Freshness; age: string; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 20 }}>{label}</span>
      <span style={{ textAlign: "right" }}>
        <span className={FRESH_CLASS[state]} style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>{FRESH_LABEL[state]}</span>
        <span style={{ fontSize: 16, opacity: 0.6, marginLeft: 8 }}>{note ?? age}</span>
      </span>
    </div>
  );
}

function tonightLabel(status: string): string {
  switch (status) {
    case "active": return "LIVE";
    case "paused": return "PAUSED";
    case "setup": return "IN SETUP";
    case "stopped": return "STOPPED";
    case "completed": return "COMPLETE";
    default: return status.toUpperCase();
  }
}

// ── styles ───────────────────────────────────────────────────────────────

const statusGrid: React.CSSProperties = {
  display: "grid", gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
};
const moduleGrid: React.CSSProperties = {
  display: "grid", gap: 12,
  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
};
const tileBase: React.CSSProperties = {
  display: "block", padding: 18, border: "1px solid var(--terminal-green)",
  background: "#000", color: GREEN, minHeight: 110,
};
const jumpLink: React.CSSProperties = {
  fontSize: 18, color: "#000", background: GREEN, fontWeight: 700,
  padding: "0 14px", minHeight: 44, display: "inline-flex", alignItems: "center",
  textDecoration: "none", marginTop: 8, alignSelf: "flex-start", letterSpacing: 1,
};
const screenLink: React.CSSProperties = {
  fontSize: 16, color: GREEN, border: "1px solid var(--terminal-green)",
  padding: "0 12px", minHeight: 44, display: "inline-flex", alignItems: "center",
  textDecoration: "none", letterSpacing: 1,
};
