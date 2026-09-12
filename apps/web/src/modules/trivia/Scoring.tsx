import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useActiveGame,
  useGameScores,
  useDisplayState,
  scoringRounds,
  type Round,
  type Team,
  type GameStatus,
} from "./useScoring";
import { RoundGrid } from "./RoundGrid";
import { QuestionPanel } from "./QuestionPanel";
import { DisplayStageControl } from "./DisplayStageControl";
import { BoardStageControl } from "./BoardStageControl";
import { TeamEditorDialog, type EditableTeam } from "./TeamEditorDialog";
import { cx, useTriviaV2 } from "./triviaV2";
import { ConfirmDialog } from "@/shared/ui";
import { Modal, Field, input, btnGhost, btnPrimary, btnActive, btnDanger } from "./ui";
import { searchTeams, type TeamHit } from "../registration/useCheckin";
import { useTriviaArmedEffective } from "../signage/useSignage";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Scoring console — host tool (docs/01 /scoring, host+). Ported from the legacy
 * 3,285-line Scoring.tsx and decomposed per docs/04 ARCH-2 into RoundGrid /
 * QuestionPanel / DisplayStageControl / BoardStageControl / TeamEditorDialog + the hooks
 * in useScoring.ts. This file is just the composition + game controls + team-editor
 * plumbing.
 *
 * Owner rebuild (2026-07-22): the two audience boards are driven by TWO independent,
 * fully-manual single-select controls on the control line — DISPLAY (landscape, 0060
 * display_stage) and BOARD (portrait, 0038 board_stage). A persisted game clock (0060
 * clock_started_at) counts up from START; PAUSE/STOP are gone; END GAME lives in the arm
 * box (it disarms too). START only starts the clock + marks the game active (so scoring /
 * the arm resolver work); it does NOT touch the screens — arming is manual.
 *
 * POLISH ARC 2 (PR 3) — the v2 token look, behind `bunker.trivia_ui_version`. This is the
 * zero-surprise surface (spec §A2): the DOM structure, the DISPLAY/BOARD stage-control sets,
 * their order and positions, the arm bar's place directly under the header, the fixed 300px
 * question/answer boxes and the `.scoring-page` desktop density are ALL unchanged — only
 * fill, edge and ink move. Two named exemptions from the general v2 rules live here:
 *   · Button copy stays UPPERCASE and verb-first (owner letter E1) — muscle-memory copy a
 *     host reads at a glance mid-show is not the place for a case experiment.
 *   · No mount or page-transition animation (§A2) — the room must never see this settle.
 */
