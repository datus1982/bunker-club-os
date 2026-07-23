import { useMemo, useState } from "react";
import {
  applicableBonusRounds,
  getScore,
  getTeamBonusForRound,
  getTeamRankings,
  getTop3Ties,
  getOrdinal,
  scoringRounds,
  threeChanceAnsweredRound,
  type Round,
  type ScoreRow,
  type Team,
  type useGameScores,
} from "./useScoring";
import { Modal, Field, input, btnGhost, btnPrimary, btnDanger, checkRow } from "./ui";
import { useIsMobile } from "@/shared/useIsMobile";

type Scores = ReturnType<typeof useGameScores>;

/** The small CLEAR button geometry, shared by the real button and its invisible mirror. */
const clearBtnStyle = { ...btnDanger, padding: "2px 8px", minHeight: 0, fontSize: 14 } as const;

/**
 * The scoring grid (docs/04 ARCH-2 — the heart of the legacy Scoring god component).
 * One row per team (alphabetical), one column per non-bonus round, plus Total and (only
 * when the podium is tied) a Tiebreaker column. Clicking a cell opens the score dialog:
 * main points, the one-per-team wildcard (×2), and any bonus rounds attached to that round
 * (standard + three-chance). Round selection / locking / zero-fill were RETIRED (owner
 * rewire 2026-07-22): rounds are chosen manually in QuestionPanel, cells are always
 * editable, and totals treat a MISSING score as 0 directly (getScore(...) ?? 0 — no written
 * zero rows). All scoring math is client-side (no RPC), matching game_scoreboard.
 */
