import { useState } from "react";
import { Modal, btnGhost, btnActive } from "./ui";
import {
  useGameRecap,
  recapRoundLabel,
  youtubeId,
  type RecapRound,
  type RecapQuestion,
  type RecapScoreRow,
} from "./useGameRecap";

/**
 * GAME RECAP — a read-only, in-app modal for browsing a past game from /game/history
 * (replaces the old "VIEW BOARD →" link that navigated away to /leaderboard).
 *
 * DECISION (modal vs window): a recap you *read* is cleaner as an in-app overlay than a
 * popup browser window — the popup-window pattern in this repo is reserved for LIVE
 * display previews (the TVs). This subsumes VIEW BOARD by rendering the final standings
 * as a read-only board in the SUMMARY tab.
 *
 * Three tabs, all read-only (no scoring actions, no writes, no "load into scoring"):
 *   SUMMARY   — quick stats + final standings board (winner highlighted).
 *   QUESTIONS — rounds you expand; questions you click to reveal the answer, Q by Q.
 *   VIDEOS    — the game's video rounds with links (+ YouTube thumbnails when trivial).
 */

type Tab = "summary" | "questions" | "videos";

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
function formatGameDate(d: string): string {
  const wd = WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()] ?? "";
  return `${d} · ${wd}`;
}

const AMBER = "var(--terminal-amber, #ffb000)";

export function GameRecap({
  game,
  onClose,
}: {
  game: { id: string; game_date: string; is_playoff: boolean };
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const { standings, rounds, questions, isPending, isError } = useGameRecap(game.id, true);

  const title = `RECAP · ${formatGameDate(game.game_date)}${game.is_playoff ? " · ★ PLAYOFF" : ""}`;

  return (
    <Modal title={title} onClose={onClose}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <TabButton label="SUMMARY" active={tab === "summary"} onClick={() => setTab("summary")} />
        <TabButton label="QUESTIONS" active={tab === "questions"} onClick={() => setTab("questions")} />
        <TabButton label="VIDEOS" active={tab === "videos"} onClick={() => setTab("videos")} />
      </div>
      <div className="terminal-separator" style={{ margin: 0 }} />

      {isError ? (
        <p className="u-amber" style={{ fontSize: 22 }}>COULD NOT LOAD RECAP.</p>
      ) : isPending ? (
        <p style={{ fontSize: 24, opacity: 0.7 }}>LOADING RECAP…</p>
      ) : tab === "summary" ? (
        <SummaryTab standings={standings} rounds={rounds} isPlayoff={game.is_playoff} gameDate={game.game_date} />
      ) : tab === "questions" ? (
        <QuestionsTab rounds={rounds} questions={questions} />
      ) : (
        <VideosTab rounds={rounds} />
      )}
    </Modal>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ ...(active ? btnActive : btnGhost), fontSize: 20, padding: "8px 14px" }}>
      {label}
    </button>
  );
}

/* ── SUMMARY ──────────────────────────────────────────────────────────────────── */