export function Scoring() {
  const [params] = useSearchParams();
  const override = params.get("game");
  const qc = useQueryClient();
  const v2 = useTriviaV2();

  const { query: gameQuery, game, setStatus } = useActiveGame(override);
  const scores = useGameScores(game?.id ?? null);
  const display = useDisplayState(game?.id ?? null);

  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [addingTeam, setAddingTeam] = useState(false);
  const [editing, setEditing] = useState<EditableTeam | null>(null);
  const [removing, setRemoving] = useState<Team | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const cols = useMemo(() => scoringRounds(scores.rounds), [scores.rounds]);

  // The LOADED round = the round the host selected in QuestionPanel; defaults to the FIRST
  // round until the host picks one (is_complete no longer drives this — owner rewire
  // 2026-07-22). It is the single source for the Q&A question, the VIDEO, and UP NEXT.
  const selectedRound: Round | null = useMemo(() => {
    const byId = selectedRoundId ? scores.rounds.find((r) => r.id === selectedRoundId) : null;
    // On a console reload (selectedRoundId is local state, so it resets), adopt the round
    // the DB currently has loaded (current_round_id) instead of snapping to round 1 — else
    // the host's next VIDEO / UP NEXT / question-nav press would pin the display back to
    // round 1 (WARN-1, reviewer 2026-07-22).
    const fromDb = scores.rounds.find((r) => r.id === display.state?.current_round_id);
    return byId ?? fromDb ?? cols[0] ?? null;
  }, [selectedRoundId, scores.rounds, cols, display.state?.current_round_id]);

  // ── the three destructive actions, ONE copy each ──────────────────────────────
  // Both looks reach the same dialogs (v2 = ConfirmDialog, classic = Modal) and used to
  // carry their own hand-copied handler bodies; END GAME's was nine lines duplicated
  // verbatim, so a fix to one look could silently miss the other. The call ORDER is
  // preserved exactly as classic had it — this is a de-duplication, not a rewrite.
  const doRemoveTeam = () => {
    if (!removing) return;
    scores.removeTeam.mutate(removing.id, { onSuccess: () => setRemoving(null) });
  };
  const doClearAll = () => scores.clearAllScores.mutate(undefined, { onSuccess: () => setConfirmClear(false) });
  const endGame = () => {
    setStatus.mutate("completed" as GameStatus);
    // Trivia's over → un-arm the bar TVs so they return to rotation/media (WARN-1 #3).
    // Fire-and-forget; the arm also auto-expires nightly, so a failed disarm self-heals.
    supabase.rpc("set_trivia_screens_armed", { p_venue_id: VENUE_ID, p_armed: false }).then(undefined, () => {});
    qc.setQueryData(["signage", "triviaScreensArmed"], { armed: false, at: null });
    qc.invalidateQueries({ queryKey: ["signage", "triviaScreensArmed"] });
    display.write.mutate({ show_game_over: true, is_display_active: false }, { onSuccess: () => setConfirmEnd(false) });
  };

  if (gameQuery.isPending) return <Centered text="LOADING GAME…" />;
  if (!game) return <NoGame />;

  return (
    // `scoring-page` is KEPT in both looks: it carries the desktop-density rule (§A2, do
    // not change). v2 adds `data-st-page` and drops the nested `.terminal-theme` — the
    // shell root already carries it, and a second one paints its own CRT overlay.
    // `data-st-motion="off"` is the console's opt-out from the shared mount-fade: §A2
    // forbids any settling animation here, and the incoming motion layer would otherwise
    // fade the control line, the round selector and both fixed boxes on every remount.
    // The rule that reads it lives in staff-tokens-v2.css §7.
    <div
      className={cx(!v2 && "terminal-theme", "scoring-page")}
      {...(v2 ? { "data-st-page": "", "data-st-motion": "off" } : null)}
      style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 32px)", ...(v2 ? null : { fontFamily: "'VT323','Share Tech Mono',monospace" }) }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header + nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h1 className={cx(v2 && "st-display st-t1")} style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, lineHeight: 1 }}>SCORING</h1>
            <div className={cx(v2 && "st-body st-t2")} style={{ fontSize: 20, opacity: v2 ? 1 : 0.7 }}>{game.game_date} · [{game.status.toUpperCase()}]{game.is_playoff ? " · ★ PLAYOFF" : ""}</div>
          </div>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {/* Clock + START lead the nav row (owner refinement 2026-07-22 — "an obvious spot
                to slot it in"). START = start the clock + mark active (scoring + arm resolver
                need it); it does NOT touch the screens — arming is manual. Disabled once active. */}
            <GameClock startedAt={display.state?.clock_started_at ?? null} running={game.status === "active" || game.status === "paused"} />
            <StatusButton
              label="▶ START"
              active={!!display.state?.clock_started_at}
              disabled={!!display.state?.clock_started_at}
              onClick={() => {
                // START = start the game clock (its only job). Also mark the game active so
                // scoring + the arm resolver work. Gated on the CLOCK, not game.status — a game
                // can already be 'active' with the clock never started (a walk-back / a game
                // started before this field existed), and the host must still be able to start it.
                setStatus.mutate("active");
                display.write.mutate({ clock_started_at: new Date().toISOString() });
              }}
            />
            <div style={{ width: 1, alignSelf: "stretch", background: v2 ? "rgba(255,255,255,0.16)" : "var(--terminal-green)", opacity: v2 ? 1 : 0.3, margin: "0 4px" }} />
            <Link to={`/game/${game.id}/questions`} className={cx("u-btn", v2 && "st-body")} style={linkBtn}>QUESTIONS</Link>
            <Link to={`/game/${game.id}/videos`} className={cx("u-btn", v2 && "st-body")} style={linkBtn}>VIDEOS</Link>
            <Link to={`/game/${game.id}/bulk-import`} className={cx("u-btn", v2 && "st-body")} style={linkBtn}>IMPORT</Link>
            <Link to="/teams" className={cx("u-btn", v2 && "st-body")} style={linkBtn}>TEAMS</Link>
            <Link to="/game/history" className={cx("u-btn", v2 && "st-body")} style={linkBtn}>HISTORY</Link>
            {/* ⧉ PREVIEW pops the dual-board /game/preview window — what the two bar screens
                would show (holding while not started, live once active), independent of the arm gate. */}
            <button type="button" onClick={() => window.open(`/game/preview?game=${game.id}`, "bunker-screen-preview", "width=1600,height=900")} className={cx(v2 && "st-body")} style={btnGhost}>⧉ PREVIEW</button>
          </nav>
        </div>
        <div className="terminal-separator" style={{ margin: 0 }} />

        {/* PUT TRIVIA ON SCREENS — 3-state arm control + END GAME (which also disarms).
            Unmissable so nobody forgets to arm trivia onto the bar TVs on a real night. */}
        <TriviaScreensBar gameStatus={game.status} onEndGame={() => setConfirmEnd(true)} />

        {/* Control line: the two INDEPENDENT single-select controls — DISPLAY (landscape) on
            the left, BOARD (portrait) shifted right. Wraps on narrow. (Clock + START moved up
            into the nav row.) */}
        {/* The control line is the one grouped panel on the page — surface-2 in v2 (§A2). */}
        <div className={cx("terminal-border", v2 && "st-panel")} style={{ padding: 12, display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          {display.state && <DisplayStageControl state={display.state} write={display.write} loadedRound={selectedRound} />}
          {display.state && <BoardStageControl state={display.state} write={display.write} />}
        </div>

        {/* Question projector + answer key (SCORE ROUND reveals the loaded round's answers) */}
        <QuestionPanel
          gameId={game.id}
          rounds={scores.rounds}
          currentRound={selectedRound}
          onSelectRound={setSelectedRoundId}
          state={display.state}
          write={display.write}
        />

        {/* The grid */}
        {scores.isPending ? (
          <div className={cx(v2 && "st-body st-t2")} style={{ opacity: v2 ? 1 : 0.6, fontSize: 24 }}>LOADING SCORES…</div>
        ) : (
          <RoundGrid
            teams={scores.teams}
            rounds={scores.rounds}
            scores={scores.scores}
            mutations={scores}
            onAddTeam={() => setAddingTeam(true)}
            onEditTeam={(t) => setEditing({ id: t.id, name: t.name, is_regular: t.is_regular, logo_url: t.logo_url })}
            onRemoveTeam={setRemoving}
            onClearAll={() => setConfirmClear(true)}
          />
        )}
      </div>

      {/* Dialogs */}
      {addingTeam && (
        <AddTeamPicker
          teamsInGame={new Set(scores.teams.map((t) => t.id))}
          regularTeams={scores.regularTeams}
          onAddExisting={(teamId, displayName) => scores.addExistingTeam.mutate({ teamId, displayName }, { onSuccess: () => setAddingTeam(false) })}
          onClose={() => setAddingTeam(false)}
          onCreated={(teamId) => scores.addExistingTeam.mutate({ teamId, displayName: null }, { onSuccess: () => setAddingTeam(false) })}
        />
      )}

      {editing && (
        <TeamEditorDialog
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { scores.invalidateAll(); setEditing(null); }}
        />
      )}

      {/* The three destructive confirms. In v2 they go through the shared ConfirmDialog —
          verb-named buttons, CANCEL focused on mount, red spent only on the destructive
          half (D1). Their TRIGGER buttons on the page keep their exact copy and position
          (§A2 / letter E1); only the sheet the trigger opens changes. */}
      {removing && v2 && (
        <ConfirmDialog
          danger
          busy={scores.removeTeam.isPending}
          title={`Remove ${removing.name} from this game?`}
          confirmLabel="REMOVE TEAM"
          cancelLabel="KEEP TEAM"
          onCancel={() => setRemoving(null)}
          onConfirm={doRemoveTeam}
          body="Their scores for this game will be deleted. The team itself stays on the roster."
        />
      )}

      {confirmClear && v2 && (
        <ConfirmDialog
          danger
          busy={scores.clearAllScores.isPending}
          title="Clear every score in this game?"
          confirmLabel="CLEAR EVERYTHING"
          cancelLabel="KEEP SCORES"
          onCancel={() => setConfirmClear(false)}
          onConfirm={doClearAll}
          body="This deletes every score in this game and resets all wildcards. It cannot be undone."
        />
      )}

      {confirmEnd && v2 && (
        <ConfirmDialog
          danger
          title="End this game?"
          confirmLabel="END GAME"
          cancelLabel="KEEP PLAYING"
          onCancel={() => setConfirmEnd(false)}
          onConfirm={endGame}
          body="It marks the game complete, shows GAME OVER on the displays and takes trivia off the bar screens. The game moves to History."
        />
      )}

      {removing && !v2 && (
        <Modal
          title="REMOVE TEAM"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" onClick={() => setRemoving(null)} style={btnGhost}>CANCEL</button>
              <button type="button" onClick={doRemoveTeam} style={btnDanger}>REMOVE</button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>Remove <strong>{removing.name}</strong> from this game? Their scores for this game will be deleted.</p>
        </Modal>
      )}

      {confirmClear && !v2 && (
        <Modal
          title="CLEAR ALL SCORES"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmClear(false)} style={btnGhost}>CANCEL</button>
              <button type="button" onClick={doClearAll} style={btnDanger}>CLEAR EVERYTHING</button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>This deletes every score in this game and resets all wildcards. This cannot be undone.</p>
        </Modal>
      )}

      {confirmEnd && !v2 && (
        <Modal
          title="END GAME"
          onClose={() => setConfirmEnd(false)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmEnd(false)} style={btnGhost}>CANCEL</button>
              <button
                type="button"
                onClick={endGame}
                style={btnDanger}
              >
                END GAME
              </button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>Mark this game complete and show GAME OVER on the displays? It moves to History.</p>
        </Modal>
      )}
    </div>
  );
}

