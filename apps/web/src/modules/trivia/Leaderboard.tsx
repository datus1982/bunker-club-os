import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Trophy, Zap, Star, AlertCircle } from "lucide-react";
import {
  useCurrentGame,
  useLeaderboardData,
  type BoardStage,
  type Game,
  type Round,
  type ScoreboardRow,
} from "./useLeaderboard";
import { CheckinQR } from "@/modules/registration/CheckinQR";
import { useSeasonPanel, type SeasonStanding } from "./useSeasonPanel";
import { SUPPORT_TEXT } from "@/modules/signage/supportText";

/**
 * Trivia leaderboard board (docs/04 port). Renders inside signage portrait game mode
 * and the /game/preview screen preview; the standalone /leaderboard TV route is retired.
 *
 * Ported from the legacy Leaderboard.tsx (1056 lines). Behavior preserved; the ~40
 * light-theme knobs (theme_settings) are dropped in favour of the shared terminal
 * design system (docs/00 principle 6, docs/01) — this is a re-skin, not a pixel copy.
 * Fixes applied: ARCH-1 (realtime, one 45s fallback poll — see useLeaderboard),
 * QUAL-4 (game_scoreboard RPC), QUAL-1 (no per-render console.log), PERF-1 (flicker
 * is opt-in in the theme and never enabled here), and the join QR renders locally
 * (qrcode.react) instead of the legacy external api.qrserver.com image.
 *
 * The manual board_stage 'scoring' stage (migration 0038, host-driven reveal
 * choreography) hides scores during scoring — see ScoringInProgress / ScoringHold below.
 * Bonus-round badges need per-round score detail and land with the Scoring/GameDisplay
 * port.
 */

const CANVAS_W = 1080;
const CANVAS_H = 1920;

/**
 * The leaderboard board content, rendered at the fixed 1080×1920 portrait canvas. The
 * signage slot page embeds it in game mode and /game/preview scales it into a pane, so
 * the boards share one code path (docs/09 — reuse, don't fork). Callers own the canvas
 * scaling (SlotDisplay via its slot surface, GamePreview via FixedCanvas).
 */
