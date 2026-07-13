import { useEffect, useState } from "react";
import { useDisplayState, useRoundQuestions, type Round, type DisplayState } from "./useScoring";
import { btnGhost, btnActive } from "./ui";
import { useIsMobile } from "@/shared/useIsMobile";

/**
 * Host question projector + answer key (docs/04 ARCH-2 — wraps the legacy QuestionDisplay
 * + AnswerKey). The host picks a round to project; nav / reveal-answer / show-question
 * write game_display_state (current_round_id, current_question_index, show_answer,
 * is_display_active) which the audience GameDisplay renders. The answer key shows the
 * PREVIOUS completed round so the host can read answers aloud while the next round's
 * questions are already on deck (parity checklist: "round complete → answer key shows
 * previous round"). Showing a question never steals the screen from a playing video, and
 * background navigation leaves show_video untouched (legacy invariants).
 */
export function QuestionPanel({
  gameId,
  rounds,
  currentRound,
  answerKeyRound,
  onSelectRound,
  state,
  write,
}: {
  gameId: string;
  rounds: Round[];
  currentRound: Round | null;
  answerKeyRound: Round | null;
  onSelectRound: (roundId: string) => void;
  state: DisplayState | null;
  write: ReturnType<typeof useDisplayState>["write"];
}) {
  const questions = useRoundQuestions(gameId, currentRound, rounds);
  const answers = useRoundQuestions(gameId, answerKeyRound, rounds);
  // Below ~700px the two side-by-side panels (346px select + 4-button row) can't
  // share a row without clipping — stack to one column. minmax(0,1fr) keeps the
  // columns from expanding past the viewport at any width (root cause 1).
  const stack = useIsMobile(700);

  const [index, setIndex] = useState(0);
  const [showAns, setShowAns] = useState(false);
  const [active, setActive] = useState(false);

  // Adopt the live display state when it already points at this round; otherwise reset to
  // the top (keeping the display's active flag). Keyed on the round id only — the host is
  // the driver, so we don't re-sync on every realtime tick (would clobber local nav).
  useEffect(() => {
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
  const toggleAnswer = () => sync(index, !showAns, active, false);
  const toggleActive = () => {
    const nextActive = !active;
    if (nextActive && state?.show_video) return; // a video owns the screen — hide it first
    sync(index, showAns, nextActive, nextActive);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: stack ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
      {/* Answer key — previous completed round */}
      <div className="terminal-border" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, minHeight: 220 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 24, fontWeight: 700 }}>ANSWER KEY</h3>
          <span style={{ fontSize: 20, opacity: 0.8 }}>{answerKeyRound ? roundLabel(answerKeyRound) : "—"}</span>
        </div>
        <div className="terminal-separator" />
        {answerKeyRound && answers.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: stack ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: "2px 16px" }}>
            {answers.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 8, fontSize: 20, lineHeight: 1.2 }}>
                <span style={{ fontWeight: 700, flexShrink: 0 }}>{a.question_number > 10 ? "B" : a.question_number}:</span>
                <span>{a.answer_text}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ opacity: 0.5, fontSize: 20 }}>No previous round to show yet.</div>
        )}
      </div>

      {/* Question projector — current round */}
      <div className="terminal-border" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 220 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h3 style={{ fontSize: 24, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{roundLabel(currentRound)}</h3>
          {/* The round <select> auto-sizes to its widest option (~346px); minWidth:0 +
              maxWidth lets it shrink inside the flex row instead of forcing page overflow. */}
          <select value={currentRound.id} onChange={(e) => onSelectRound(e.target.value)} style={{ ...btnGhost, padding: "4px 8px", minWidth: 0, maxWidth: "55%" }}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id} style={{ background: "#000" }}>{roundLabel(r)}</option>
            ))}
          </select>
        </div>

        {currentRound.round_type === "final" && currentRound.picture_url ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
            <img src={currentRound.picture_url} alt="Picture round" style={{ maxHeight: 160, maxWidth: "100%", objectFit: "contain", border: "1px solid var(--terminal-green)" }} />
          </div>
        ) : total === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5, fontSize: 20 }}>No questions entered.</div>
        ) : (
          <>
            <div style={{ fontSize: 20, opacity: 0.8 }}>
              {q && q.question_number > 10 ? "BONUS" : `QUESTION ${index + 1} OF ${total}`}
            </div>
            <div style={{ flex: 1, fontSize: 22, lineHeight: 1.25, overflowY: "auto", maxHeight: 120 }}>{q?.question_text ?? "—"}</div>
            {showAns && <div style={{ fontSize: 22, fontWeight: 700, color: "var(--terminal-green)", borderTop: "1px solid var(--terminal-green)", paddingTop: 6 }}>▸ {q?.answer_text ?? "—"}</div>}
          </>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button type="button" onClick={prev} disabled={index === 0} style={{ ...btnGhost, opacity: index === 0 ? 0.4 : 1 }}>◀ PREV</button>
          <button type="button" onClick={next} disabled={index >= total - 1} style={{ ...btnGhost, opacity: index >= total - 1 ? 0.4 : 1 }}>NEXT ▶</button>
          <div style={{ flex: 1 }} />
          <button type="button" onClick={toggleActive} style={active ? btnActive : btnGhost}>{active ? "▣ HIDE QUESTION" : "▢ SHOW QUESTION"}</button>
          <button type="button" onClick={toggleAnswer} style={showAns ? btnActive : btnGhost}>{showAns ? "◉ HIDE ANSWER" : "◎ SHOW ANSWER"}</button>
        </div>
      </div>
    </div>
  );
}

function roundLabel(r: Round): string {
  let label: string;
  if (r.round_type === "bonus") label = `BONUS: ${r.bonus_description || "SPECIAL"}`;
  else if (r.round_type === "final") label = "FINAL ROUND";
  else label = `ROUND ${r.round_number}`;
  if (r.round_name) label += ` — ${r.round_name}`;
  return label.toUpperCase();
}
