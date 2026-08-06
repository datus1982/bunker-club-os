import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { VideoPlayer } from "./VideoPlayer";
import { TriviaHoldingBoard } from "./TriviaHoldingBoard";
import {
  useDisplayGame,
  useGameDisplayData,
  type DisplayStage,
  type Question,
  type Round,
} from "./useGameDisplay";

/**
 * Audience Q&A display board (docs/04 port). Renders inside signage landscape game mode
 * and the /game/preview screen preview; the standalone /game-display TV route is retired.
 *
 * Ported from the legacy GameDisplay.tsx (702 lines). The host drives everything via
 * game_display_state; this screen renders whatever that row says (current round /
 * question, answer reveal, picture round, inter-round video, game over). Fixes:
 * ARCH-1 (realtime, one channel + 45s fallback — see useGameDisplay), QUAL-1
 * (DEV-gated log), PERF-1 (no flicker). The question/answer text FILLS its fixed box
 * via a measure-based binary-search fit (FitBox below) — sized once before paint in a
 * useLayoutEffect on the fixed 1920×1080 canvas (host note, Ronnie: "fill the box as
 * much as possible"). This replaced the earlier length-tier sizes, which left dead
 * room below shorter questions. The fit re-runs when the text OR the box changes (e.g.
 * revealing the answer shrinks the question box → the question re-fits smaller).
 *
 * DECISION: our game_display_state (docs/02) has no current_video_url column; the
 * inter-round video is taken from the current round's rounds.video_url. If a
 * persistent-across-rounds video is ever needed, add the column in a later migration.
 */

/**
 * The game-display board content at the fixed 1920×1080 landscape canvas. The signage
 * slot page embeds it in game mode for landscape slots and /game/preview scales it into
 * a pane (docs/09 — reuse, don't fork); callers own the canvas scaling. Returns the raw
 * 1920×1080 content (video fill or the framed board).
 */
export function GameDisplayBoard({ overrideGameId }: { overrideGameId: string | null }) {
  const gameQuery = useDisplayGame(overrideGameId);
  const game = gameQuery.data ?? null;
  const { displayState, currentRound, upNextRound, questions, isPending } = useGameDisplayData(game?.id ?? null);

  const currentQuestion: Question | undefined = questions[displayState?.current_question_index ?? 0];
  const showAnswer = displayState?.show_answer ?? false;
  const isActive = displayState?.is_display_active ?? false;
  // Manual LANDSCAPE stage (0060). current_round_id (the LOADED round, manually selected in
  // the Scoring console) is the single source for the Q&A question, the VIDEO, and the UP
  // NEXT card (owner rewire 2026-07-22). is_complete drives nothing here.
  const stage: DisplayStage = displayState?.display_stage ?? "qa";

  // Early, stage-independent frames.
  if (gameQuery.isPending) return <Frame><Centered title="SYNCING" subtitle="◊ SHELTER AUTHORITY UPLINK" /></Frame>;
  if (!game) return <Frame><Centered title="NO ACTIVE GAME" subtitle="STANDBY" /></Frame>;
  // GAME OVER override: END GAME raises show_game_over; it wins over any stage.
  if (displayState?.show_game_over) return <Frame><Centered title="GAME OVER" subtitle="THANK YOU FOR PLAYING" /></Frame>;
  if (isPending) return <Frame><Centered title="SYNCING" subtitle="◊ SHELTER AUTHORITY UPLINK" /></Frame>;

  // VIDEO — plays the LOADED round's video, SEALED on start (round/question changes never
  // swap or stop it); at the video's natural end the board auto-returns to UP NEXT.
  if (stage === "video") {
    return <VideoStage round={currentRound} upNext={upNextRound} />;
  }

  // JOIN QR — reuse the SCAN-TO-JOIN holding board (landscape). It renders absolute
  // inset:0, so give it a positioned 1920×1080 parent (same size the Frame produces).
  if (stage === "qr") {
    return (
      <div style={{ position: "relative", width: 1920, height: 1080, background: "#000" }}>
        <TriviaHoldingBoard gameId={game.id} orientation="landscape" />
      </div>
    );
  }

  // Q&A shows the question ONLY when the host has it active AND there's a question/picture to
  // show; otherwise 'qa' (idle) AND 'upnext' both render the UP NEXT card — the new idle
  // screen that REPLACES "WAITING FOR ROUND TO BEGIN".
  const showQuestion =
    stage === "qa" && isActive && !!currentRound &&
    (questions.length > 0 || (currentRound.round_type === "final" && !!currentRound.picture_url));

  let body: React.ReactNode;
  if (stage === "thanks") {
    body = <Centered title="THANK YOU FOR PLAYING" subtitle="ATOMIC PUB TRIVIA" />;
  } else if (showQuestion && currentRound) {
    body =
      currentRound.round_type === "final" && currentRound.picture_url ? (
        <PictureRound round={currentRound} questions={questions} showAnswer={showAnswer} />
      ) : (
        <QuestionView
          round={currentRound}
          question={currentQuestion}
          questions={questions}
          questionIndex={displayState?.current_question_index ?? 0}
          showAnswer={showAnswer}
        />
      );
  } else {
    body = <UpNext round={upNextRound} />;
  }

  return <Frame>{body}</Frame>;
}