export function LeaderboardBoard({
  overrideGameId,
  holdInset,
}: {
  overrideGameId: string | null;
  /**
   * Signage PiP (owner beat 2026-07-16): a node the signage portrait game-mode board
   * passes down so the HIDE-SCORES hold stage can split the canvas — the "scores sealed"
   * messaging up top, this inset (the slot's NORMAL rotation, a mini portrait screen)
   * framed as an ad panel below — so ads keep running while the host holds. Only the
   * signage SlotDisplay passes it; the /game/preview screen preview leaves it undefined
   * and the hold stage renders full-screen ScoringInProgress.
   */
  holdInset?: React.ReactNode;
}) {
  const gameQuery = useCurrentGame(overrideGameId);
  const game = gameQuery.data ?? null;
  const { scoreboard, rounds, displayState } = useLeaderboardData(game?.id ?? null);

  const rows = scoreboard.data ?? [];
  const roundList = rounds.data ?? [];
  const gameOverFlag = displayState.data?.show_game_over ?? false;

  // Manual board stage (migration 0038), driven ONLY by the Scoring segmented control.
  // Default 'standings' preserves the pre-0038 behavior for any row/game without a stage.
  const stage: BoardStage = displayState.data?.board_stage ?? "standings";

  // FINAL is reachable via the manual stage OR the legacy GAME OVER flag OR a completed
  // game — so the manual FINAL REVEAL, the END GAME flow, and viewing a finished game in
  // History all land on the final board, without any code auto-flipping board_stage.
  const isFinal = stage === "final" || gameOverFlag || game?.status === "completed";

  const tieInfo = useMemo(() => computeTieInfo(rows), [rows]);
  const hasAnyScores = rows.some((r) => r.total_score !== 0);

  // Season standings panel (docs/06): during an active season, slowly rotate the live
  // game standings with a SEASON STANDINGS — TOP 5 panel. Finite 18s toggle (no infinite
  // animation). Only at the STANDINGS stage (never over qr/scoring/final holds).
  const seasonPanel = useSeasonPanel().data ?? null;
  const canRotate =
    !!seasonPanel && seasonPanel.rows.length > 0 && game?.status === "active" && stage === "standings" && !isFinal;
  const [showSeason, setShowSeason] = useState(false);
  useEffect(() => {
    if (!canRotate) { setShowSeason(false); return; }
    const t = setInterval(() => setShowSeason((v) => !v), 18_000);
    return () => clearInterval(t);
  }, [canRotate]);

  const standings = game && (
    <Standings
      game={game}
      rows={rows}
      rounds={roundList}
      currentRoundId={displayState.data?.current_round_id ?? null}
      tieInfo={tieInfo}
      hasAnyScores={hasAnyScores}
      gameOverFlag={gameOverFlag}
      forceFinal={isFinal}
    />
  );

  return (
    <Frame>
      {gameQuery.isPending ? (
        <Centered title="SYNCING STANDINGS" subtitle="◊ SHELTER AUTHORITY UPLINK" />
      ) : !game ? (
        <Centered title="NO ACTIVE GAME" subtitle="STANDBY — CREATE GAME TO BEGIN" />
      ) : isFinal ? (
        // FINAL wins over the pre-game / qr / scoring holds.
        standings
      ) : stage === "qr" ? (
        <JoinScreen game={game} />
      ) : stage === "scoring" ? (
        // HIDE SCORES hold: signage passes a PiP inset → split the canvas so ads keep
        // running (BEAT 2); /game/preview (no inset) keeps the full screen.
        holdInset ? <ScoringHold inset={holdInset} /> : <ScoringInProgress />
      ) : game.status === "setup" || game.status === "stopped" ? (
        // Default STANDINGS stage before the host starts → the pre-game waiting screen
        // (countdown + registered teams + join QR), unchanged from pre-0038.
        <HoldingScreen game={game} teams={rows} />
      ) : showSeason && seasonPanel ? (
        <SeasonPanel panel={seasonPanel} />
      ) : (
        standings
      )}
    </Frame>
  );
}

/* ── Season standings panel (docs/06) ──────────────────────────────────────── */
function SeasonPanel({ panel }: { panel: { seasonName: string; endsOn: string; rows: SeasonStanding[] } }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "0 8px" }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 34, letterSpacing: 4, opacity: 0.7 }}>SEASON STANDINGS</div>
        <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1, textShadow: "0 0 18px var(--terminal-glow)" }}>TOP 5</div>
        <div style={{ fontSize: 28, opacity: 0.7, marginTop: 8 }}>{panel.seasonName.toUpperCase()} · ENDS {panel.endsOn}</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, justifyContent: "center" }}>
        {panel.rows.map((r) => (
          <div key={r.team_id} className="terminal-border" style={{ display: "flex", alignItems: "center", gap: 28, padding: "18px 28px", borderWidth: r.rank === 1 ? 4 : 2 }}>
            <span style={{ fontSize: 72, fontWeight: 700, minWidth: 90 }}>#{r.rank}</span>
            <span style={{ flex: 1, fontSize: 52, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.team_name}</span>
            <span style={{ fontSize: 64, fontWeight: 700 }}>{r.score}</span>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 26, opacity: 0.6, marginTop: 20 }}>■ CUMULATIVE CAMPAIGN SCORE</div>
    </div>
  );
}

/* ── Layout chrome ─────────────────────────────────────────────────────────── */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: CANVAS_W,
        height: CANVAS_H,
        position: "relative",
        display: "flex",
        flexDirection: "column",
        padding: 40,
        boxSizing: "border-box",
        fontFamily: "'VT323','Share Tech Mono',monospace",
      }}
    >
      {children}
    </div>
  );
}

function Centered({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        gap: 24,
      }}
    >
      <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: 4 }}>{title}</div>
      <div style={{ fontSize: 48, opacity: 0.7 }}>{subtitle}</div>
    </div>
  );
}