export function RoundGrid({
  teams,
  rounds,
  scores,
  mutations,
  onAddTeam,
  onEditTeam,
  onRemoveTeam,
  onClearAll,
}: {
  teams: Team[];
  rounds: Round[];
  scores: ScoreRow[];
  mutations: Pick<Scores, "saveScore" | "deleteScore" | "setTiebreaker">;
  onAddTeam: () => void;
  onEditTeam: (team: Team) => void;
  onRemoveTeam: (team: Team) => void;
  /** Opens the CLEAR-ALL-SCORES confirm (the modal stays in Scoring). Rendered beside TOTAL. */
  onClearAll: () => void;
}) {
  const cols = useMemo(() => scoringRounds(rounds), [rounds]);
  const ranked = useMemo(() => getTeamRankings(teams, rounds, scores), [teams, rounds, scores]);
  const ties = useMemo(() => getTop3Ties(ranked), [ranked]);
  // Rank source, keyed by team — the RANK column still shows each team's live place even
  // though the ROWS no longer sort by it.
  const rankById = useMemo(() => new Map(ranked.map((r) => [r.team.id, r])), [ranked]);
  // ROW ORDER = STATIC ALPHABETICAL by team name (host note, Ronnie 2026-07-22): teams
  // jumped around as scores changed and he couldn't find one mid-entry. Rows now stay put
  // all night (case-insensitive name sort, id tiebreak for stability). Only the host entry
  // grid changes — the audience boards (Leaderboard/GameDisplay) still rank by score.
  const orderedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [teams],
  );
  const narrow = useIsMobile();

  const [cell, setCell] = useState<{ team: Team; round: Round } | null>(null);

  // Phone-only: expand the small in-grid icon controls to ≥44px tap targets. Desktop keeps
  // its dense layout (the host runs the grid on a laptop — density must not regress).
  const iconBtn = narrow ? { padding: "6px", minWidth: 44, minHeight: 44 } : { padding: "2px 8px" };

  return (
    <div>
      {narrow && <div className="u-scrollcue">◂ SCROLL ROUNDS ▸</div>}
      <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 20 }}>
        <thead>
          <tr>
            <Th>RANK</Th>
            <Th align="left">TEAM</Th>
            {/* Round headers are labels only now — the DONE/OPEN completion toggle was retired
                (owner rewire 2026-07-22). Rounds are selected manually in QuestionPanel. */}
            {cols.map((r) => (
              <Th key={r.id}>{r.round_type === "final" ? "FINAL" : `R${r.round_number}`}</Th>
            ))}
            {/* ITEM A (owner 2026-07-22): TOTAL must be CENTERED over the total column with CLEAR
                tucked to its right WITHOUT shifting TOTAL. An INVISIBLE mirror of the CLEAR button
                on the LEFT reserves the identical width, so the 1fr auto 1fr grid stays symmetric
                around TOTAL at any cell width (the old empty-left-cell collapsed at min-content and
                pushed TOTAL left). CLEAR keeps the same confirm + clearAllScores (modal in Scoring). */}
            <Th>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
                {/* Mirror is the SAME element type (button) so it renders the identical width
                    under the terminal theme — a <span> got a different global font size. */}
                <button type="button" aria-hidden tabIndex={-1} style={{ ...clearBtnStyle, justifySelf: "end", visibility: "hidden", pointerEvents: "none" }}>CLEAR</button>
                <span style={{ justifySelf: "center" }}>TOTAL</span>
                <button type="button" onClick={onClearAll} style={{ ...clearBtnStyle, justifySelf: "start" }} title="Clear every score in this game">CLEAR</button>
              </div>
            </Th>
            {ties.hasTies && <Th>TIE</Th>}
            <Th> </Th>
          </tr>
        </thead>
        <tbody>
          {orderedTeams.map((team) => {
            const rk = rankById.get(team.id);
            const total = rk?.total ?? 0;
            const rank = rk?.rank ?? 0;
            const tiedPos = ties.tiedPosition.get(team.id);
            return (
              <tr key={team.id} style={{ borderTop: "1px solid var(--terminal-dim, #0f3)" }}>
                <Td>
                  <span style={{ fontWeight: 700 }}>{tiedPos != null ? `${getOrdinal(tiedPos)}=` : getOrdinal(rank)}</span>
                </Td>
                <Td align="left">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 700 }}>{team.name}</span>
                    {team.is_regular && <span title="Regular team">★</span>}
                    {team.wildcard_used_on_round != null && <span title={`Wildcard on R${team.wildcard_used_on_round}`}>⚡</span>}
                  </div>
                </Td>
                {cols.map((r) => {
                  const s = getScore(scores, team.id, r.id);
                  const bonus = getTeamBonusForRound(team, r, rounds, scores);
                  const isWild = team.wildcard_used_on_round === r.round_number;
                  return (
                    <Td key={r.id}>
                      {/* Cells are ALWAYS editable now — round locking retired (owner rewire). */}
                      <button
                        type="button"
                        onClick={() => setCell({ team, round: r })}
                        style={{
                          ...btnGhost,
                          width: "100%",
                          padding: "4px 6px",
                          cursor: "pointer",
                          borderColor: s ? "var(--terminal-green)" : "rgba(0,255,65,0.3)",
                        }}
                      >
                        {s ? (
                          <span>
                            {isWild ? `${s.points}×2` : s.points}
                            {bonus > 0 && <span title={`+${bonus} bonus`}> ★{bonus}</span>}
                          </span>
                        ) : (
                          <span style={{ opacity: 0.4 }}>–</span>
                        )}
                      </button>
                    </Td>
                  );
                })}
                <Td><span style={{ fontSize: 24, fontWeight: 700 }}>{total}</span></Td>
                {ties.hasTies && (
                  <Td>
                    {ties.availableRanks.has(team.id) ? (
                      <select
                        value={team.tiebreaker_rank ?? ""}
                        onChange={(e) => mutations.setTiebreaker.mutate({ teamId: team.id, rank: e.target.value ? parseInt(e.target.value) : null })}
                        style={{ ...input, padding: "2px 4px", fontSize: 18 }}
                      >
                        <option value="">—</option>
                        {ties.availableRanks.get(team.id)!.map((rk) => (
                          <option key={rk} value={rk} style={{ background: "#000" }}>{medal(rk)}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ opacity: 0.4 }}>–</span>
                    )}
                  </Td>
                )}
                <Td>
                  <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                    <button type="button" onClick={() => onEditTeam(team)} style={{ ...btnGhost, ...iconBtn, fontSize: 16 }} title="Edit team">✎</button>
                    <button type="button" onClick={() => onRemoveTeam(team)} style={{ ...btnDanger, ...iconBtn, fontSize: 16 }} title="Remove from game">🗑</button>
                  </div>
                </Td>
              </tr>
            );
          })}
          <tr>
            <Td colSpan={cols.length + (ties.hasTies ? 5 : 4)} align="left">
              <button type="button" onClick={onAddTeam} style={{ ...btnGhost, marginTop: 8 }}>+ ADD TEAM TO GAME</button>
            </Td>
          </tr>
        </tbody>
      </table>
      </div>

      {cell && (
        <ScoreDialog
          team={cell.team}
          round={cell.round}
          rounds={rounds}
          scores={scores}
          onClose={() => setCell(null)}
          onSave={(payload) => {
            mutations.saveScore.mutate(payload, { onSuccess: () => setCell(null) });
          }}
          onDelete={() => {
            mutations.deleteScore.mutate(
              { teamId: cell.team.id, round: cell.round, wasWildcard: cell.team.wildcard_used_on_round === cell.round.round_number },
              { onSuccess: () => setCell(null) },
            );
          }}
        />
      )}
    </div>
  );
}