/* ── VIDEO stage (sealed once started) ─────────────────────────────────────── */

/**
 * Plays the LOADED round's video, SEALED on start: the URL is captured on the FIRST render
 * (a ref), so changing the loaded round or stepping the question index never swaps or stops
 * the playing video (owner rewire 2026-07-22) — it plays to its natural end. At natural end
 * the board auto-returns to the UP NEXT card for the LIVE loaded round.
 *
 * ⚠ FLAGGED: the natural-end auto-return is LOCAL to the board — it does NOT write
 * display_stage='upnext' to the DB, because this board runs ANONYMOUSLY on the bar TV and
 * /game/preview (RLS blocks writes; only the host console can write display state). The
 * host's EXPLICIT stop (DISPLAY→Video toggled off) DOES write 'upnext' from the authenticated
 * console, so the control reflects it then. A DB write on natural end would need a small
 * anon-safe RPC (migration) — not added unprompted (see the report).
 */
function VideoStage({ round, upNext }: { round: Round | null; upNext: Round | null }) {
  const sealedUrl = useRef<string | null>(null);
  // Capture the loaded round's video the FIRST time it's available (round may still be
  // loading on a cold kiosk mount), then IGNORE every later round change — the playing video
  // is sealed and runs to its natural end.
  if (sealedUrl.current === null && round?.video_url) sealedUrl.current = round.video_url;
  const [ended, setEnded] = useState(false);
  if (!sealedUrl.current) {
    return <Frame><Centered title="STAND BY" subtitle="NO VIDEO FOR THIS ROUND" /></Frame>;
  }
  if (ended) {
    // Natural end → UP NEXT, previewing the NEXT round after the loaded one.
    return <Frame><UpNext round={upNext} /></Frame>;
  }
  return (
    <div style={{ width: 1920, height: 1080, background: "#000" }}>
      <VideoPlayer videoUrl={sealedUrl.current} autoplay onEnded={() => setEnded(true)} />
    </div>
  );
}

/* ── UP NEXT stage / idle ──────────────────────────────────────────────────── */

/** "UP NEXT — ROUND X · <category>" card previewing the NEXT scorable round (the round after
 *  the loaded one). Also the landscape idle screen (Q&A with nothing actively shown). */