/* ── Standings (active / paused / completed) ───────────────────────────────── */

function Standings({
  game,
  rows,
  rounds,
  currentRoundId,
  tieInfo,
  hasAnyScores,
  gameOverFlag,
  forceFinal = false,
}: {
  game: Game;
  rows: ScoreboardRow[];
  rounds: Round[];
  currentRoundId: string | null;
  tieInfo: Map<string, number>;
  hasAnyScores: boolean;
  gameOverFlag: boolean;
  forceFinal?: boolean;
}) {
  const isFinal = forceFinal || gameOverFlag || game.status === "completed";
  const label = currentRoundLabel(currentRoundId, rounds, game);

  // Fit all rows into the body. Header ~250px, footer ~64px, 40px padding each side.
  const bodyH = CANVAS_H - 80 - 250 - 64;
  const count = Math.max(rows.length, 1);
  const gap = 12;
  const rowH = Math.min(150, Math.floor((bodyH - gap * (count - 1)) / count));

  return (
    <>
      <Header label={label} isFinal={isFinal} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap, minHeight: 0 }}>
        {rows.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 48, opacity: 0.6 }}>
            SCORES WILL APPEAR AS TEAMS ANSWER
          </div>
        ) : (
          rows.map((row) => (
            <TeamRow
              key={row.team_id}
              row={row}
              rowH={rowH}
              tiedOrdinal={tieInfo.get(row.team_id) ?? null}
              hasAnyScores={hasAnyScores}
            />
          ))
        )}
      </div>
      <StatusLine game={game} isFinal={isFinal} />
    </>
  );
}

function Header({ label, isFinal }: { label: string | null; isFinal: boolean }) {
  const registrationUrl =
    typeof window !== "undefined" ? `${window.location.origin}/checkin?source=qr` : "";
  return (
    <div
      className="terminal-border"
      style={{
        height: 230,
        marginBottom: 20,
        padding: 20,
        display: "flex",
        alignItems: "center",
        gap: 24,
        boxSizing: "border-box",
      }}
    >
      <div style={{ background: "#000", padding: 10, border: "2px solid var(--terminal-green)", flexShrink: 0 }}>
        <QRCodeSVG value={registrationUrl} size={150} bgColor="#000000" fgColor="#00ff41" level="M" />
        <div style={{ fontSize: 20, textAlign: "center", marginTop: 4 }}>SCAN TO JOIN</div>
      </div>
      <div style={{ flex: 1, textAlign: "center", lineHeight: 1.05 }}>
        <div style={{ fontSize: 28, opacity: 0.7, letterSpacing: 3 }}>BUNKER UNIFIED OS</div>
        <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: 2 }}>
          {isFinal ? "FINAL SCORES" : "LIVE STANDINGS"}
        </div>
        {label && !isFinal && (
          <div style={{ fontSize: 44, opacity: 0.85, marginTop: 4 }}>{label}</div>
        )}
      </div>
    </div>
  );
}