/* ── Add-team picker (choose an existing regular, or create a new team) ───────── */

function AddTeamPicker({
  teamsInGame,
  regularTeams,
  onAddExisting,
  onCreated,
  onClose,
}: {
  teamsInGame: Set<string>;
  regularTeams: { id: string; name: string }[];
  onAddExisting: (teamId: string, displayName: string | null) => void;
  onCreated: (teamId: string) => void;
  onClose: () => void;
}) {
  const v2 = useTriviaV2();
  const [creating, setCreating] = useState(false);
  const [pick, setPick] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TeamHit[]>([]);
  const available = regularTeams.filter((t) => !teamsInGame.has(t.id));

  // Walk-up escape hatch (docs/05): the host can find ANY venue team by name —
  // not just regulars — to check in a phoneless crew. Host bypasses membership.
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setHits([]); return; }
      try {
        const r = await searchTeams(q);
        if (!cancelled) setHits(r.filter((h) => !teamsInGame.has(h.id)));
      } catch { /* ignore */ }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, teamsInGame]);

  if (creating) {
    return (
      <TeamEditorDialog
        mode="add"
        onClose={onClose}
        onSaved={onCreated}
        // Duplicate-name guard (owner beat 2026-07-22): if the typed name normalizes to an
        // existing ACTIVE team, USE EXISTING adds THAT team to the game (reusing the add-
        // existing path) instead of creating a duplicate. Already in this game → just close.
        onUseExisting={(t) => {
          if (teamsInGame.has(t.id)) { onClose(); return; }
          onAddExisting(t.id, t.name);
        }}
      />
    );
  }

  return (
    <Modal
      title="ADD TEAM TO GAME"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => setCreating(true)} className={cx(v2 && "st-body")} style={btnGhost}>+ CREATE NEW TEAM</button>
          <button type="button" disabled={!pick} onClick={() => { const t = available.find((x) => x.id === pick); onAddExisting(pick, t?.name ?? null); }} className={cx(v2 && "st-btn-primary st-body")} style={btnPrimary}>ADD</button>
        </>
      }
    >
      <Field label="EXISTING REGULAR TEAM">
        {available.length === 0 ? (
          <div className={cx(v2 && "st-body st-t2")} style={{ opacity: v2 ? 1 : 0.6, fontSize: 20 }}>All regular teams are already in the game — search below or create a new one.</div>
        ) : (
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={input}>
            <option value="">— select —</option>
            {available.map((t) => (
              <option key={t.id} value={t.id} style={{ background: "#000" }}>{t.name}</option>
            ))}
          </select>
        )}
      </Field>

      <Field label="OR SEARCH ANY TEAM (WALK-UP)">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="type a team name…" style={input} />
        {hits.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            {hits.map((h) => (
              <button key={h.id} type="button" onClick={() => onAddExisting(h.id, h.name)}
                className={cx(v2 && "st-body")}
                style={{ ...btnGhost, textAlign: "left", justifyContent: "flex-start" }}>
                {h.name}{h.is_regular ? "  ★" : ""}
              </button>
            ))}
          </div>
        )}
        {q.trim().length >= 2 && hits.length === 0 && (
          <div className={cx(v2 && "st-body st-t2")} style={{ opacity: v2 ? 1 : 0.6, fontSize: 18, marginTop: 6 }}>No teams match “{q}”.</div>
        )}
      </Field>
    </Modal>
  );
}