function UpNext({ round }: { round: Round | null }) {
  if (!round) {
    return <Centered title="STAND BY" subtitle="NEXT ROUND LOADING…" />;
  }
  const num = round.round_type === "final" ? "FINAL ROUND" : `ROUND ${round.round_number}`;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 40 }}>
      <div style={{ fontSize: 72, opacity: 0.7, letterSpacing: 10 }}>UP NEXT</div>
      <div style={{ fontSize: 200, fontWeight: 700, letterSpacing: 4, lineHeight: 0.95, textShadow: "0 0 28px var(--terminal-glow)" }}>{num}</div>
      {round.round_name && (
        <div style={{ fontSize: 84, fontWeight: 700, opacity: 0.9, textTransform: "uppercase", letterSpacing: 2 }}>{round.round_name}</div>
      )}
    </div>
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
      {/* Question FILLS the box: measured to the largest font that fits width+height
          without clipping (wrapping allowed). The box is flex:1, so when the answer is
          hidden it's the full height (Ronnie's "more room below") and the question grows
          big; when the answer is shown the box loses the 200px answer strip and the
          question re-fits smaller. Top-aligned (align="flex-start") keeps any slack below
          a short question. 260px ceiling stops a 2-word question rendering absurdly huge. */}
      <FitBox
        text={question?.question_text ?? "LOADING QUESTION…"}
        maxSize={260}
        weight={400}
        lineHeight={1.15}
        align="flex-start"
        boxClassName="terminal-border"
        boxStyle={{ flex: 1, margin: "20px 0", padding: 48 }}
      />
      {showAnswer && question?.answer_text && (
        // Answer FILLS the fixed 200px box, full width. Filling to fit naturally keeps a
        // short/medium answer on ONE line (one line fills the width at a larger size than
        // wrapping to two would), matching PR #74's single-line intent while scaling UP.
        <FitBox
          text={question.answer_text}
          maxSize={190}
          weight={700}
          lineHeight={1.1}
          align="center"
          boxStyle={{
            height: 200,
            flexShrink: 0,
            border: "4px solid var(--terminal-green)",
            boxShadow: "0 0 24px var(--terminal-glow)",
            padding: "12px 16px",
          }}
        />
      )}
    </>
  );
}

/* ── Picture round ─────────────────────────────────────────────────────────── */

