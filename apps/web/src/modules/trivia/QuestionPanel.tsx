import { useEffect, useState } from "react";
import { useDisplayState, useRoundQuestions, type Round, type DisplayState } from "./useScoring";
import { btnGhost, btnActive } from "./ui";
import { useIsMobile } from "@/shared/useIsMobile";

/**
 * Host question projector + answer key (docs/04 ARCH-2, rewired 2026-07-22). The host
 * manually LOADS a round with the selector (dropdown) — that writes current_round_id, the
 * single source that drives the Q&A question, the landscape VIDEO, and the UP NEXT card.
 * nav / reveal-answer / show-question write game_display_state (current_question_index,
 * show_answer, is_display_active) which the audience GameDisplay renders.
 *
 * SCORE ROUND (owner rewire): reveals the LOADED round's answers in the host ANSWER KEY box
 * for grading — on demand, host-only. It does NOT lock, zero-fill, advance, or touch the
 * audience (the audience answer reveal stays on SHOW/HIDE ANSWER = show_answer). This
 * replaces the old "answer key = previous completed round" logic (is_complete is gone).
 */
export function QuestionPanel({
  gameId,
  rounds,
  currentRound,
  onSelectRound,
  state,
  write,
}: {
  gameId: string;
  rounds: Round[];
  currentRound: Round | null;
  onSelectRound: (roundId: string) => void;
  state: DisplayState | null;
  write: ReturnType<typeof useDisplayState>["write"];
}) {
  const questions = useRoundQuestions(gameId, currentRound, rounds);
  // Below ~700px the two side-by-side panels can't share a row without clipping — stack.
  const stack = useIsMobile(700);

  const [index, setIndex] = useState(0);
  const [showAns, setShowAns] = useState(false);
  const [active, setActive] = useState(false);
  // SCORE ROUND reveal (host answer-key box only). Reset whenever the loaded round changes.
  const [scoreRevealed, setScoreRevealed] = useState(false);

  // Adopt the live display state when it already points at this round; otherwise reset to
  // the top (keeping the display's active flag). Keyed on the round id only — the host is
  // the driver, so we don't re-sync on every realtime tick (would clobber local nav).
  useEffect(() => {
    setScoreRevealed(false); // new round loaded → host must press SCORE ROUND again
    if (!currentRound) return;
    if (state?.current_round_id === currentRound.id) {
      setIndex(state.current_question_index ?? 0);
      setShowAns(state.show_answer ?? false);
      setActive(state.is_display_active ?? false);
    } else {
      setIndex(0);
      setShowAns(false);
      setActive(state?.is_display_active ?? false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound?.id]);

  if (!currentRound) {
    return <div className="terminal-border" style={{ padding: 20, opacity: 0.6, fontSize: 22 }}>No round to project.</div>;
  }

  // Load a round = pin current_round_id (the single source for Q&A / Video / Up Next) and
  // reset the projected question. is_display_active is left as-is.
  const loadRound = (id: string) => {
    onSelectRound(id);
    write.mutate({ current_round_id: id, current_question_index: 0, show_answer: false });
  };

  const sync = (i: number, ans: boolean, act: boolean, killVideo: boolean) => {
    setIndex(i);
    setShowAns(ans);
    setActive(act);
    write.mutate({
      current_round_id: currentRound.id,
      current_question_index: i,
      show_answer: ans,
      is_display_active: act,
      ...(killVideo ? { show_video: false } : {}),
    });
  };

  const q = questions[index];
  const total = questions.length;

  const prev = () => index > 0 && sync(index - 1, false, active, false);
  const next = () => index < total - 1 && sync(index + 1, false, active, false);
  // Jump the projector back to Q1 of the current round — the answer-review loop: after
  // the last question the host collects sheets, then walks forward from Q1 revealing
  // answers. Resets show_answer so the loop starts clean (host re-reveals per question).
  const backToQ1 = () => (total > 0 && index > 0) && sync(0, false, active, false);
  const toggleAnswer = () => sync(index, !showAns, active, false);
  const toggleActive = () => {
    const nextActive = !active;
    if (nextActive && state?.show_video) return; // a video owns the screen — hide it first
    sync(index, showAns, nextActive, nextActive);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Round selector — its own full-width row so the round title (e.g.
          "ROUND 1 — GENERAL KNOWLEDGE") renders uncut instead of being clipped by the
          selector sharing the question-box header. */}
      <div className="terminal-border" style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 18, opacity: 0.7, letterSpacing: 1, flexShrink: 0 }}>ROUND</span>
        <select
          value={currentRound.id}
          onChange={(e) => loadRound(e.target.value)}
          style={{ ...btnGhost, padding: "6px 12px", fontWeight: 700, flex: 1, minWidth: 0 }}
        >
          {rounds.map((r) => (
            <option key={r.id} value={r.id} style={{ background: "#000" }}>{roundLabel(r)}</option>
          ))}
        </select>
      </div>

      {/* Answer key + question projector — FIXED-height boxes (BOX_H). The dimensions must
          not change as the host steps through questions (owner note): question / answer
          content scrolls INSIDE the fixed box rather than reflowing it. */}
      {/* Answer key + question projector — FIXED-height boxes with the projector controls
          aligned UNDER their respective columns (owner refinement 2026-07-22): each box's
          controls sit directly beneath it, one row of height, positioned edge/center. */}
      <div style={{ display: "grid", gridTemplateColumns: stack ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        {/* Answer-key column: box + [ SHOW/HIDE ANSWER centered · BACK TO Q1 right ] */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="terminal-border" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, height: BOX_H }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <h3 style={{ fontSize: 24, fontWeight: 700, flexShrink: 0 }}>ANSWER KEY</h3>
              <span style={{ fontSize: 18, opacity: 0.8, textAlign: "right" }}>{roundLabel(currentRound)}</span>
            </div>
            <div className="terminal-separator" style={{ margin: 0 }} />
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {/* SCORE ROUND reveals the LOADED round's answers here for grading (host-only). */}
              {scoreRevealed && questions.length > 0 ? (
                // Column-major fill (host note, Ronnie): answers descend the FIRST column to
                // the halfway point, then continue down the second (1–5 / 6–10 for 10; odd
                // counts put the extra in the first column). Stack mode stays one column.
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: stack ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)",
                    gridTemplateRows: stack ? undefined : `repeat(${Math.ceil(questions.length / 2)}, auto)`,
                    gridAutoFlow: stack ? "row" : "column",
                    gap: "2px 16px",
                  }}
                >
                  {questions.map((a) => (
                    <div key={a.id} style={{ display: "flex", gap: 8, fontSize: 20, lineHeight: 1.2 }}>
                      <span style={{ fontWeight: 700, flexShrink: 0 }}>{a.question_number > 10 ? "B" : a.question_number}:</span>
                      <span>{a.answer_text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ opacity: 0.5, fontSize: 20 }}>
                  {questions.length === 0 ? "No questions in this round." : "Press SCORE ROUND to reveal this round's answers for grading."}
                </div>
              )}
            </div>
          </div>
          {/* Under the ANSWER box: SCORE ROUND (left, host answer-key reveal — grades the
              LOADED round), SHOW/HIDE ANSWER (center, AUDIENCE reveal = show_answer), BACK TO
              Q1 (right, answer-review loop). 1fr auto 1fr keeps SHOW ANSWER centered. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={() => setScoreRevealed((v) => !v)} style={{ ...(scoreRevealed ? btnActive : btnGhost), justifySelf: "start" }} title="Reveal this round's answers in the host answer key for grading">{scoreRevealed ? "⊟ HIDE ANSWERS" : "⊞ SCORE ROUND"}</button>
            <button type="button" onClick={toggleAnswer} style={{ ...(showAns ? btnActive : btnGhost), justifySelf: "center" }}>{showAns ? "◉ HIDE ANSWER" : "◎ SHOW ANSWER"}</button>
            <button type="button" onClick={backToQ1} disabled={index === 0 || total === 0} style={{ ...btnGhost, justifySelf: "end", opacity: index === 0 || total === 0 ? 0.4 : 1 }}>↩ BACK TO Q1</button>
          </div>
        </div>

        {/* Question column: box + [ PREV left · SHOW/HIDE QUESTION centered · NEXT right ] */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="terminal-border" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, height: BOX_H }}>
            {currentRound.round_type === "final" && currentRound.picture_url ? (
              <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img src={currentRound.picture_url} alt="Picture round" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", border: "1px solid var(--terminal-green)" }} />
              </div>
            ) : total === 0 ? (
              <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5, fontSize: 20 }}>No questions entered.</div>
            ) : (
              <>
                <div style={{ fontSize: 20, opacity: 0.8, flexShrink: 0 }}>
                  {q && q.question_number > 10 ? "BONUS" : `QUESTION ${index + 1} OF ${total}`}
                </div>
                <div style={{ flex: 1, minHeight: 0, fontSize: 24, lineHeight: 1.3, overflowY: "auto" }}>{q?.question_text ?? "—"}</div>
                {showAns && <div style={{ flexShrink: 0, fontSize: 22, fontWeight: 700, color: "var(--terminal-green)", borderTop: "1px solid var(--terminal-green)", paddingTop: 6 }}>▸ {q?.answer_text ?? "—"}</div>}
              </>
            )}
          </div>
          {/* Under the QUESTION box: PREV pinned left edge, SHOW/HIDE QUESTION centered under the
              field, NEXT pinned right edge. 1fr auto 1fr centers the toggle over the column. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={prev} disabled={index === 0} style={{ ...btnGhost, justifySelf: "start", opacity: index === 0 ? 0.4 : 1 }}>◀ PREV</button>
            <button type="button" onClick={toggleActive} style={{ ...(active ? btnActive : btnGhost), justifySelf: "center" }}>{active ? "▣ HIDE QUESTION" : "▢ SHOW QUESTION"}</button>
            <button type="button" onClick={next} disabled={index >= total - 1} style={{ ...btnGhost, justifySelf: "end", opacity: index >= total - 1 ? 0.4 : 1 }}>NEXT ▶</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fixed height of the answer-key / question-projector boxes. Sized to hold a long
 *  question without reflow; extreme cases scroll internally (owner note: dimensions must
 *  stay constant as the host steps through questions). */
const BOX_H = 300;

function roundLabel(r: Round): string {
  let label: string;
  if (r.round_type === "bonus") label = `BONUS: ${r.bonus_description || "SPECIAL"}`;
  else if (r.round_type === "final") label = "FINAL ROUND";
  else label = `ROUND ${r.round_number}`;
  if (r.round_name) label += ` — ${r.round_name}`;
  return label.toUpperCase();
}