function SummaryTab({
  standings,
  rounds,
  isPlayoff,
  gameDate,
}: {
  standings: RecapScoreRow[];
  rounds: RecapRound[];
  isPlayoff: boolean;
  gameDate: string;
}) {
  // DECISION: the ROUNDS stat counts SCORING rounds (regular + final) only — bonus rounds
  // attach to a scoring round, they aren't standalone rounds (owner's deck = 5 regular +
  // picture final = 6). This intentionally differs from the /game/history card, which
  // shows the raw rounds-table row count (bonuses included); the QUESTIONS tab still lists
  // every round, bonuses labelled as "BONUS: …".
  const scoringRounds = rounds.filter((r) => r.round_type !== "bonus").length;
  const winningScore = standings.length > 0 ? Math.max(...standings.map((s) => s.total_score)) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Quick stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        <Stat label="DATE" value={formatGameDate(gameDate)} />
        <Stat label="TEAMS" value={String(standings.length)} />
        <Stat label="ROUNDS" value={String(scoringRounds)} />
        <Stat label="WINNING SCORE" value={winningScore != null ? String(winningScore) : "–"} />
      </div>
      {isPlayoff && <div className="u-amber" style={{ fontSize: 20 }}>★ PLAYOFF GAME</div>}

      {/* Standings board (read-only) */}
      <div>
        <div style={{ fontSize: 22, opacity: 0.8, marginBottom: 8, letterSpacing: 1 }}>FINAL STANDINGS</div>
        {standings.length === 0 ? (
          <p style={{ fontSize: 22, opacity: 0.7 }}>NO TEAMS RECORDED.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {standings
              .slice()
              .sort((a, b) => a.place - b.place)
              .map((row) => {
                const winner = row.place === 1;
                return (
                  <div
                    key={row.team_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "6px 10px",
                      border: `1px solid ${winner ? AMBER : "var(--terminal-green)"}`,
                      boxShadow: winner ? `0 0 10px ${AMBER}` : undefined,
                    }}
                  >
                    <span className={winner ? "u-amber" : undefined} style={{ fontSize: 22, fontWeight: 700, minWidth: 34 }}>{row.place}.</span>
                    <span className={winner ? "u-amber" : undefined} style={{ fontSize: 22, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {winner ? "★ " : ""}
                      {row.team_name}
                      {row.wildcard_used ? " ⚡" : ""}
                    </span>
                    <span className={winner ? "u-amber" : undefined} style={{ fontSize: 24, fontWeight: 700 }}>{row.total_score}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="terminal-border" style={{ padding: "8px 10px" }}>
      <div style={{ fontSize: 18, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

/* ── QUESTIONS ────────────────────────────────────────────────────────────────── */

function QuestionsTab({ rounds, questions }: { rounds: RecapRound[]; questions: RecapQuestion[] }) {
  const [openRound, setOpenRound] = useState<string | null>(rounds[0]?.id ?? null);

  if (rounds.length === 0) return <p style={{ fontSize: 22, opacity: 0.7 }}>NO ROUNDS RECORDED.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {rounds.map((r) => {
        const isOpen = openRound === r.id;
        const rq = questions.filter((q) => q.round_id === r.id).sort((a, b) => a.question_number - b.question_number);
        return (
          <div key={r.id} className="terminal-border" style={{ padding: 0 }}>
            <button
              type="button"
              onClick={() => setOpenRound(isOpen ? null : r.id)}
              style={{
                ...btnGhost,
                border: "none",
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                textAlign: "left",
                fontSize: 22,
                padding: "10px 12px",
              }}
            >
              <span>
                {isOpen ? "▾ " : "▸ "}
                {recapRoundLabel(r)}
                {r.round_name ? ` — ${r.round_name}` : ""}
                {r.picture_url ? " [IMG]" : ""}
              </span>
              <span style={{ fontSize: 18, opacity: 0.7 }}>{rq.length} Q</span>
            </button>
            {isOpen && (
              <div style={{ padding: "4px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                {r.picture_url && (
                  <img
                    src={r.picture_url}
                    alt="Picture round"
                    style={{ maxWidth: "100%", border: "1px solid var(--terminal-green)" }}
                  />
                )}
                {rq.length === 0 ? (
                  <p style={{ fontSize: 20, opacity: 0.6 }}>NO QUESTIONS ENTERED.</p>
                ) : (
                  rq.map((q) => <QuestionRow key={q.id} q={q} />)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuestionRow({ q }: { q: RecapQuestion }) {
  const [showAnswer, setShowAnswer] = useState(false);
  return (
    <div
      onClick={() => setShowAnswer((v) => !v)}
      style={{ borderLeft: "2px solid var(--terminal-green)", paddingLeft: 10, cursor: "pointer" }}
    >
      <div style={{ fontSize: 21, display: "flex", gap: 8 }}>
        <span style={{ opacity: 0.7, minWidth: 22 }}>{q.question_number}.</span>
        <span>{q.question_text || "—"}</span>
      </div>
      {showAnswer ? (
        <div className="u-amber" style={{ fontSize: 21, marginTop: 4, paddingLeft: 30 }}>▸ {q.answer_text || "—"}</div>
      ) : (
        <div style={{ fontSize: 18, marginTop: 2, paddingLeft: 30, opacity: 0.5 }}>tap to reveal answer</div>
      )}
    </div>
  );
}

/* ── VIDEOS ───────────────────────────────────────────────────────────────────── */

function VideosTab({ rounds }: { rounds: RecapRound[] }) {
  const videoRounds = rounds.filter((r) => r.video_url && r.video_url.trim().length > 0);

  if (videoRounds.length === 0) {
    return <p style={{ fontSize: 22, opacity: 0.7 }}>NO VIDEOS IN THIS GAME.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {videoRounds.map((r) => {
        const url = r.video_url as string;
        const yt = youtubeId(url);
        return (
          <div key={r.id} className="terminal-border" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 22 }}>
              {recapRoundLabel(r)}
              {r.round_name ? ` — ${r.round_name}` : ""}
            </div>
            {yt && (
              <a href={url} target="_blank" rel="noopener noreferrer">
                <img
                  src={`https://img.youtube.com/vi/${yt}/hqdefault.jpg`}
                  alt="Video thumbnail"
                  style={{ maxWidth: "100%", border: "1px solid var(--terminal-green)", display: "block" }}
                />
              </a>
            )}
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 20, wordBreak: "break-all", color: "var(--terminal-green)" }}
            >
              ▸ {url}
            </a>
          </div>
        );
      })}
    </div>
  );
}