/* ── PUT TRIVIA ON SCREENS — 3-state arm control + screen preview (trivia-sandbox) ──
 *
 * The bar TVs are a SANDBOX BY DEFAULT (0056): a game runs for scoring without touching
 * the screens. The host EXPLICITLY ARMS trivia to put it on the bar TVs; the state is
 * then automatic:
 *   OFF              — not armed → the bar TVs are on their normal rotation/media.
 *   ARMED · HOLDING  — armed, game not yet started → the pre-game SCAN-TO-JOIN board.
 *   LIVE ON SCREENS  — armed, game started (active/paused) → the live trivia board.
 * Arm/disarm writes via set_trivia_screens_armed (has_module('trivia')-gated); state is
 * realtime. Made prominent so nobody forgets to arm on a real night.
 *
 * OPEN SCREEN PREVIEW pops a self-contained /game/preview window (both boards side by
 * side) that ALWAYS shows the game regardless of the arm flag — "what would come out"
 * (holding while not started, live once active).
 */
function TriviaScreensBar({ gameStatus, onEndGame }: { gameStatus?: GameStatus | null; onEndGame?: () => void }) {
  const qc = useQueryClient();
  const v2 = useTriviaV2();
  const eff = useTriviaArmedEffective();
  const armed = eff.armed; // EFFECTIVE (nightly-expiry applied) — a stale arm auto-reads OFF
  const started = gameStatus === "active" || gameStatus === "paused";

  // The four visible states — including "armed but no game loaded" so the arm is NEVER invisible
  // (WARN-1 #4). A setup game → holding; active/paused → live; armed with no game → armed-idle.
  const state: "off" | "holding" | "live" | "armed-nogame" =
    !armed ? "off" : started ? "live" : gameStatus === "setup" ? "holding" : "armed-nogame";

  const setArmed = useMutation({
    mutationFn: async (next: boolean) => {
      const { error } = await supabase.rpc("set_trivia_screens_armed", { p_venue_id: VENUE_ID, p_armed: next });
      if (error) throw error;
      return next;
    },
    // Optimistic flip so the control feels instant; the realtime invalidation confirms it. Write the
    // object shape (0057) so the optimistic value matches what the RPC stores.
    onSuccess: (next) => {
      qc.setQueryData(["signage", "triviaScreensArmed"], { armed: next, at: next ? new Date().toISOString() : null });
      qc.invalidateQueries({ queryKey: ["signage", "triviaScreensArmed"] });
    },
  });

  // Green when trivia is on the screens (holding, live, or armed-idle); amber warning when OFF.
  const onScreens = armed;
  const label =
    state === "live" ? "● LIVE ON SCREENS"
    : state === "holding" ? "◐ ARMED · HOLDING (PRE-GAME)"
    : state === "armed-nogame" ? "◐ ARMED · NO GAME LOADED"
    : "○ OFF — NOT ON SCREENS";

  return (
    // v2: the bar keeps its position, wording and unmissable sizing (§A2). The 2px
    // amber/green rectangle becomes the token callout — amber-soft when OFF, a plain
    // panel when trivia IS on the screens — and the state line is the ONE place in
    // trivia that spends the reserved full-saturation green (`st-live`), and only when
    // the boards are genuinely LIVE. ARMED-but-not-started stays amber-calm: armed is
    // pending, not live.
    <div
      className={cx(!onScreens && "u-amber", v2 && (onScreens ? "st-panel" : "st-callout-warn"))}
      style={{
        display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center",
        padding: "10px 14px",
        border: v2
          ? "1px solid rgba(255,255,255,0.16)"
          : `2px solid ${onScreens ? "var(--terminal-green)" : "var(--terminal-amber, #ffb000)"}`,
        ...(v2 ? null : { background: onScreens ? "transparent" : "rgba(255,176,0,0.08)" }),
      }}
    >
      <span className={cx(v2 && "st-label st-t2")} style={{ fontSize: 20, letterSpacing: 1, opacity: v2 ? 1 : 0.85 }}>BAR SCREENS:</span>
      <span
        style={{ fontSize: 24, fontWeight: 700, letterSpacing: 1 }}
        className={cx(
          !onScreens && "u-amber",
          v2 && "st-heading",
          v2 && (state === "live" ? "st-live" : onScreens ? "st-amber" : undefined),
        )}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={() => setArmed.mutate(!armed)}
        disabled={setArmed.isPending || eff.isPending}
        title={armed ? "Take trivia off the bar TVs — they return to normal rotation/media." : "Put trivia on the bar TVs — shows the SCAN-TO-JOIN board until the game starts, then the live board."}
        className={cx(v2 && (armed ? "st-btn-danger" : "st-btn-primary"))}
        // DELIBERATELY LOUDER THAN THE BODY ROLE: this pair (and END GAME below) render
        // at 18px against the 15px everywhere else, because §A2 protects the arm bar's
        // "unmissable" sizing — these are the two controls that seize or release the
        // room's TVs. Do not normalise them onto the Body role in a later pass.
        style={{
          ...(armed ? btnDanger : btnPrimary),
          minHeight: 44, fontSize: 22, fontWeight: 700, letterSpacing: 1,
          opacity: setArmed.isPending || eff.isPending ? 0.5 : 1,
        }}
      >
        {armed ? "TAKE TRIVIA OFF SCREENS" : "PUT TRIVIA ON SCREENS"}
      </button>
      {/* END GAME lives here (owner rebuild 2026-07-22) — ending the game also DISARMS the bar
          TVs, so it belongs in the arm anchor. Only rendered when there is a game to end. */}
      {onEndGame && (
        <>
          <div style={{ flex: 1, minWidth: 12 }} />
          <button type="button" onClick={onEndGame} className={cx(v2 && "st-btn-danger")} style={{ ...btnDanger, minHeight: 44, fontWeight: 700 }}>END GAME</button>
        </>
      )}
    </div>
  );
}

