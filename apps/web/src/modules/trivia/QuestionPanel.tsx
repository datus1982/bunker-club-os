import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useDisplayState, useRoundQuestions, type Round, type DisplayState } from "./useScoring";
import { cx, useTriviaV2 } from "./triviaV2";
import { btnGhost, btnActive } from "./ui";
import { useIsMobile } from "@/shared/useIsMobile";
import { useFitSize } from "@/shared/useFitSize";
import { formatClock } from "./hostClocks";
import { useElapsedClock, useRoundClock } from "./useHostClocks";

/**
 * Host question projector + answer key (docs/04 ARCH-2, rewired 2026-07-22). The host
 * manually LOADS a round with the selector (dropdown) — that writes current_round_id, the
 * single source that drives the Q&A question, the landscape VIDEO, and the UP NEXT card.
 * nav / reveal-answer / show-question write game_display_state (current_question_index,
 * show_answer, is_display_active) which the audience GameDisplay renders.
 *
 * SCORE ROUND (owner rewire): reveals the LOADED round's answers in the host ANSWER KEY box
 * for grading — on demand, host-only. It does NOT lock, zero-fill, advance, or touch the
 * audience answer reveal (that stays on SHOW/HIDE ANSWER = show_answer). This replaced the
 * old "answer key = previous completed round" logic (is_complete is gone).
 *
 * ── SIX ADDITIONS, 2026-09-17 (Stephen's notes from hosting trivia himself on 09-16) ──
 *
 * 1. PER-QUESTION CLOCK, right-hand end of the question box's header row ("so he know how
 *    long he has lingered on the question"). Restarts at 00:00 on every advance — PREV,
 *    NEXT, a jump square, BACK TO Q1, a round load — and NOT on revealing the answer.
 * 2. PER-ROUND CLOCK, right-hand end of the round selector row. Accumulates while its round
 *    is loaded and SCORE ROUND is off; stops when SCORE ROUND goes on. NO start button
 *    (Marvin's ruling: "no button needed" — the toggle the host already presses is the
 *    lever). Both clocks are HOST-LOCAL: see hostClocks.ts, nothing is written or displayed
 *    anywhere else.
 * 3. FIT-TO-PANE QUESTION TEXT — the question fills its pane instead of sitting at a fixed
 *    24px ("could be bigger by a couple of orders of magnitude… only the question pane").
 *    ⚠ The fitted node deliberately does NOT carry `st-body`: in v2 the token sheet sets
 *    `[data-st-page] .st-body { font-size: 15px !important }`, and an author !important
 *    beats any inline px. This was a LIVE BUG on main, not a hypothetical: the v2 node
 *    carried `st-body` with an inline 24px, so every v2 host had been reading questions at
 *    15px. With the class on the measured node the binary search would also return a number
 *    nothing rendered at. It takes `st-t1` (ink only). The BOX keeps BOX_H: the outer
 *    geometry never changes as the host steps through.
 * 4. SCORE ROUND also sends the BOARD to TABULATE ("when we toggle scoring round we should
 *    make the board switch to the tabulating screen") — the ONE new DB write in this file.
 *    Guarded: never while the game is over or the board is on FINAL, because that would
 *    un-end a finished game. Toggling back to HIDE ANSWERS writes nothing; the host's
 *    reveal stages stay manual after that (Ronnie's rule).
 * 5. The answer key is now a FIXED two-column grid — 1–5 left, 6–10 right, bonus answers
 *    full-width underneath — instead of a content-length-dependent column-major fill. A
 *    seven-question round leaves the holes where they are rather than redistributing.
 * 6. NUMBERED JUMP SQUARES above each box: questions above the question box, rounds above
 *    the answer key. A press is identical to arriving by NEXT / the dropdown. Every
 *    pre-existing control keeps its exact copy and position.
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
  // Mirrors the `.scoring-page` desktop-density media query (min-width 640): above it every
  // control on this page is forced to 38px min-height, below it the inline 44px tap floor
  // stands. The jump squares are square, so that same breakpoint picks their WIDTH.
  const narrow = useIsMobile(640);
  const sq = narrow ? 44 : 38;
  const v2 = useTriviaV2();

  const [index, setIndex] = useState(0);
  const [showAns, setShowAns] = useState(false);
  const [active, setActive] = useState(false);
  // SCORE ROUND reveal (host answer-key box only). Reset whenever the loaded round changes.
  const [scoreRevealed, setScoreRevealed] = useState(false);

  // The two host clocks (addition 1 + 2). Both hooks run unconditionally, above the
  // no-round early return. The question clock's key is round+index, so any change of
  // "which question is current" restarts it and a mere answer reveal does not.
  const questionMs = useElapsedClock(`${currentRound?.id ?? "none"}:${index}`);
  // `scoreRevealed` already resets to false whenever a round is loaded (the effect below),
  // which is what makes "jump back into a round and the clock resumes" fall out for free.
  const roundMs = useRoundClock(gameId, currentRound?.id ?? null, !scoreRevealed);

  // The question pane's fit (addition 3). Box = the flex:1 region INSIDE the fixed box.
  const qBoxRef = useRef<HTMLDivElement>(null);
  const qTextRef = useRef<HTMLDivElement>(null);
  // Floor 24 = the size this pane shipped at, so no question ever gets SMALLER than it was.
  // Ceiling 96: past that a three-word question reads as a poster rather than a question.
  const qSize = useFitSize(qBoxRef, qTextRef, { minSize: 24, maxSize: 96 });

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
    return <div className={cx("terminal-border", v2 && "st-panel st-body st-t2")} style={{ padding: 20, opacity: v2 ? 1 : 0.6, fontSize: 22 }}>No round to project.</div>;
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

  /**
   * SCORE ROUND (addition 4). Turning it ON reveals the answer key here AND sends the
   * portrait board to its TABULATE stage, which is what the host used to have to press
   * twice. Turning it OFF is host-local only — the board stays where the host put it.
   *
   * The guard is the whole point: `show_game_over` or `board_stage === 'final'` means the
   * game has been ended or the final reveal is up, and writing 'scoring' there would drag
   * a finished game back onto a holding screen in front of the room. In that state the
   * toggle still works locally, it just doesn't touch the board.
   *
   * The patch is `board_stage` ONLY — never `show_game_over: false` (review WARN-2). The
   * guard is only as fresh as this console's cached `state` (realtime-invalidated, no poll):
   * a dropped socket or a second host console pressing FINAL leaves the cache stale, and a
   * press then goes through. With the bare patch that stale press is INVISIBLE to the room
   * (the board's `isFinal` precedence beats 'scoring' and self-corrects); with
   * `show_game_over: false` it would yank the FINAL SCORES reveal off the TV. Leaving FINAL
   * on purpose stays BoardStageControl's job.
   */
  const toggleScoreRound = () => {
    const nextRevealed = !scoreRevealed;
    setScoreRevealed(nextRevealed);
    if (!nextRevealed) return;
    if (state?.show_game_over || state?.board_stage === "final") return;
    write.mutate({ board_stage: "scoring" });
  };

  // One square, sized from the breakpoint above. `padding: 0` kills btnGhost's 18px sides
  // so the box is actually square. `lineHeight: 1` is NOT cosmetic: `.scoring-page button`
  // forces 6px of top/bottom padding at desktop, and at the theme's own 1.4 leading an
  // 18px digit came to 39.2px of content — the square measured 38×41 and the two jump rows
  // sat a hair taller than they should. At leading 1 the content fits inside the 38px floor
  // and the square is square in both looks.
  const sqStyle: CSSProperties = {
    width: sq,
    minWidth: sq,
    minHeight: sq,
    padding: 0,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
  // "Already been there" mark on the ghost squares. Inline so it survives both looks; it is
  // suppressed on :hover by `.terminal-theme button:hover { box-shadow: … !important }`
  // (classic glow) and its v2 twin — cosmetic, only on the square under the cursor.
  const passedMark: CSSProperties = {
    boxShadow: `inset 0 -4px 0 ${v2 ? "var(--st-accent)" : "var(--terminal-green)"}`,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Round selector — its own full-width row so the round title (e.g.
          "ROUND 1 — GENERAL KNOWLEDGE") renders uncut instead of being clipped by the
          selector sharing the question-box header. This row IS the round header, which is
          where the round clock belongs (addition 2): pinned to its right end. */}
      <div className={cx("terminal-border", v2 && "st-panel")} style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <span className={cx(v2 && "st-label st-t2")} style={{ fontSize: 18, opacity: v2 ? 1 : 0.7, letterSpacing: 1, flexShrink: 0 }}>ROUND</span>
        <select
          value={currentRound.id}
          onChange={(e) => loadRound(e.target.value)}
          className={cx(v2 && "st-body st-t1")}
          style={{ ...btnGhost, padding: "6px 12px", fontWeight: 700, flex: 1, minWidth: 0 }}
        >
          {rounds.map((r) => (
            <option key={r.id} value={r.id} style={{ background: "#000" }}>{roundLabel(r)}</option>
          ))}
        </select>
        <ClockReadout
          label="ROUND TIME"
          ms={roundMs}
          v2={v2}
          title="Time on this round — runs while the round is loaded, stops when you press SCORE ROUND"
        />
      </div>

      {/* Answer key + question projector — FIXED-height boxes (BOX_H). The dimensions must
          not change as the host steps through questions (owner note): question / answer
          content fits or scrolls INSIDE the fixed box rather than reflowing it. */}
      {/* Answer key + question projector — FIXED-height boxes with the projector controls
          aligned UNDER their respective columns (owner refinement 2026-07-22): each box's
          controls sit directly beneath it, one row of height, positioned edge/center. The
          jump rows (2026-09-17) sit directly ABOVE each box on one matched row FLOOR — the
          boxes stay level wherever neither row wraps (every desktop width ≥1024 with a
          normal 7-round / 10-question deck); in the ~750–1000px band the Q row can wrap to
          two lines while the RD row does not, and the boxes sit one square out of line
          (review NOTE-1, cosmetic on a desktop-primary console). */}
      <div style={{ display: "grid", gridTemplateColumns: stack ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        {/* Answer-key column: ROUND jump row + box + [ SCORE ROUND · SHOW/HIDE ANSWER centered · BACK TO Q1 right ] */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* Round jump squares — same effect as picking the round in the dropdown. */}
          <div role="group" aria-label="Jump to round" style={jumpRow(sq)}>
            <span className={cx(v2 && "st-label st-t2")} style={jumpRowLabel(v2)}>RD</span>
            {rounds.map((r) => {
              const isCur = r.id === currentRound.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => loadRound(r.id)}
                  aria-pressed={isCur}
                  aria-label={`Load ${roundLabel(r)}`}
                  title={roundLabel(r)}
                  className={cx(v2 && "st-body", v2 && isCur && "st-btn-primary")}
                  style={{ ...(isCur ? btnActive : btnGhost), ...sqStyle }}
                >
                  {roundSquareLabel(r)}
                </button>
              );
            })}
          </div>
          <div className={cx("terminal-border", v2 && "st-panel")} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, height: BOX_H }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <h3 className={cx(v2 && "st-heading st-t1")} style={{ fontSize: 24, fontWeight: 700, flexShrink: 0 }}>ANSWER KEY</h3>
              <span className={cx(v2 && "st-label st-t2")} style={{ fontSize: 18, opacity: v2 ? 1 : 0.8, textAlign: "right" }}>{roundLabel(currentRound)}</span>
            </div>
            <div className="terminal-separator" style={{ margin: 0 }} />
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {/* SCORE ROUND reveals the LOADED round's answers here for grading (host-only). */}
              {scoreRevealed && questions.length > 0 ? (
                // FIXED placement (host note 5, 2026-09-17): 1–5 fill the first column top
                // to bottom, 6–10 the second, bonus answers get a full-width row underneath.
                // Placement is computed from question_number, NOT from the list's length or
                // order, so a short round leaves its holes empty instead of re-flowing the
                // key the host has learned to read. Stack mode stays one column in order.
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: stack ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)",
                    gridTemplateRows: stack ? undefined : "repeat(5, auto)",
                    gap: "2px 16px",
                  }}
                >
                  {questions.map((a, i) => (
                    <div key={a.id} style={{ display: "flex", gap: 8, fontSize: 20, lineHeight: 1.2, ...(stack ? null : answerCell(a.question_number, bonusRank(questions, i))) }}>
                      <span className={cx(v2 && "st-mono st-t2")} style={{ fontWeight: 700, flexShrink: 0 }}>{a.question_number > 10 ? `B${a.question_number - 10}` : a.question_number}:</span>
                      <span className={cx(v2 && "st-body st-t1")}>{a.answer_text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={cx(v2 && "st-body st-t3")} style={{ opacity: v2 ? 1 : 0.5, fontSize: 20 }}>
                  {questions.length === 0 ? "No questions in this round." : "Press SCORE ROUND to reveal this round's answers for grading."}
                </div>
              )}
            </div>
          </div>
          {/* Under the ANSWER box: SCORE ROUND (left, host answer-key reveal — grades the
              LOADED round, and since 2026-09-17 also sends the board to TABULATE),
              SHOW/HIDE ANSWER (center, AUDIENCE reveal = show_answer), BACK TO Q1 (right,
              answer-review loop). 1fr auto 1fr keeps SHOW ANSWER centered. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={toggleScoreRound} className={cx(v2 && "st-body", v2 && scoreRevealed && "st-btn-primary")} style={{ ...(scoreRevealed ? btnActive : btnGhost), justifySelf: "start" }} title="Reveal this round's answers for grading and put the board on TABULATE">{scoreRevealed ? "⊟ HIDE ANSWERS" : "⊞ SCORE ROUND"}</button>
            <button type="button" onClick={toggleAnswer} className={cx(v2 && "st-body", v2 && showAns && "st-btn-primary")} style={{ ...(showAns ? btnActive : btnGhost), justifySelf: "center" }}>{showAns ? "◉ HIDE ANSWER" : "◎ SHOW ANSWER"}</button>
            <button type="button" onClick={backToQ1} disabled={index === 0 || total === 0} className={cx(v2 && "st-body")} style={{ ...btnGhost, justifySelf: "end", opacity: index === 0 || total === 0 ? 0.4 : 1 }}>↩ BACK TO Q1</button>
          </div>
        </div>

        {/* Question column: QUESTION jump row + box + [ PREV left · SHOW/HIDE QUESTION centered · NEXT right ] */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* Question jump squares — a press is EXACTLY arriving there by NEXT (same sync
              call), so it resets the per-question clock too. Squares the host has already
              been past carry an underline mark. */}
          <div role="group" aria-label="Jump to question" style={jumpRow(sq)}>
            <span className={cx(v2 && "st-label st-t2")} style={jumpRowLabel(v2)}>Q</span>
            {questions.map((qq, i) => {
              const isCur = i === index;
              const passed = i < index;
              return (
                <button
                  key={qq.id}
                  type="button"
                  onClick={() => sync(i, false, active, false)}
                  aria-pressed={isCur}
                  aria-label={qq.question_number > 10 ? `Jump to bonus question ${qq.question_number - 10}` : `Jump to question ${qq.question_number}`}
                  className={cx(v2 && "st-body", v2 && isCur && "st-btn-primary")}
                  style={{ ...(isCur ? btnActive : btnGhost), ...sqStyle, ...(passed ? passedMark : null) }}
                >
                  {/* Bonus rounds carry 1–3 questions numbered 11–13 (55 live rounds, 27 with
                      three) — a bare "B" three times over would leave only the lit one
                      distinguishable (review NOTE-2). */}
                  {qq.question_number > 10 ? `B${qq.question_number - 10}` : qq.question_number}
                </button>
              );
            })}
          </div>
          <div className={cx("terminal-border", v2 && "st-panel")} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, height: BOX_H }}>
            {currentRound.round_type === "final" && currentRound.picture_url ? (
              <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <img src={currentRound.picture_url} alt="Picture round" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", border: "1px solid var(--terminal-green)" }} />
              </div>
            ) : total === 0 ? (
              <div className={cx(v2 && "st-body st-t3")} style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: v2 ? 1 : 0.5, fontSize: 20 }}>No questions entered.</div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexShrink: 0 }}>
                  <span className={cx(v2 && "st-label st-t2")} style={{ fontSize: 20, opacity: v2 ? 1 : 0.8 }}>
                    {q && q.question_number > 10 ? "BONUS" : `QUESTION ${index + 1} OF ${total}`}
                  </span>
                  <ClockReadout label="ON THIS Q" ms={questionMs} v2={v2} title="Time on this question — resets every time you move" />
                </div>
                {/* The fitted pane. The BOX is what the measure reads against; the text node
                    is what gets the px. See useFitSize's contract — no size class on the
                    measured node, and nothing below it may set a size (this is a single text
                    node, so there is nothing below it). `overflowY: auto` (NOT hidden — review
                    WARN-1): the fit floors at 24px, and ~5% of the live corpus (p99 422 chars,
                    max 528 — Ronnie's long celebrity clues) does not fit at the floor; on main
                    those scrolled, and they must keep scrolling rather than lose their last
                    sentence silently. `scrollbarGutter: "stable"` is LOAD-BEARING (addendum
                    WARN-1): useFitSize reads the BOX's clientWidth once per pass, and on any
                    platform whose scrollbars take space (Windows Chrome) that width depends
                    on whether the PREVIOUS pass's size overflowed — pass A (no bar, 564px)
                    picks 29px, which overflows and grows a bar; pass B (549px) picks 24px,
                    which fits and drops it; forever. A commit-phase setSize loop, i.e. a
                    pulsing question and a plausible "Maximum update depth" blank on the host
                    console. Reserving the gutter pins capW regardless of the bar, so the
                    search is a pure function of the text again. No-op on overlay-scrollbar
                    platforms (macOS default), where the gutter is already 0. */}
                <div ref={qBoxRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable", display: "flex", alignItems: "flex-start" }}>
                  <div
                    ref={qTextRef}
                    className={cx(v2 && "st-t1")}
                    style={{ width: "100%", fontSize: qSize, lineHeight: 1.3, overflowWrap: "break-word" }}
                  >
                    {q?.question_text ?? "—"}
                  </div>
                </div>
                {showAns && <div className={cx(v2 && "st-body st-accent")} style={{ flexShrink: 0, fontSize: 22, fontWeight: 700, color: "var(--terminal-green)", borderTop: "1px solid var(--terminal-green)", paddingTop: 6 }}>▸ {q?.answer_text ?? "—"}</div>}
              </>
            )}
          </div>
          {/* Under the QUESTION box: PREV pinned left edge, SHOW/HIDE QUESTION centered under the
              field, NEXT pinned right edge. 1fr auto 1fr centers the toggle over the column. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={prev} disabled={index === 0} className={cx(v2 && "st-body")} style={{ ...btnGhost, justifySelf: "start", opacity: index === 0 ? 0.4 : 1 }}>◀ PREV</button>
            <button type="button" onClick={toggleActive} className={cx(v2 && "st-body", v2 && active && "st-btn-primary")} style={{ ...(active ? btnActive : btnGhost), justifySelf: "center" }}>{active ? "▣ HIDE QUESTION" : "▢ SHOW QUESTION"}</button>
            <button type="button" onClick={next} disabled={index >= total - 1} className={cx(v2 && "st-body")} style={{ ...btnGhost, justifySelf: "end", opacity: index >= total - 1 ? 0.4 : 1 }}>NEXT ▶</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fixed height of the answer-key / question-projector boxes. Sized to hold a long
 *  question without reflow; the question now FITS to this box (useFitSize) and the answer
 *  key scrolls internally (owner note: dimensions must stay constant as the host steps
 *  through questions). Do not make this depend on content. */
const BOX_H = 300;

/** A jump row: one square per question / round, wrapping, at a fixed minimum height so the
 *  two rows stay level and the two boxes below them start at the same y. */
function jumpRow(sq: number): CSSProperties {
  return { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, minHeight: sq };
}

function jumpRowLabel(v2: boolean): CSSProperties {
  return { fontSize: 14, opacity: v2 ? 1 : 0.6, letterSpacing: 1, flexShrink: 0, marginRight: 2 };
}

/**
 * One host clock readout. The NUMBER takes no size class in v2 on purpose — `st-mono`
 * would drop it to 15px, and this is read at a glance from a host desk mid-show. Same
 * exemption, same reason, as the game clock in Scoring.tsx.
 */
function ClockReadout({ label, ms, v2, title }: { label: string; ms: number; v2: boolean; title: string }) {
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, flexShrink: 0 }}>
      <span className={cx(v2 && "st-label st-t2")} style={{ fontSize: 14, opacity: v2 ? 1 : 0.6, letterSpacing: 1 }}>{label}</span>
      <span className={cx(v2 && "st-t1")} style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{formatClock(ms)}</span>
    </span>
  );
}

