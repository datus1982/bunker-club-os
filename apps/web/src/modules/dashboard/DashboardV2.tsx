import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { hasModule, type ModuleKey, type StaffRole } from "@/shared/useRole";
import { EmptyState, InlineNotice, StaffPageHeader, StatusChip, type StatusTone } from "@/shared/ui";
import { screenHealth, type ScreenHealth } from "@/modules/signage/useSignageAdmin";
import { useTriviaArmState } from "@/modules/signage/triviaArm";
import { formatAge, type Freshness, type ScreenSlot, type SeasonStatus, type SyncStatus, type TonightGame } from "./useDashboard";
import {
  TILES, homeAlerts, mediaTiles, prettyDayAndDate, screenName, seasonTimePhrase, tileVisible,
  tonightPhrase, type TileSection, type Tile,
} from "./dashboardShared";

/**
 * HOME (/dashboard), v2 presentation — UX overhaul Beat 6, PR 2 (letters C3 + E1,
 * audit §A1 + §C items 2/3/7).
 *
 * WHAT THE AUDIT ASKED FOR: the shipped HOME is ten identically-framed green boxes in
 * which nothing says "this one needs you". So the page now reads top to bottom as
 *   1. ALERTS — only when something is actually wrong, each linking to the fix
 *   2. TONIGHT — the one thing a manager opens this page to check
 *   3. STATUS — the ambient readouts (Toast, season, screens)
 *   4. LAUNCHER — module tiles, grouped by the v2 nav sections, pure links
 * and the module tiles no longer restate the status cards (C3): the Tonight card owns
 * "is there a game" because it owns the ACTION; the Trivia control tile is a launcher
 * with no "▸ no game today" line under it. Same for Seasons and the screen links.
 *
 * PRESENTATION ONLY, the Users/Drinks/Hub precedent: every status query lives in
 * `Dashboard.tsx` and arrives as props, and this file calls no Supabase. The single
 * exception is deliberate — `useTriviaArmState()`, a READ-ONLY hook, is called HERE
 * rather than in the page so a CLASSIC device fires no extra query for a strip it never
 * renders (RULE #1: classic changes in no way at all, network included). It is the same
 * function the Signage Hub's two arm notices call, so HOME and the hub cannot disagree
 * about whether trivia is on the screens (code note N8).
 *
 * DECISION — the DISPLAYS tile is folded into the SCREENS card. Classic has a SCREENS
 * status card (name + health) AND a DISPLAYS tile (name + kiosk link): two boxes
 * enumerating the same screens, which is the duplication §C3 names. Here each screen is
 * ONE row that is both — name, health, and the row itself opens the kiosk URL. The
 * de-emphasised legacy /drinks link keeps its place under it, so nothing is lost.
 *
 * COLOUR IS A CLASS, NEVER INLINE (`.terminal-theme *` forces green with !important);
 * SIZE IS INLINE unless the element carries a type role, because nothing inherits
 * font-size in this app (PR #89). Both are load-bearing throughout.
 */