/* ── Score entry dialog ────────────────────────────────────────────────────── */

interface SavePayload {
  teamId: string;
  round: Round;
  points: number;
  wildcard: boolean | undefined;
  bonus: { round: Round; points: number | null }[];
}

function ScoreDialog({
  team,
  round,
  rounds,
  scores,
  onClose,
  onSave,
  onDelete,
}: {
  team: Team;
  round: Round;
  rounds: Round[];
  scores: ScoreRow[];
  onClose: () => void;
  onSave: (p: SavePayload) => void;
  onDelete: () => void;
}) {
  const existing = getScore(scores, team.id, round.id);

  // Bonus rounds to show: standard ones attached to this round, plus three-chance ones
  // not yet answered in a DIFFERENT round (legacy: one guess across the three rounds).
  const bonusRounds = useMemo(() => {
    return applicableBonusRounds(round, rounds).filter((b) => {
      if (b.bonus_type !== "three-chance") return true;
      const bs = getScore(scores, team.id, b.id);
      if (!bs) return true;
      return threeChanceAnsweredRound(b, bs.points) === round.round_number; // answered here → still editable
    });
  }, [round, rounds, scores, team.id]);

  const bonusPointsFor = (b: Round): number => {
    if (b.bonus_type === "three-chance") {
      const idx = (b.bonus_round_numbers ?? []).indexOf(round.round_number);
      return (b.bonus_points_per_round ?? [])[idx] ?? b.max_points ?? 0;
    }
    return b.max_points ?? 0;
  };

  const [scoreInput, setScoreInput] = useState(existing ? String(existing.points) : "");
  const [useWild, setUseWild] = useState(team.wildcard_used_on_round === round.round_number);
  const [correct, setCorrect] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const b of applicableBonusRounds(round, rounds)) {
      const bs = getScore(scores, team.id, b.id);
      if (bs && bs.points > 0 && threeChanceAnsweredRound(b, bs.points) === round.round_number) s.add(b.id);
      if (bs && b.bonus_type !== "three-chance" && bs.points > 0) s.add(b.id);
    }
    return s;
  });
  const [zero, setZero] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const b of applicableBonusRounds(round, rounds)) {
      if (b.bonus_type !== "three-chance") continue;
      const bs = getScore(scores, team.id, b.id);
      if (bs && bs.points === 0 && threeChanceAnsweredRound(b, 0) === round.round_number) s.add(b.id);
    }
    return s;
  });
  const [error, setError] = useState<string | null>(null);

  // Wildcard may be used only if unused, or already on this round (legacy guard).
  const wildcardAllowed = team.wildcard_used_on_round == null || team.wildcard_used_on_round === round.round_number;

  const toggleCorrect = (b: Round) => {
    setCorrect((prev) => {
      const n = new Set(prev);
      if (n.has(b.id)) n.delete(b.id);
      else { n.add(b.id); setZero((z) => { const zn = new Set(z); zn.delete(b.id); return zn; }); }
      return n;
    });
  };
  const toggleZero = (b: Round) => {
    setZero((prev) => {
      const n = new Set(prev);
      if (n.has(b.id)) n.delete(b.id);
      else { n.add(b.id); setCorrect((c) => { const cn = new Set(c); cn.delete(b.id); return cn; }); }
      return n;
    });
  };

  const save = () => {
    if (useWild && !wildcardAllowed) return setError("This team has already used their wildcard on another round.");
    const points = parseInt(scoreInput) || 0;
    const wildcard = useWild ? true : team.wildcard_used_on_round === round.round_number ? false : undefined;
    const bonus = bonusRounds.map((b) => {
      if (correct.has(b.id)) return { round: b, points: bonusPointsFor(b) };
      if (zero.has(b.id)) return { round: b, points: 0 };
      return { round: b, points: null };
    });
    onSave({ teamId: team.id, round, points, wildcard, bonus });
  };

  return (
    <Modal
      title={`${team.name} — ${round.round_type === "final" ? "FINAL" : `ROUND ${round.round_number}`}`}
      onClose={onClose}
      footer={
        <>
          {existing && <button type="button" onClick={onDelete} style={btnDanger}>CLEAR</button>}
          <button type="button" onClick={onClose} style={btnGhost}>CANCEL</button>
          <button type="button" onClick={save} style={btnPrimary}>SAVE</button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label={`POINTS (MAX ${round.max_points ?? "—"})`}>
          <input
            type="number"
            value={scoreInput}
            onChange={(e) => setScoreInput(e.target.value)}
            placeholder="0"
            style={input}
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </Field>

        <label style={{ ...checkRow, opacity: wildcardAllowed ? 1 : 0.5 }}>
          <input type="checkbox" checked={useWild} disabled={!wildcardAllowed} onChange={(e) => setUseWild(e.target.checked)} />
          <span>WILDCARD — double this round's points {team.wildcard_used_on_round != null && team.wildcard_used_on_round !== round.round_number ? `(used on R${team.wildcard_used_on_round})` : ""}</span>
        </label>

        {bonusRounds.map((b) => (
          <div key={b.id} className="terminal-border" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              BONUS: {b.bonus_description || "SPECIAL"} {b.bonus_type === "three-chance" ? `(THREE-CHANCE · ${bonusPointsFor(b)} PTS HERE)` : `(${bonusPointsFor(b)} PTS)`}
            </div>
            <label style={checkRow}>
              <input type="checkbox" checked={correct.has(b.id)} onChange={() => toggleCorrect(b)} />
              <span>CORRECT — award {bonusPointsFor(b)} pts</span>
            </label>
            {b.bonus_type === "three-chance" && (
              <label style={checkRow}>
                <input type="checkbox" checked={zero.has(b.id)} onChange={() => toggleZero(b)} />
                <span>INCORRECT — 0 pts (uses up their one guess)</span>
              </label>
            )}
          </div>
        ))}

        {error && <div className="terminal-border" style={{ padding: 10, fontSize: 20 }}>⚠ {error}</div>}
      </div>
    </Modal>
  );
}

/* ── table cells ───────────────────────────────────────────────────────────── */

function Th({ children, align = "center" }: { children: React.ReactNode; align?: "center" | "left" }) {
  return <th style={{ padding: "6px 10px", textAlign: align, borderBottom: "2px solid var(--terminal-green)", fontWeight: 700, whiteSpace: "nowrap" }}>{children}</th>;
}
function Td({ children, align = "center", colSpan }: { children: React.ReactNode; align?: "center" | "left"; colSpan?: number }) {
  return <td colSpan={colSpan} style={{ padding: "6px 10px", textAlign: align, verticalAlign: "middle" }}>{children}</td>;
}

function medal(rank: number): string {
  return rank === 1 ? "🥇 1st" : rank === 2 ? "🥈 2nd" : rank === 3 ? "🥉 3rd" : getOrdinal(rank);
}