/* ── Game clock (host UI, 0060) ───────────────────────────────────────────────
 * Counts UP from clock_started_at (persisted, so it survives a reload). Ticks on a
 * local 1s timer — a HOST tool clock, not an audience display, so the display
 * no-infinite-animation / no-sub-30s-poll rules (which govern the TVs) don't apply.
 * `running` (game active/paused) drives the tick; a completed game freezes the last
 * value rather than counting forever, and a null start shows 0:00. */
function GameClock({ startedAt, running }: { startedAt: string | null; running: boolean }) {
  const v2 = useTriviaV2();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, startedAt]);

  const startMs = startedAt ? new Date(startedAt).getTime() : null;
  const elapsed = startMs != null && Number.isFinite(startMs) ? Math.max(0, nowMs - startMs) : null;

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }} title="Game clock — counts up from START">
      <span className={cx(v2 && "st-label st-t2")} style={{ fontSize: 16, opacity: v2 ? 1 : 0.6, letterSpacing: 1 }}>CLOCK</span>
      {/* The clock keeps its 34px inline size in BOTH looks: it is read across a room-lit
          host desk and `st-mono` would drop it to 15px. Only its ink moves. */}
      <span className={cx(v2 && "st-t1")} style={{ fontSize: 34, fontWeight: 700, letterSpacing: 2, fontVariantNumeric: "tabular-nums", minWidth: 96 }}>
        {elapsed == null ? "0:00" : formatElapsed(elapsed)}
      </span>
    </div>
  );
}

