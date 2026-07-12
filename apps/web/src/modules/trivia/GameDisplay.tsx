import { useSearchParams } from "react-router-dom";
import { DisplayCanvas } from "@/shared/DisplayCanvas";
import { VideoPlayer } from "./VideoPlayer";
import {
  useDisplayGame,
  useGameDisplayData,
  type Question,
  type Round,
} from "./useGameDisplay";

/**
 * Audience Q&A display — public landscape display route (docs/04 port, docs/01).
 *
 * Ported from the legacy GameDisplay.tsx (702 lines). The host drives everything via
 * game_display_state; this screen renders whatever that row says (current round /
 * question, answer reveal, picture round, inter-round video, game over). Fixes:
 * ARCH-1 (realtime, one channel + 45s fallback — see useGameDisplay), QUAL-1
 * (DEV-gated log), PERF-1 (no flicker). The legacy's per-frame JS binary-search
 * font-fitting is dropped in favour of fixed sizes on the fixed 1920×1080 canvas
 * (docs/01 — design in absolute px, scale-to-fit does the rest).
 *
 * DECISION: our game_display_state (docs/02) has no current_video_url column; the
 * inter-round video is taken from the current round's rounds.video_url. If a
 * persistent-across-rounds video is ever needed, add the column in a later migration.
 */

export function GameDisplay() {
  const [params] = useSearchParams();
  const overrideGameId = params.get("game");

  const gameQuery = useDisplayGame(overrideGameId);
  const game = gameQuery.data ?? null;
  const { displayState, currentRound, questions, isPending } = useGameDisplayData(game?.id ?? null);

  const currentQuestion: Question | undefined = questions[displayState?.current_question_index ?? 0];
  const showAnswer = displayState?.show_answer ?? false;

  let body: React.ReactNode;

  if (gameQuery.isPending) {
    body = <Centered title="SYNCING" subtitle="◊ SHELTER AUTHORITY UPLINK" />;
  } else if (!game) {
    body = <Centered title="NO ACTIVE GAME" subtitle="STANDBY" />;
  } else if (displayState?.show_game_over) {
    body = <Centered title="GAME OVER" subtitle="THANK YOU FOR PLAYING" />;
  } else if (displayState?.show_video && currentRound?.video_url) {
    // Video fills the whole canvas (no frame).
    return (
      <DisplayCanvas orientation="landscape">
        <div style={{ width: 1920, height: 1080, background: "#000" }}>
          <VideoPlayer videoUrl={currentRound.video_url} autoplay />
        </div>
      </DisplayCanvas>
    );
  } else if (isPending) {
    body = <Centered title="SYNCING" subtitle="◊ SHELTER AUTHORITY UPLINK" />;
  } else if (!currentRound || !displayState?.is_display_active) {
    body = <Centered title="ATOMIC PUB TRIVIA" subtitle="WAITING FOR ROUND TO BEGIN…" />;
  } else if (currentRound.round_type === "final" && currentRound.picture_url) {
    body = <PictureRound round={currentRound} questions={questions} showAnswer={showAnswer} />;
  } else if (questions.length === 0) {
    body = <Centered title={roundLabel(currentRound)} subtitle="NO QUESTIONS AVAILABLE" />;
  } else {
    body = (
      <QuestionView
        round={currentRound}
        question={currentQuestion}
        questions={questions}
        questionIndex={displayState?.current_question_index ?? 0}
        showAnswer={showAnswer}
      />
    );
  }

  return (
    <DisplayCanvas orientation="landscape">
      <Frame>{body}</Frame>
    </DisplayCanvas>
  );
}

/* ── Chrome ────────────────────────────────────────────────────────────────── */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="terminal-border"
      style={{
        width: 1920,
        height: 1080,
        boxSizing: "border-box",
        padding: 40,
        display: "flex",
        flexDirection: "column",
        fontFamily: "'VT323','Share Tech Mono',monospace",
      }}
    >
      {children}
    </div>
  );
}

function Centered({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 32 }}>
      <div style={{ fontSize: 160, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase" }}>{title}</div>
      <div style={{ fontSize: 72, opacity: 0.7, textTransform: "uppercase" }}>{subtitle}</div>
    </div>
  );
}