function PictureRound({ round, questions, showAnswer }: { round: Round; questions: Question[]; showAnswer: boolean }) {
  const answers = questions.filter((q) => q.question_number <= 10);
  const boxRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef<HTMLDivElement>(null);
  // The whole answer key (header + grid) is fitted as ONE block to ONE shared font size, so
  // every row is the same size (ten rows at ten sizes would look broken) and the header
  // scales with them. Everything inside is em-based, so the single fitted px on the wrapper
  // drives the lot. Ceiling 120: a full 10-answer key is height-capped around ~100px in this
  // panel, so 120 never binds on a real round — it only stops a 2-answer key from rendering
  // absurdly huge. See useFitSize for the measure/binary-search.
  const size = useFitSize(boxRef, keyRef, { minSize: 24, maxSize: 120 });
  return (
    <>
      <HeaderBar left={roundLabel(round)} right="PICTURE ROUND" />
      <div style={{ flex: 1, display: "flex", gap: 24, marginTop: 20, minHeight: 0 }}>
        {/* The image KEEPS its half at full size when answers reveal (owner ruling: "we like
            the image for reference") — the answer text gains room by FILLING its panel, never
            by taking the image's. Do not change this split. */}
        <div style={{ width: showAnswer ? "50%" : "100%", display: "flex", alignItems: "center", justifyContent: showAnswer ? "flex-start" : "center", minHeight: 0 }}>
          {round.picture_url && (
            <img src={round.picture_url} alt="Picture round" style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain", border: "2px solid var(--terminal-green)" }} />
          )}
        </div>
        {showAnswer && answers.length > 0 && (
          <div
            ref={boxRef}
            className="terminal-border"
            style={{ width: "50%", padding: 24, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 0 }}
          >
            {/* ⚠ Every `fontSize: "1em"` below is LOAD-BEARING, not redundant. terminal-theme.css
                carries `.terminal-theme * { font-size: 1.5rem }` (plus a `div`/`span` rule), so
                EVERY descendant is class-styled to 24px — and a class rule beats plain
                inheritance, which has no specificity. Without re-asserting 1em inline (inline
                beats the class rule) the nested divs/spans silently snap back to 24px and only
                this wrapper scales. Nothing inherits font-size under this theme; that is why the
                pre-fix code hardcoded a px size on every row. Deleting these re-breaks the fit. */}
            <div ref={keyRef} style={{ width: "100%", fontSize: size }}>
              <div style={{ fontSize: "1.15em", fontWeight: 700, textAlign: "center", marginBottom: "0.3em", textTransform: "uppercase", lineHeight: 1.1 }}>ANSWERS</div>
              {/* Column-major fill (matches the host answer key): answers descend the first
                  column to ceil(n/2), then continue down the second column (1–5 / 6–10 for a
                  full 10). grid-auto-flow:column + a fixed ceil(n/2) row count does the split.
                  minmax(0,1fr) lets a long answer WRAP inside its column instead of forcing
                  the grid wider (which would defeat the width half of the fit). */}
              <div style={{ fontSize: "1em", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gridTemplateRows: `repeat(${Math.ceil(answers.length / 2)}, auto)`, gridAutoFlow: "column", gap: "0.25em 0.6em" }}>
                {answers.map((q) => (
                  <div key={q.id} style={{ fontSize: "1em", display: "flex", gap: "0.25em", alignItems: "baseline", lineHeight: 1.15 }}>
                    <span style={{ fontSize: "1em", fontWeight: 700, flexShrink: 0 }}>{q.question_number}.</span>
                    {/* No overflow/ellipsis: an answer must never be silently shortened, and
                        clipping here would hide the overflow the fit needs to measure. */}
                    <span style={{ fontSize: "1em", minWidth: 0, overflowWrap: "break-word" }}>{q.answer_text}</span>
                  </div>
                ))}
              </div>
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

/**
 * useFitSize — the shared measure-based fit. Binary-searches the largest integer font size in
 * [minSize, maxSize] at which the CONTENT node fits inside the BOX on BOTH axes (width and
 * height), wrapping allowed, and returns it.
 *
 * Because it runs in a useLayoutEffect (before paint, not an effect), the correct size is
 * applied before the frame is shown: no flicker on question change or answer reveal.
 *
 * Measurement reads the content node's intrinsic scrollWidth/scrollHeight (independent of how
 * the flex box centers/top-aligns it) against the box's content area (clientWidth/Height
 * minus computed padding). The 1920×1080 canvas is fixed (DisplayCanvas scales the whole
 * surface), so the box's client size is a stable layout metric — same reason
 * TickerReprint/FitText in SlotDisplay/SignageTemplates read client size with no resize
 * listener.
 *
 * The effect has NO dependency array: it re-runs on every commit and only calls setSize when
 * the best size actually changes, so it self-stabilises (one extra measure pass, then quiet)
 * AND it re-fits whenever the box or its content changes — e.g. revealing the answer removes
 * the 200px strip, shrinking the question box, and the question re-fits smaller on that
 * re-render.
 *
 * The content node must be em-driven below its own font size (any nested sizes in `em`), so
 * setting one px size on it scales the whole block — that is what lets the picture-round
 * answer key fit header + all ten rows to ONE shared size in a single search.
 */
function useFitSize(
  boxRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  { minSize, maxSize }: { minSize: number; maxSize: number },
): number {
  const [size, setSize] = useState(maxSize);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const txt = contentRef.current;
    if (!box || !txt) return;
    const cs = getComputedStyle(box);
    const availW = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;
    const capW = Math.floor(availW);
    const capH = Math.floor(availH);
    const fits = (fs: number) => {
      txt.style.fontSize = `${fs}px`;
      return txt.scrollWidth <= capW && txt.scrollHeight <= capH;
    };
    let lo = minSize;
    let hi = maxSize;
    let best = minSize;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    txt.style.fontSize = `${best}px`; // keep the DOM at the fitted size before paint
    if (best !== size) setSize(best);
  });
  return size;
}

/**
 * FitBox — a single text node sized to FILL its fixed box (host note, Ronnie: "make the
 * question and answer boxes fixed to the size and just fill the box as much as possible").
 * Replaces the old length-tier sizes (fitQuestion/fitAnswer), which left dead room below
 * short/medium questions. The fit itself lives in useFitSize above (shared with the
 * picture-round answer key).
 */
function FitBox({
  text,
  maxSize,
  minSize = 28,
  weight = 400,
  lineHeight = 1.15,
  align = "center",
  boxClassName,
  boxStyle,
}: {
  text: string;
  maxSize: number;
  minSize?: number;
  weight?: number;
  lineHeight?: number;
  align?: "center" | "flex-start";
  boxClassName?: string;
  boxStyle?: CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const txtRef = useRef<HTMLParagraphElement>(null);
  const size = useFitSize(boxRef, txtRef, { minSize, maxSize });
  return (
    <div
      ref={boxRef}
      className={boxClassName}
      style={{ display: "flex", alignItems: align, justifyContent: "center", overflow: "hidden", ...boxStyle }}
    >
      <p
        ref={txtRef}
        style={{
          width: "100%",
          margin: 0,
          fontSize: size,
          fontWeight: weight,
          textAlign: "center",
          lineHeight,
          overflowWrap: "break-word",
        }}
      >
        {text}
      </p>
    </div>
  );
}