/**
 * Where an answer sits in the fixed grid (desktop): 1–5 down column one, 6–10 down column
 * two, anything above 10 (a bonus) as a full-width row beneath both columns, in number
 * order. Rows are named explicitly rather than left to auto-placement so a bonus can never
 * drift up into a gap left by a short round.
 */
function answerCell(questionNumber: number, bonusIndex: number): CSSProperties {
  if (questionNumber <= 5) return { gridColumn: 1, gridRow: questionNumber };
  if (questionNumber <= 10) return { gridColumn: 2, gridRow: questionNumber - 5 };
  return { gridColumn: "1 / -1", gridRow: 6 + bonusIndex };
}

/** How many bonus answers precede index `i` — its row offset under the two columns. */
function bonusRank(list: { question_number: number }[], i: number): number {
  let rank = 0;
  for (let j = 0; j < i; j++) if (list[j].question_number > 10) rank++;
  return rank;
}

/** The one or two characters that fit in a round jump square. */
function roundSquareLabel(r: Round): string {
  if (r.round_type === "bonus") return "B";
  if (r.round_type === "final") return "F";
  return String(r.round_number);
}

function roundLabel(r: Round): string {
  let label: string;
  if (r.round_type === "bonus") label = `BONUS: ${r.bonus_description || "SPECIAL"}`;
  else if (r.round_type === "final") label = "FINAL ROUND";
  else label = `ROUND ${r.round_number}`;
  if (r.round_name) label += ` — ${r.round_name}`;
  return label.toUpperCase();
}