function HeaderBar({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 90, flexShrink: 0 }}>
      <div style={{ fontSize: 56, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 }}>{left}</div>
      <div style={{ fontSize: 52, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, opacity: 0.85 }}>{right}</div>
    </div>
  );
}

/* ── Question view ─────────────────────────────────────────────────────────── */

function QuestionView({
  round,
  question,
  questions,
  questionIndex,
  showAnswer,
}: {
  round: Round;
  question: Question | undefined;
  questions: Question[];
  questionIndex: number;
  showAnswer: boolean;
}) {
  const isBonus = (question?.question_number ?? 0) > 10;
  const left =
    round.round_type === "bonus" && round.bonus_description
      ? `${round.bonus_description} BONUS`
      : roundLabel(round);
  const mainCount = questions.filter((q) => q.question_number <= 10).length;
  const right = isBonus
    ? round.bonus_description
      ? `${round.bonus_description} BONUS QUESTION`
      : "BONUS QUESTION"
    : `QUESTION ${questionIndex + 1} OF ${mainCount}`;

  return (
    <>
      <HeaderBar left={left} right={right} />
      <div
        className="terminal-border"
        style={{
          flex: 1,
          margin: "20px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 48,
          overflow: "hidden",
        }}
      >
        <p style={{ fontSize: fitQuestion(question?.question_text ?? ""), fontWeight: 400, textAlign: "center", lineHeight: 1.15, margin: 0 }}>
          {question?.question_text ?? "LOADING QUESTION…"}
        </p>
      </div>
      {showAnswer && question?.answer_text && (
        <div
          style={{
            height: 200,
            flexShrink: 0,
            border: "4px solid var(--terminal-green)",
            boxShadow: "0 0 24px var(--terminal-glow)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            overflow: "hidden",
          }}
        >
          <p style={{ fontSize: fitAnswer(question.answer_text), fontWeight: 700, textAlign: "center", margin: 0, lineHeight: 1.1 }}>
            {question.answer_text}
          </p>
        </div>
      )}
    </>
  );
}

/* ── Picture round ─────────────────────────────────────────────────────────── */

function PictureRound({ round, questions, showAnswer }: { round: Round; questions: Question[]; showAnswer: boolean }) {
  const answers = questions.filter((q) => q.question_number <= 10);
  return (
    <>
      <HeaderBar left={roundLabel(round)} right="PICTURE ROUND" />
      <div style={{ flex: 1, display: "flex", gap: 24, marginTop: 20, minHeight: 0 }}>
        <div style={{ width: showAnswer ? "50%" : "100%", display: "flex", alignItems: "center", justifyContent: showAnswer ? "flex-start" : "center", minHeight: 0 }}>
          {round.picture_url && (
            <img src={round.picture_url} alt="Picture round" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", border: "2px solid var(--terminal-green)" }} />
          )}
        </div>
        {showAnswer && answers.length > 0 && (
          <div className="terminal-border" style={{ width: "50%", padding: 24, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ fontSize: 56, fontWeight: 700, textAlign: "center", marginBottom: 16, textTransform: "uppercase", flexShrink: 0 }}>ANSWERS</div>
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px", overflow: "hidden", alignContent: "space-evenly" }}>
              {answers.map((q) => (
                <div key={q.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 40, lineHeight: 1.1 }}>
                  <span style={{ fontWeight: 700, flexShrink: 0 }}>{q.question_number}.</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{q.answer_text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */

function roundLabel(round: Round): string {
  let label: string;
  if (round.round_type === "bonus") label = `BONUS: ${round.bonus_description || "SPECIAL"}`;
  else if (round.round_type === "final") label = "FINAL ROUND";
  else label = `ROUND ${round.round_number}`;
  if (round.round_name) label += ` — ${round.round_name}`;
  return label.toUpperCase();
}

/** Fixed size tiers by length — replaces the legacy JS font-fitting (fixed canvas). */
function fitQuestion(text: string): number {
  const n = text.length;
  if (n <= 60) return 120;
  if (n <= 120) return 92;
  if (n <= 220) return 72;
  if (n <= 380) return 54;
  return 44;
}

function fitAnswer(text: string): number {
  const n = text.length;
  if (n <= 40) return 96;
  if (n <= 90) return 72;
  if (n <= 160) return 52;
  return 40;
}
