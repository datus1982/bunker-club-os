import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { Trophy, Zap, Star, AlertCircle } from "lucide-react";
import { DisplayCanvas } from "@/shared/DisplayCanvas";
import {
  useCurrentGame,
  useLeaderboardData,
  type Game,
  type Round,
  type ScoreboardRow,
} from "./useLeaderboard";
import { useSeasonPanel, type SeasonStanding } from "./useSeasonPanel";

/**
 * Trivia leaderboard — public display route (docs/04 port, docs/01 DisplayCanvas).
 *
 * Ported from the legacy Leaderboard.tsx (1056 lines). Behavior preserved; the ~40
 * light-theme knobs (theme_settings) are dropped in favour of the shared terminal
 * design system (docs/00 principle 6, docs/01) — this is a re-skin, not a pixel copy.
 * Fixes applied: ARCH-1 (realtime, one 45s fallback poll — see useLeaderboard),
 * QUAL-4 (game_scoreboard RPC), QUAL-1 (no per-render console.log), PERF-1 (flicker
 * is opt-in in the theme and never enabled here), and the join QR renders locally
 * (qrcode.react) instead of the legacy external api.qrserver.com image.
 *
 * DECISION: the legacy "Scoring in Progress" interstitial relied on a
 * rounds.scoring_in_progress column that our schema (docs/02) does not have; it is
 * omitted. Bonus-round badges need per-round score detail and land with the
 * Scoring/GameDisplay port.
 */

const CANVAS_W = 1080;
const CANVAS_H = 1920;

export function Leaderboard() {
  const [params] = useSearchParams();
  const overrideGameId = params.get("game");
  return (
    <DisplayCanvas orientation="portrait">
      <LeaderboardBoard overrideGameId={overrideGameId} />
    </DisplayCanvas>
  );
}

/**
 * The leaderboard board content WITHOUT its DisplayCanvas wrapper. The /leaderboard
 * route wraps this in DisplayCanvas exactly as before (behaviour-identical); the
 * signage slot page also embeds it in game mode so the two boards share one code
 * path (docs/09 — reuse, don't fork).
 */
export function LeaderboardBoard({ overrideGameId }: { overrideGameId: string | null }) {
  const gameQuery = useCurrentGame(overrideGameId);
  const game = gameQuery.data ?? null;
  const { scoreboard, rounds, displayState } = useLeaderboardData(game?.id ?? null);

  const rows = scoreboard.data ?? [];
  const roundList = rounds.data ?? [];
  const gameOverFlag = displayState.data?.show_game_over ?? false;

  const tieInfo = useMemo(() => computeTieInfo(rows), [rows]);
  const hasAnyScores = rows.some((r) => r.total_score !== 0);

  // Season standings panel (docs/06): during an active season, slowly rotate the live
  // game standings with a SEASON STANDINGS — TOP 5 panel. Finite 18s toggle (no infinite
  // animation), and NEVER while Game Over is up (that screen must stay put).
  const seasonPanel = useSeasonPanel().data ?? null;
  const canRotate = !!seasonPanel && seasonPanel.rows.length > 0 && game?.status === "active" && !gameOverFlag;
  const [showSeason, setShowSeason] = useState(false);
  useEffect(() => {
    if (!canRotate) { setShowSeason(false); return; }
    const t = setInterval(() => setShowSeason((v) => !v), 18_000);
    return () => clearInterval(t);
  }, [canRotate]);

  return (
    <Frame>
      {gameQuery.isPending ? (
        <Centered title="SYNCING STANDINGS" subtitle="◊ SHELTER AUTHORITY UPLINK" />
      ) : !game ? (
        <Centered title="NO ACTIVE GAME" subtitle="STANDBY — CREATE GAME TO BEGIN" />
      ) : game.status === "setup" || game.status === "stopped" ? (
        <HoldingScreen game={game} teams={rows} />
      ) : showSeason && seasonPanel ? (
        <SeasonPanel panel={seasonPanel} />
      ) : (
        <Standings
          game={game}
          rows={rows}
          rounds={roundList}
          tieInfo={tieInfo}
          hasAnyScores={hasAnyScores}
          gameOverFlag={gameOverFlag}
        />
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
  tieInfo,
  hasAnyScores,
  gameOverFlag,
}: {
  game: Game;
  rows: ScoreboardRow[];
  rounds: Round[];
  tieInfo: Map<string, number>;
  hasAnyScores: boolean;
  gameOverFlag: boolean;
}) {
  const label = currentRoundLabel(game, rounds, tieInfo);
  const isFinal = gameOverFlag || game.status === "completed" || label === "FINAL SCORES";

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

/** Round label shown under the title (mirrors legacy getCurrentRound). */
function currentRoundLabel(game: Game, rounds: Round[], tied: Map<string, number>): string | null {
  if (game.status === "paused") return "GAME PAUSED";
  if (rounds.length === 0) return null;

  const finalRound = rounds.find((r) => r.round_type === "final");
  const regular = rounds
    .filter((r) => r.round_type === "regular")
    .sort((a, b) => a.round_number - b.round_number);
  const lastRegular = finalRound ?? regular[regular.length - 1];
  const finalComplete = lastRegular?.is_complete ?? false;

  const unresolvedTop3 = [...tied.values()].some((pos) => pos <= 3);
  if (finalComplete && unresolvedTop3) return "TIE BREAKER ROUND";
  if (finalComplete) return "FINAL SCORES";

  for (const r of regular) if (!r.is_complete) return `ROUND ${r.round_number}`;
  if (finalRound && !finalRound.is_complete) return "FINAL ROUND";
  return "FINAL SCORES";
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