function TeamRow({
  row,
  rowH,
  tiedOrdinal,
  hasAnyScores,
}: {
  row: ScoreboardRow;
  rowH: number;
  tiedOrdinal: number | null;
  hasAnyScores: boolean;
}) {
  const top = row.place <= 3;
  const isFirst = row.place === 1 && tiedOrdinal === null;
  const borderW = row.place === 1 ? 4 : top ? 3 : 1;

  const nameFont = Math.round(Math.min(rowH * 0.4, 56));
  const scoreFont = Math.round(Math.min(rowH * 0.52, 76));
  const rankFont = Math.round(Math.min(rowH * 0.44, 60));

  const rankContent = !hasAnyScores ? (
    "-"
  ) : isFirst ? (
    <Trophy style={{ width: rankFont, height: rankFont }} />
  ) : (
    getOrdinal(tiedOrdinal ?? row.place)
  );

  const rowStyle: CSSProperties = {
    height: rowH,
    display: "flex",
    alignItems: "center",
    gap: 20,
    padding: "0 24px",
    border: `${borderW}px solid var(--terminal-green)`,
    boxSizing: "border-box",
    opacity: top ? 1 : 0.9,
    boxShadow: isFirst ? "0 0 18px var(--terminal-glow)" : undefined,
  };

  return (
    <div style={rowStyle}>
      <div
        style={{
          width: 130,
          flexShrink: 0,
          textAlign: "center",
          fontSize: rankFont,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {rankContent}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: nameFont,
            fontWeight: 700,
            textTransform: "uppercase",
            lineHeight: 1.05,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {row.team_name}
          {row.is_regular && (
            <Star style={{ width: nameFont * 0.7, height: nameFont * 0.7, display: "inline-block", marginLeft: 10, verticalAlign: "-12%" }} />
          )}
        </div>
        {row.wildcard_used && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4, padding: "1px 10px", border: "1px solid var(--terminal-green)", fontSize: Math.round(nameFont * 0.4) }}>
            <Zap style={{ width: nameFont * 0.4, height: nameFont * 0.4 }} />
            WILDCARD
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
        {tiedOrdinal !== null && (
          <AlertCircle style={{ width: rankFont * 0.7, height: rankFont * 0.7 }} />
        )}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: scoreFont, fontWeight: 700, lineHeight: 1 }}>{row.total_score}</div>
          <div style={{ fontSize: Math.round(scoreFont * 0.28), opacity: 0.8 }}>PTS</div>
        </div>
      </div>
    </div>
  );
}

function StatusLine({ game, isFinal }: { game: Game; isFinal: boolean }) {
  const state = isFinal
    ? "■ FINAL"
    : game.status === "paused"
      ? "▮▮ PAUSED"
      : game.status === "active"
        ? "■ LIVE"
        : "■ ONLINE";
  return (
    <div
      style={{
        height: 44,
        marginTop: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        fontSize: 28,
        opacity: 0.75,
        letterSpacing: 2,
      }}
    >
      <span>{state}</span>
      <span>ATOMIC PUB TRIVIA · {game.game_date}</span>
    </div>
  );
}

/* ── Holding screen (setup / stopped) ──────────────────────────────────────── */