export function DashboardV2({
  role,
  modules,
  now,
  narrow,
  sync,
  tonight,
  tonightLoading,
  season,
  seasonLoading,
  screens,
  screensLoading,
}: {
  role: StaffRole | null;
  modules: ModuleKey[];
  now: Date;
  narrow: boolean;
  sync: SyncStatus | undefined;
  tonight: TonightGame | null | undefined;
  tonightLoading: boolean;
  season: SeasonStatus | null | undefined;
  seasonLoading: boolean;
  screens: ScreenSlot[] | undefined;
  screensLoading: boolean;
}) {
  const canTrivia = hasModule(role, modules, "trivia");
  const canSignage = hasModule(role, modules, "signage");

  // The hub's own definition of "is trivia on the screens" (N8) — read-only.
  const arm = useTriviaArmState();
  const alerts = homeAlerts({ arm, sync, screens, canTrivia, canSignage });

  // A `setup` deck dated after tonight (the arm hook already read the game and resolved the
  // venue business day, so this is a phrase, not a query).
  const nextGameDate = arm.gameIsFuture && arm.liveGame?.status === "setup"
    ? prettyDayAndDate(arm.liveGame.game_date)
    : null;
  const nextGame = nextGameDate
    ? `Next game: ${nextGameDate} — set up, ${arm.armed ? "armed" : "not yet armed"}`
    : null;

  const clock = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const day = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  // The classic tile table, plus the MEDIA group the nav has and classic's table never
  // got (dashboardShared.mediaTiles — the nav's OWN gate, not a second copy of it).
  const tiles = [...TILES.filter((t) => tileVisible(role, modules, t)), ...mediaTiles(role, modules)];
  // Section order = the v2 nav's own order. A section with no visible tile renders nothing.
  const sections: TileSection[] = ["GAMES", "BAR OPS", "MEDIA", "SYSTEM"];

  return (
    <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
      {/* `data-st-page` sits on the CONTENT wrapper, not the page root — the WARN-3
          convention the Signage Hub and the MEDIA pages adopted in PR 1's fold. HOME
          opens no slide-over today, so nothing yet renders outside the scope; the shape
          is here so that when one arrives it can be dropped in below this div and keep
          the Beat 3 look instead of being repainted by the blanket. It also drives the
          CRT rule as designed: the shell root matches
          `.terminal-theme.staff-v2:has([data-st-page])`, so HOME v2 loses the scanlines
          and vignette while CLASSIC HOME — which renders no hook at all — keeps them. */}
      <div data-st-page="">
        <StaffPageHeader
          eyebrow="SHELTER AUTHORITY · CIVIL DEFENSE"
          title="Bunker Unified OS"
          right={
            <div style={{ textAlign: narrow ? "left" : "right" }}>
              {/* Not `st-mono`: that role is pinned at 14/15px with !important, and the
                  clock is the one piece of monospace data meant to be read across a bar. */}
              <div className="st-t1" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>
                {clock}
              </div>
              <div className="st-body st-t3">{day} · Clearance {role ?? "—"}</div>
            </div>
          }
        />

        {/* ── 1 · ALERTS ─────────────────────────────────────────────────────
            Nothing renders when nothing is wrong. No "all clear" bar: a banner that is
            always there is a banner nobody reads (audit §A1). */}
        {alerts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
            {alerts.map((a) => (
              <InlineNotice
                key={a.id}
                kind={a.tone}
                message={a.message}
                to={a.to}
                label={a.to ? a.label : undefined}
              />
            ))}
          </div>
        )}

        {/* ── 2 + 3 · TONIGHT, then the ambient readouts ────────────────────── */}
        <SectionLabel>SYSTEM STATUS</SectionLabel>
        <div style={statusGrid}>
          {/* TONIGHT leads: it is the one card with an action, and the reason a manager
              opens this page. It is also the ONLY place "is there a game" is stated. */}
          <StatusCard label="TONIGHT">
            {tonightLoading ? (
              <div className="st-body st-t2">Checking…</div>
            ) : tonight ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="st-heading st-t1">{tonightPhrase(tonight.status)}</span>
                  {tonight.status === "active" && <StatusChip tone="live" dot label="LIVE" />}
                </div>
                <div className="st-body st-t2">
                  {tonight.team_count} team{tonight.team_count === 1 ? "" : "s"}{tonight.is_playoff ? " · finals" : ""}
                </div>
                {canTrivia && (
                  <Link to="/scoring" className="st-btn st-btn-primary st-body" style={action}>Open scoring →</Link>
                )}
              </>
            ) : (
              <>
                <div className="st-heading st-t2">No game today</div>
                <div className="st-body st-t3">Live scoring console — run the game when one's on.</div>
                {/* A deck already built for a later night. Quiet, Secondary tier: it is
                    context, not a task. CAVEAT: `useLiveGame` ranks `active` first, so a
                    stale game nobody ended shadows a future deck — that game raises its own
                    alert row above, which is the thing to fix first anyway. */}
                {nextGame && <div className="st-body st-t2">{nextGame}</div>}
                {canTrivia && (
                  <Link to="/game/setup" className="st-btn st-body st-accent" style={action}>Create game →</Link>
                )}
              </>
            )}
          </StatusCard>

          <StatusCard label="TOAST SYNC">
            <FreshLine
              label="SALES"
              state={sync?.toastSync.state ?? "never"}
              age={formatAge(sync?.toastSync.ageMs ?? null)}
              note={sync && !sync.toastSync.inWindow ? "outside hours" : undefined}
            />
            <FreshLine
              label="MENU"
              state={sync?.menuSync.state ?? "never"}
              age={formatAge(sync?.menuSync.ageMs ?? null)}
            />
            {/* toast-menu-sync held a prune it judged too large to apply unattended
                (0066/v12). Nothing is broken — the menu keeps showing what it had and the
                sync retries every 2 minutes — but a held prune must never be silent. */}
            {sync?.pruneAlarm && (
              <div className="st-body st-amber">
                Menu prune held — {sync.pruneAlarm.count} items missing from Toast, retrying
              </div>
            )}
          </StatusCard>

          <StatusCard label="SEASON">
            {seasonLoading ? (
              <div className="st-body st-t2">Checking…</div>
            ) : season ? (
              <>
                <div className="st-heading st-t1">{season.name}</div>
                <div className="st-body st-t2">{seasonTimePhrase(season.ends_on, season.days_remaining)}</div>
                <ol style={{ listStyle: "none", padding: 0, margin: "2px 0 0" }}>
                  {season.top3.map((t) => (
                    <li key={t.rank} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                      <span className="st-body st-t2" style={ellipsis}>#{t.rank} {t.team_name}</span>
                      <span className="st-mono st-t1">{t.score}</span>
                    </li>
                  ))}
                  {season.top3.length === 0 && <li className="st-body st-t3">No games scored yet</li>}
                </ol>
              </>
            ) : (
              <div className="st-heading st-t2">No active season</div>
            )}
          </StatusCard>

          {/* SCREENS + the retired DISPLAYS tile, merged (see the DECISION above). */}
          <StatusCard label="SCREENS">
            {screensLoading ? (
              <div className="st-body st-t2">Checking…</div>
            ) : screens && screens.length > 0 ? (
              <>
              {/* WARN-2: the ROW goes to the Signage Hub — the screen's card there has its
                  health, its PREVIEW and its kiosk URL, and is where a manager acts. The
                  kiosk URL is a separate, explicit 44×44 control, because opening it is a
                  different act with a real consequence: that tab BECOMES the screen and
                  starts posting its heartbeat. */}
              {screens.map((s, i) => (
                <div key={s.id} style={{ ...screenRow, borderTop: i === 0 ? "none" : "1px solid" }}>
                  <Link to="/signage" title={`Open ${screenName(s)} in the Signage Hub`} style={screenRowLink}>
                    <span className="st-body st-t1" style={ellipsis}>{screenName(s)}</span>
                    <ScreenBadge health={screenHealth(s.last_seen)} />
                  </Link>
                  <a
                    href={`/signage/s/${s.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the live board (kiosk URL — this tab heartbeats as that screen)"
                    aria-label={`Open the live board for ${screenName(s)} (kiosk URL)`}
                    className="st-t3"
                    style={kioskLink}
                  >
                    ↗
                  </a>
                </div>
              ))}
                <a
                  href="/drinks"
                  target="_blank"
                  rel="noreferrer"
                  title="Legacy standalone board — not a recommended TV target. Top Sellers now rotates inside signage."
                  className="st-t3"
                  style={{ ...legacyLink }}
                >
                  Legacy drinks board ↗
                </a>
              </>
            ) : (
              <div className="st-body st-t3">No screens provisioned</div>
            )}
          </StatusCard>
        </div>

        {/* ── 4 · THE LAUNCHER ───────────────────────────────────────────────
            Pure links, grouped under the same section names the v2 nav uses, each with
            the one-line task description the tiles already carried. No status lines here
            (C3) — a tile that reports state competes with the card that owns it. */}
        <SectionLabel style={{ marginTop: 32 }}>MODULES</SectionLabel>
        {tiles.length === 0 ? (
          <EmptyState eyebrow="NO MODULES" message="Your account has no module grants yet. An admin can add them in Users." />
        ) : (
          sections.map((sec) => {
            const list = tiles.filter((t) => t.section === sec);
            if (list.length === 0) return null;
            return (
              <div key={sec} style={{ marginBottom: 18 }}>
                <div className="st-label st-t3" style={{ marginBottom: 8 }}>{sec}</div>
                <div style={narrow ? moduleGridNarrow : moduleGrid}>
                  {list.map((t) => <TileCard key={t.label} tile={t} />)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────

function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="st-label st-t2" style={{ marginBottom: 10, ...style }}>{children}</div>;
}

function StatusCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="st-card" style={card}>
      <div className="st-label st-t2">{label}</div>
      {children}
    </div>
  );
}

/** Freshness tones on the §B budget: full-saturation green is RESERVED for a genuinely
 *  live signal, amber is "getting old", red is "stopped". */
const FRESH_TONE: Record<Freshness, StatusTone> = {
  fresh: "live", amber: "warn", red: "alert", idle: "idle", never: "alert",
};
const FRESH_LABEL: Record<Freshness, string> = {
  fresh: "LIVE", amber: "STALE", red: "DOWN", idle: "IDLE", never: "NO DATA",
};

function FreshLine({ label, state, age, note }: { label: string; state: Freshness; age: string; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 26 }}>
      <span className="st-label st-t2">{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <StatusChip tone={FRESH_TONE[state]} dot label={FRESH_LABEL[state]} />
        <span className="st-body st-t3" style={{ whiteSpace: "nowrap" }}>{note ?? age}</span>
      </span>
    </div>
  );
}

function ScreenBadge({ health }: { health: ScreenHealth }) {
  const tone: StatusTone = health === "online" ? "live" : health === "stale" ? "warn" : "alert";
  const label = health === "online" ? "ONLINE" : health === "stale" ? "STALE" : "OFFLINE";
  return <StatusChip tone={tone} dot label={label} />;
}

function TileCard({ tile }: { tile: Tile }) {
  const body = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span className="st-heading st-t1">{tile.title}</span>
        {tile.disabled && <span className="st-label st-amber" style={{ whiteSpace: "nowrap" }}>{tile.disabled}</span>}
      </div>
      <div className="st-body st-t2" style={{ marginTop: 4 }}>{tile.desc}</div>
    </>
  );
  if (tile.disabled) {
    return <div className="st-card" style={{ ...tileBase, opacity: 0.5, cursor: "default" }}>{body}</div>;
  }
  return <Link to={tile.to} className="st-card" style={{ ...tileBase, textDecoration: "none" }}>{body}</Link>;
}

// ── geometry (surface, ink and type size come from the token classes) ─────

const statusGrid: CSSProperties = {
  display: "grid", gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
};
const card: CSSProperties = {
  padding: 16, display: "flex", flexDirection: "column", gap: 6, minHeight: 120,
};
/** A phone shows two launcher columns (the mockup's shape); desktop keeps the wider
 *  auto-fill so a tile's task line never wraps to four lines. */
const moduleGridNarrow: CSSProperties = { display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" };
const moduleGrid: CSSProperties = {
  display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
};
const tileBase: CSSProperties = { display: "block", padding: 16, minHeight: 88 };
/** 44px on BOTH axes — the app-wide tap floor (the width is the card, so only the
 *  height needs stating here; `padding` keeps the hit area honest either way). */
const action: CSSProperties = {
  minHeight: 44, minWidth: 44, padding: "0 18px", marginTop: 6, alignSelf: "flex-start",
  display: "inline-flex", alignItems: "center", textDecoration: "none", cursor: "pointer",
};
const screenRow: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "2px 0",
};
/** The row body: a link to the hub, filling the row so the whole line is the tap target. */
const screenRowLink: CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", minWidth: 0,
  minHeight: 44, textDecoration: "none",
};
/** The kiosk URL: its own 44×44 target, never the row's default action. */
const kioskLink: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minHeight: 44, minWidth: 44, fontSize: 15, textDecoration: "none", flex: "0 0 auto",
};
const legacyLink: CSSProperties = {
  display: "inline-flex", alignItems: "center", minHeight: 44, minWidth: 44,
  fontSize: 12, textDecoration: "none", borderTop: "1px solid", marginTop: 2,
};
const ellipsis: CSSProperties = {
  flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
};