/** Elapsed ms → M:SS, rolling to H:MM:SS past an hour. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/* ── small bits ──────────────────────────────────────────────────────────────── */

function StatusButton({ label, active, onClick, disabled }: { label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  const v2 = useTriviaV2();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(v2 && "st-body", v2 && active && "st-btn-primary")}
      style={{ ...(active ? btnActive : btnGhost), opacity: disabled ? 0.4 : 1, minHeight: 44 }}
    >
      {label}
    </button>
  );
}

const linkBtn: React.CSSProperties = { ...btnGhost, textDecoration: "none", display: "inline-block" };

function Centered({ text }: { text: string }) {
  const v2 = useTriviaV2();
  return (
    <div
      className={cx(!v2 && "terminal-theme", v2 && "st-body st-t2")}
      {...(v2 ? { "data-st-page": "" } : null)}
      style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, ...(v2 ? null : { fontFamily: "'VT323','Share Tech Mono',monospace" }) }}
    >
      {text}
    </div>
  );
}

function NoGame() {
  const v2 = useTriviaV2();
  return (
    <div
      className={cx(!v2 && "terminal-theme")}
      {...(v2 ? { "data-st-page": "" } : null)}
      style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "clamp(16px, 4vw, 32px)", ...(v2 ? null : { fontFamily: "'VT323','Share Tech Mono',monospace" }) }}
    >
      <div className={cx("terminal-border", v2 && "st-panel")} style={{ width: "min(560px, 100%)", padding: "28px 28px 32px", display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Persistent armed indicator (WARN-1 #4): even with no game loaded, a stale arm must be
            visible + disarmable. Shows OFF / ARMED · NO GAME LOADED (auto-expires nightly). */}
        <TriviaScreensBar gameStatus={null} />
        <div>
          <div className={cx(v2 && "st-display st-t1")} style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2, lineHeight: 1 }}>NO GAME TONIGHT</div>
          <div className={cx(v2 && "st-body st-t2")} style={{ fontSize: 22, opacity: v2 ? 1 : 0.7, marginTop: 6 }}>No game is set up to score. Here's how to get one running:</div>
        </div>
        <div className="terminal-separator" style={{ margin: 0 }} />

        <ol className={cx(v2 && "st-body")} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          <Step n={1} title="CREATE THE GAME">
            {/* The textless-button bug lived here: this CTA is an <a> (React Router Link)
                carrying btnPrimary's green fill, but `.terminal-theme a` forces the label
                green too — green-on-green = an invisible label (looked like an empty
                button). `u-fill u-ink` restores the black-on-green fill (0,2,0 beats the
                theme's 0,1,1 !important), same pattern as the Dashboard CTAs. */}
            {/* v2 asks for the accent fill by class; `u-fill u-ink` is the classic idiom. */}
            <Link to="/game/setup" className={cx(v2 ? "st-btn-primary st-body" : "u-fill u-ink")} style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>+ CREATE GAME →</Link>
          </Step>
          <Step n={2} title="ADD OR BULK-IMPORT QUESTIONS">
            {/* DECISION: /game/:id/bulk-import needs a game id, so there's no pre-game
                deep link — questions/rounds are added on GameSetup once the game exists.
                We point back to Game Setup rather than dead-linking a bulk-import route. */}
            <Link to="/game/setup" className={cx("u-btn", v2 && "st-body")} style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>GAME SETUP →</Link>
            <span className={cx(v2 && "st-body st-t2")} style={{ fontSize: 18, opacity: v2 ? 1 : 0.6 }}>Build rounds, then type questions or BULK IMPORT them.</span>
          </Step>
          <Step n={3} title="CHECK TEAMS IN">
            <Link to="/teams" className={cx("u-btn", v2 && "st-body")} style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>MANAGE TEAMS →</Link>
            <span className={cx(v2 && "st-body st-t2")} style={{ fontSize: 18, opacity: v2 ? 1 : 0.6 }}>Regulars carry over; walk-ups check in from the grid.</span>
          </Step>
        </ol>
      </div>
    </div>
  );
}

/** One numbered row in the NO GAME TONIGHT setup path. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const v2 = useTriviaV2();
  return (
    <li style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <span className={cx("u-fill u-ink", v2 && "st-mono")} style={{ flexShrink: 0, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 700 }}>{n}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <span className={cx(v2 && "st-heading st-t1")} style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>{title}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>{children}</div>
      </div>
    </li>
  );
}