function HoldingScreen({ game, teams }: { game: Game; teams: ScoreboardRow[] }) {
  const countdown = useCountdown(game.start_time);
  const registrationUrl =
    typeof window !== "undefined" ? `${window.location.origin}/checkin?source=qr` : "";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minHeight: 0 }}>
      <div style={{ fontSize: 32, opacity: 0.7, letterSpacing: 3, marginTop: 8 }}>BUNKER UNIFIED OS · ATOMIC PUB TRIVIA</div>
      <div style={{ fontSize: 72, fontWeight: 700, marginBottom: 24 }}>WAITING TO START</div>

      <div style={{ background: "#000", padding: 24, border: "3px solid var(--terminal-green)", boxShadow: "0 0 24px var(--terminal-glow)" }}>
        <QRCodeSVG value={registrationUrl} size={360} bgColor="#000000" fgColor="#00ff41" level="M" />
      </div>
      <div style={{ fontSize: 48, fontWeight: 700, marginTop: 16 }}>SCAN TO JOIN</div>

      {countdown && (
        <div style={{ textAlign: "center", marginTop: 28 }}>
          <div style={{ fontSize: 40, opacity: 0.75 }}>{countdown === "STARTING SOON" ? "" : "GAME STARTS IN"}</div>
          <div style={{ fontSize: 120, fontWeight: 700 }}>{countdown}</div>
        </div>
      )}

      <div style={{ fontSize: 40, fontWeight: 700, marginTop: 32, letterSpacing: 2 }}>
        REGISTERED TEAMS — {teams.length}
      </div>
      <div style={{ flex: 1, overflow: "hidden", width: "100%", marginTop: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {teams.map((t) => (
            <div key={t.team_id} className="terminal-border" style={{ padding: "10px 16px", fontSize: 34, textTransform: "uppercase", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {t.team_name}
              {t.is_regular && <Star style={{ width: 28, height: 28, display: "inline-block", marginLeft: 8, verticalAlign: "-10%" }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Stage: JOIN QR (manual 'qr' stage — no scores visible) ───────────────────── */

// Small supporting-label floor, single-sourced from the signage cards (owner beat
// 2026-07-15) so the step/caption micro-copy reads at 20 feet. This board is always
// portrait (the signage portrait game-mode board + /game/preview — landscape
// game mode uses GameDisplayBoard, which has no board stages), so the portrait floor
// is the right constant.
const QR_SUPPORT = SUPPORT_TEXT.portrait; // 40

/**
 * JOIN QR stage — rebuilt to actually onboard the room (owner trivia-cutover beat
 * 2026-07-16). Beyond the big QR + SCAN TO JOIN, it now spells out the three steps a
 * phone-scanner walks through and calls out returning/legacy teams (imported from the
 * old system, with NO join PIN) so their members know their team already exists and how
 * to get onto it.
 *
 * Copy is TRUE to the live /checkin flow (modules/registration/Checkin.tsx + useCheckin.ts):
 *   1. SCAN        → opens /checkin (the patron terminal landing).
 *   2. SIGN IN     → email → a 6-digit code, no password (signInWithOtp, mailer_otp_length=6).
 *   3. PICK / JOIN → RETURNING lists teams you're a member of (legacy captains claim their
 *      imported team by email on first sign-in); NEW_PLAYER → start a team or JOIN an existing
 *      one by PIN or "Ask to join". Legacy teams have NO PIN, so their path is request-to-join
 *      (any teammate approves from their portal) OR the host's walk-up check-in at the stand
 *      (Scoring search-any-team box). The callout below promises exactly those two routes.
 */
function JoinScreen({ game }: { game: Game }) {
  const url = typeof window !== "undefined" ? `${window.location.origin}/checkin` : "";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", textAlign: "center", gap: 20, paddingTop: 8 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: QR_SUPPORT, opacity: 0.7, letterSpacing: 6 }}>SHELTER REGISTRATION · ATOMIC PUB TRIVIA</div>
        <div style={{ fontSize: 128, fontWeight: 700, letterSpacing: 3, lineHeight: 0.92, textShadow: "0 0 18px var(--terminal-glow)" }}>
          SCAN TO JOIN
        </div>
        <div style={{ background: "#000", padding: 26, border: "4px solid var(--terminal-green)", boxShadow: "0 0 28px var(--terminal-glow)", marginTop: 6 }}>
          <CheckinQR size={440} />
        </div>
        <div style={{ fontSize: QR_SUPPORT, opacity: 0.75, letterSpacing: 3 }}>◊ POINT YOUR PHONE CAMERA AT THE CODE</div>
      </div>

      {/* Three-step strip — the exact /checkin walk-through. */}
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <JoinStep n={1} title="SCAN" body="Open your phone camera and tap the link." />
        <JoinStep n={2} title="SIGN IN" body="Enter your email — we send back a 6-digit code. No password, ever." />
        <JoinStep n={3} title="PICK YOUR TEAM" body="Choose your crew, or start a new team in one screen." />
      </div>

      {/* Returning / legacy-team callout — no PIN on imported teams, so request or host. */}
      <div
        className="terminal-border"
        style={{ width: "100%", padding: "22px 30px", textAlign: "left", boxShadow: "0 0 16px var(--terminal-glow)" }}
      >
        <div style={{ fontSize: 54, fontWeight: 700, letterSpacing: 2, lineHeight: 1 }}>PLAYED BEFORE?</div>
        <div style={{ fontSize: 40, marginTop: 12, lineHeight: 1.2 }}>
          Your team is already on file. Sign in and it may be waiting for you — otherwise search for it
          and <b>ASK TO JOIN</b>. A teammate waves you in from their portal — or the host can check your
          team in at the stand.
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 40, opacity: 0.85, letterSpacing: 1 }}>{url}</div>
        <div style={{ fontSize: QR_SUPPORT, opacity: 0.6, letterSpacing: 2 }}>ATOMIC PUB TRIVIA · {game.game_date}</div>
      </div>
    </div>
  );
}

/** One numbered step in the JOIN QR walk-through strip. */
function JoinStep({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22, textAlign: "left" }}>
      <div
        style={{
          flexShrink: 0,
          width: 78,
          height: 78,
          border: "3px solid var(--terminal-green)",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 46,
          fontWeight: 700,
          boxShadow: "0 0 12px var(--terminal-glow)",
        }}
      >
        {n}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: 2, lineHeight: 1 }}>{title}</div>
        <div style={{ fontSize: QR_SUPPORT, opacity: 0.8, lineHeight: 1.15, marginTop: 4 }}>{body}</div>
      </div>
    </div>
  );
}

/* ── Stage: SCORING IN PROGRESS (manual 'scoring' stage — scores sealed) ───────── */

function ScoringInProgress() {
  // "Working" cue without an infinite CSS animation (display perf rule): a block cursor
  // toggled on a 1s local timer — the same accepted cadence as the venue clock/countdown.
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const id = window.setInterval(() => setBlink((b) => !b), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 40, padding: "0 40px" }}>
      <div style={{ fontSize: 40, opacity: 0.7, letterSpacing: 6 }}>◊ SHELTER AUTHORITY · SCORING TERMINAL</div>
      <div style={{ fontSize: 150, fontWeight: 700, letterSpacing: 4, lineHeight: 0.95, textShadow: "0 0 22px var(--terminal-glow)" }}>
        TABULATING
        <span style={{ opacity: blink ? 1 : 0.15 }}>▊</span>
      </div>
      <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: 2, maxWidth: 900, lineHeight: 1.15 }}>
        SCORES SEALED BY THE SHELTER AUTHORITY
      </div>
      <div style={{ fontSize: 40, opacity: 0.7, letterSpacing: 3 }}>STAND BY — STANDINGS RESUME SHORTLY</div>
    </div>
  );
}

