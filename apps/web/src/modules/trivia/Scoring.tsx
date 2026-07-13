import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { VideoControls } from "./VideoControls";
import { LeaderboardToggle } from "./LeaderboardToggle";
import { TeamEditorDialog, type EditableTeam } from "./TeamEditorDialog";
import { Modal, Field, input, btnGhost, btnPrimary, btnActive, btnDanger } from "./ui";
import { searchTeams, type TeamHit } from "../registration/useCheckin";

/**
 * Scoring console — host tool (docs/01 /scoring, host+). Ported from the legacy
 * 3,285-line Scoring.tsx and decomposed per docs/04 ARCH-2 into RoundGrid /
 * QuestionPanel / VideoControls / LeaderboardToggle / TeamEditorDialog + the hooks in
 * useScoring.ts. This file is just the composition + game-status controls + team-editor
 * plumbing. Behaviour matches legacy to the extent our schema carries it (see the
 * DECISIONs in useScoring.ts — no game clock, no scoring_in_progress interstitial).
 */
export function Scoring() {
  const [params] = useSearchParams();
  const override = params.get("game");

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

  // The round being played = first incomplete non-bonus round, else the last one.
  const playRound = useMemo(() => cols.find((r) => !r.is_complete) ?? cols[cols.length - 1] ?? null, [cols]);
  const selectedRound: Round | null = useMemo(() => {
    const byId = selectedRoundId ? scores.rounds.find((r) => r.id === selectedRoundId) : null;
    return byId ?? playRound;
  }, [selectedRoundId, scores.rounds, playRound]);

  // Answer key = the most recent completed non-bonus round before the selected one.
  const answerKeyRound = useMemo(() => {
    if (!selectedRound) return null;
    const before = cols.filter((r) => r.round_number < selectedRound.round_number && r.is_complete);
    return before[before.length - 1] ?? null;
  }, [cols, selectedRound]);

  if (gameQuery.isPending) return <Centered text="LOADING GAME…" />;
  if (!game) return <NoGame />;

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 32px)", fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Header + nav */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: 2 }}>SCORING</h1>
            <div style={{ fontSize: 22, opacity: 0.7 }}>{game.game_date} · [{game.status.toUpperCase()}]{game.is_playoff ? " · ★ PLAYOFF" : ""}</div>
          </div>
          <nav style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link to="/dashboard" style={linkBtn}>DASHBOARD</Link>
            <Link to={`/game/${game.id}/questions`} style={linkBtn}>QUESTIONS</Link>
            <Link to={`/game/${game.id}/videos`} style={linkBtn}>VIDEOS</Link>
            <Link to={`/game/${game.id}/bulk-import`} style={linkBtn}>IMPORT</Link>
            <Link to="/teams" style={linkBtn}>TEAMS</Link>
            <Link to="/history" style={linkBtn}>HISTORY</Link>
            <button type="button" onClick={() => window.open(`/game-display?game=${game.id}`, "_blank")} style={btnGhost}>⧉ DISPLAY</button>
          </nav>
        </div>
        <div className="terminal-separator" />

        {/* Game status controls */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <StatusButton label="▶ START" active={game.status === "active"} onClick={() => setStatus.mutate("active")} disabled={game.status === "active"} />
          {game.status === "active" ? (
            <StatusButton label="▮▮ PAUSE" onClick={() => setStatus.mutate("paused")} />
          ) : game.status === "paused" ? (
            <StatusButton label="▶ RESUME" onClick={() => setStatus.mutate("active")} />
          ) : null}
          <StatusButton label="■ STOP" active={game.status === "stopped"} onClick={() => setStatus.mutate("stopped")} />
          <div style={{ flex: 1 }} />
          {display.state && game && <LeaderboardToggle gameId={game.id} state={display.state} write={display.write} />}
          <button type="button" onClick={() => setConfirmEnd(true)} style={btnDanger}>END GAME</button>
        </div>

        {/* Question projector + answer key */}
        <QuestionPanel
          gameId={game.id}
          rounds={scores.rounds}
          currentRound={selectedRound}
          answerKeyRound={answerKeyRound}
          onSelectRound={setSelectedRoundId}
          state={display.state}
          write={display.write}
        />

        {/* Display controls row */}
        <div className="terminal-border" style={{ padding: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 20, opacity: 0.7 }}>DISPLAY:</span>
          <VideoControls currentRound={playRound} state={display.state} toggleVideo={display.toggleVideo} />
          <div style={{ flex: 1 }} />
          <button type="button" onClick={() => setConfirmClear(true)} style={btnDanger}>CLEAR ALL SCORES</button>
        </div>

        {/* The grid */}
        {scores.isPending ? (
          <div style={{ opacity: 0.6, fontSize: 24 }}>LOADING SCORES…</div>
        ) : (
          <RoundGrid
            teams={scores.teams}
            rounds={scores.rounds}
            scores={scores.scores}
            mutations={scores}
            onAddTeam={() => setAddingTeam(true)}
            onEditTeam={(t) => setEditing({ id: t.id, name: t.name, is_regular: t.is_regular, logo_url: t.logo_url })}
            onRemoveTeam={setRemoving}
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

      {removing && (
        <Modal
          title="REMOVE TEAM"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button type="button" onClick={() => setRemoving(null)} style={btnGhost}>CANCEL</button>
              <button type="button" onClick={() => scores.removeTeam.mutate(removing.id, { onSuccess: () => setRemoving(null) })} style={btnDanger}>REMOVE</button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>Remove <strong>{removing.name}</strong> from this game? Their scores for this game will be deleted.</p>
        </Modal>
      )}

      {confirmClear && (
        <Modal
          title="CLEAR ALL SCORES"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmClear(false)} style={btnGhost}>CANCEL</button>
              <button type="button" onClick={() => scores.clearAllScores.mutate(undefined, { onSuccess: () => setConfirmClear(false) })} style={btnDanger}>CLEAR EVERYTHING</button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>This deletes every score in this game and resets all wildcards. This cannot be undone.</p>
        </Modal>
      )}

      {confirmEnd && (
        <Modal
          title="END GAME"
          onClose={() => setConfirmEnd(false)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmEnd(false)} style={btnGhost}>CANCEL</button>
              <button
                type="button"
                onClick={() => {
                  setStatus.mutate("completed" as GameStatus);
                  display.write.mutate({ show_game_over: true, is_display_active: false }, { onSuccess: () => setConfirmEnd(false) });
                }}
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
    return <TeamEditorDialog mode="add" onClose={onClose} onSaved={onCreated} />;
  }

  return (
    <Modal
      title="ADD TEAM TO GAME"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={() => setCreating(true)} style={btnGhost}>+ CREATE NEW TEAM</button>
          <button type="button" disabled={!pick} onClick={() => { const t = available.find((x) => x.id === pick); onAddExisting(pick, t?.name ?? null); }} style={btnPrimary}>ADD</button>
        </>
      }
    >
      <Field label="EXISTING REGULAR TEAM">
        {available.length === 0 ? (
          <div style={{ opacity: 0.6, fontSize: 20 }}>All regular teams are already in the game — search below or create a new one.</div>
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
                style={{ ...btnGhost, textAlign: "left", justifyContent: "flex-start" }}>
                {h.name}{h.is_regular ? "  ★" : ""}
              </button>
            ))}
          </div>
        )}
        {q.trim().length >= 2 && hits.length === 0 && (
          <div style={{ opacity: 0.6, fontSize: 18, marginTop: 6 }}>No teams match “{q}”.</div>
        )}
      </Field>
    </Modal>
  );
}

/* ── small bits ──────────────────────────────────────────────────────────────── */

function StatusButton({ label, active, onClick, disabled }: { label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{ ...(active ? btnActive : btnGhost), opacity: disabled ? 0.4 : 1 }}>
      {label}
    </button>
  );
}

const linkBtn: React.CSSProperties = { ...btnGhost, textDecoration: "none", display: "inline-block" };

function Centered({ text }: { text: string }) {
  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      {text}
    </div>
  );
}

function NoGame() {
  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ fontSize: 40, fontWeight: 700 }}>NO ACTIVE GAME</div>
      <div style={{ fontSize: 24, opacity: 0.7 }}>Create a game to start scoring.</div>
      <Link to="/game/setup" style={{ ...btnPrimary, textDecoration: "none" }}>+ CREATE GAME</Link>
    </div>
  );
}