/* ── Stage: SCORING HOLD with ad PiP (signage game mode only — BEAT 2) ─────────── */

/**
 * HIDE-SCORES / TABULATE hold: a SLIM "scores sealed" banner up top, then the SHELTER
 * FEED (the `inset` — a full 1080×1920 portrait rotation surface) blown up to dominate the
 * board (owner beat 2026-07-22 — the old layout wasted ~half the canvas on giant TABULATING
 * text and ran a small ~45%-height feed). The banner is now a compact strip; the feed fills
 * the full width and all remaining height, measured-scaled to fit (no distortion). The
 * rotation inside advances on its own timers and obeys every gate (it IS the normal
 * rotation), so promos keep cycling mid-game while the host holds the room.
 */
function ScoringHold({ inset }: { inset: React.ReactNode }) {
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const id = window.setInterval(() => setBlink((b) => !b), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 14 }}>
      {/* Slim banner: eyebrow · TABULATING (blink) · SCORES SEALED — STAND BY, all tight and
          on one/two lines. flexShrink:0 so it never steals the feed's space. */}
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ fontSize: QR_SUPPORT, opacity: 0.7, letterSpacing: 6 }}>◊ SHELTER AUTHORITY · SCORING TERMINAL</div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", flexWrap: "wrap", columnGap: 24, rowGap: 2 }}>
          <div style={{ fontSize: 76, fontWeight: 700, letterSpacing: 3, lineHeight: 1, textShadow: "0 0 18px var(--terminal-glow)" }}>
            TABULATING<span style={{ opacity: blink ? 1 : 0.15 }}>▊</span>
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, opacity: 0.9 }}>SCORES SEALED — STAND BY</div>
        </div>
      </div>

      {/* SHELTER FEED — dominant. Fills full width + all remaining height under the banner. */}
      <ShelterFeed inset={inset} />
    </div>
  );
}

/**
 * The maximized shelter-feed panel: a thin caption then the framed rotation surface scaled
 * to FILL the remaining space. The whole board is a FIXED 1080×1920 portrait canvas (scaled
 * as a unit by DisplayCanvas), so we scale by a FIXED factor derived from a known banner
 * allotment — no runtime measurement. (A prior measured version read clientHeight=0 on the
 * real board and rendered nothing; a fixed scale always renders.) The surface is itself a
 * fixed 1080×1920 portrait canvas, same aspect as the board, so height is the binding
 * constraint — the small side margins are the only letterboxing.
 */
const FEED_BANNER_H = 320; // fixed vertical allotment (of 1920) for the slim banner + caption + gaps
function ShelterFeed({ inset }: { inset: React.ReactNode }) {
  const availH = CANVAS_H - FEED_BANNER_H;
  const scale = Math.min((CANVAS_W - 48) / CANVAS_W, availH / CANVAS_H);
  const w = Math.round(CANVAS_W * scale);
  const h = Math.round(CANVAS_H * scale);
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <div style={{ flexShrink: 0, fontSize: QR_SUPPORT, opacity: 0.65, letterSpacing: 4 }}>◆ MEANWHILE, ON THE SHELTER FEED ◆</div>
      <div
        style={{
          width: w,
          height: h,
          overflow: "hidden",
          border: "4px solid var(--terminal-green)",
          boxShadow: "0 0 26px var(--terminal-glow)",
          background: "#000",
          position: "relative",
        }}
      >
        {/* Nested fixed-px canvas: render the surface at 1080×1920, scale to the panel. */}
        <div style={{ position: "absolute", top: 0, left: 0, width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {inset}
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function getOrdinal(rank: number) {
  const j = rank % 10;
  const k = rank % 100;
  if (j === 1 && k !== 11) return `${rank}st`;
  if (j === 2 && k !== 12) return `${rank}nd`;
  if (j === 3 && k !== 13) return `${rank}rd`;
  return `${rank}th`;
}

/**
 * Teams still visibly tied (share a total, none with a manual tiebreaker_rank).
 * teamId → the shared ordinal position to display. Mirrors legacy getTiedTeams:
 * an all-zero board (game not started) flags nothing.
 */
function computeTieInfo(rows: ScoreboardRow[]): Map<string, number> {
  const tied = new Map<string, number>();
  if (rows.length === 0 || rows.every((r) => r.total_score === 0)) return tied;
  const byScore = new Map<number, ScoreboardRow[]>();
  for (const r of rows) {
    const g = byScore.get(r.total_score);
    if (g) g.push(r);
    else byScore.set(r.total_score, [r]);
  }
  for (const group of byScore.values()) {
    if (group.length < 2) continue;
    const noRank = group.filter((g) => g.tiebreaker_rank === null);
    if (noRank.length > 1) {
      const pos = Math.min(...group.map((g) => g.place));
      noRank.forEach((g) => tied.set(g.team_id, pos));
    }
  }
  return tied;
}

/** Sub-label under LIVE STANDINGS. With manual round selection (owner rewire 2026-07-22) it
 *  reflects the LOADED round (current_round_id) rather than deriving "current round" from
 *  is_complete (retired). Only shown when NOT final (the Header shows FINAL SCORES then). */
function currentRoundLabel(currentRoundId: string | null, rounds: Round[], game: Game): string | null {
  if (game.status === "paused") return "GAME PAUSED";
  const loaded = currentRoundId ? rounds.find((r) => r.id === currentRoundId) : null;
  if (!loaded) return null;
  return loaded.round_type === "final" ? "FINAL ROUND" : `ROUND ${loaded.round_number}`;
}

/** Minute-resolution countdown to start_time (updates every 60s — perf rule). */
function useCountdown(startTime: string | null): string | null {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!startTime) {
      setLabel(null);
      return;
    }
    const tick = () => {
      const diff = new Date(startTime).getTime() - Date.now();
      if (diff <= 0) return setLabel("STARTING SOON");
      const hours = Math.floor(diff / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      setLabel(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [startTime]);
  return label;
}
