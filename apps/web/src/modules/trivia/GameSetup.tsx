import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { log } from "@/shared/log";
import { useIsMobile } from "@/shared/useIsMobile";

/**
 * Create Game — host tool (docs/01 route map, host+; /game/setup). Ported from the
 * legacy GameSetup.tsx. Creates a game + its rounds (regular, final, bonus) and
 * optionally pre-selects participating teams.
 *
 * DECISIONS (docs/02 schema vs legacy):
 *  - games has no `name` / `num_rounds`: a game is identified by game_date; the
 *    round count is a form field that generates the rounds rows, not a stored column.
 *  - start_time is a timestamptz (legacy stored an HH:MM string) — the time field is
 *    combined with game_date into a full timestamp for the holding-screen countdown.
 *  - season_id is left null in Phase 1 (seasons feature is Phase 4).
 *  - The legacy "add new team" dialog is deferred: team + PIN creation belongs to
 *    Registration v2 (Phase 2); here you optionally pre-select existing regular teams
 *    (walk-ups join at check-in). Edit/duplicate modes are deferred with the host tools.
 */

interface BonusQuestion {
  id: string;
  description: string;
  afterRound: number;
  points: number;
  bonusType: "standard" | "three-chance";
  roundNumbers?: number[];
  pointsPerRound?: number[];
}

interface Team {
  id: string;
  name: string;
  is_regular: boolean;
}

function todayISO(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export function GameSetup() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [gameDate, setGameDate] = useState(todayISO());
  const [numRounds, setNumRounds] = useState(6); // owner: the weekly deck is always 5 regular + picture-round final
  const [questionsPerRound, setQuestionsPerRound] = useState(10);
  const [startTime, setStartTime] = useState("");
  const [isPlayoff, setIsPlayoff] = useState(false);
  const [bonusQuestions, setBonusQuestions] = useState<BonusQuestion[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const regularTeams = useQuery({
    queryKey: ["setup", "regularTeams"],
    queryFn: async (): Promise<Team[]> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, is_regular")
        .eq("venue_id", VENUE_ID)
        .eq("is_regular", true)
        .eq("archived", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Team[];
    },
  });

  const createGame = useMutation({
    mutationFn: async () => {
      // One live game at a time: retire any active/paused games first (legacy parity).
      await supabase
        .from("games")
        .update({ status: "completed" })
        .eq("venue_id", VENUE_ID)
        .in("status", ["active", "paused"]);

      const startTs = startTime ? new Date(`${gameDate}T${startTime}`).toISOString() : null;

      const { data: game, error: gameError } = await supabase
        .from("games")
        .insert({
          venue_id: VENUE_ID,
          game_date: gameDate,
          status: "setup",
          questions_per_round: questionsPerRound,
          is_playoff: isPlayoff,
          start_time: startTs,
        })
        .select("id")
        .single();
      if (gameError) throw gameError;
      const gameId = game.id as string;
      log("[GameSetup] created game", gameId);

      // Rounds: 1..numRounds (last is the final round), then bonus rounds appended.
      const rounds: Record<string, unknown>[] = [];
      for (let i = 1; i <= numRounds; i++) {
        rounds.push({
          game_id: gameId,
          round_number: i,
          round_type: i === numRounds ? "final" : "regular",
          max_points: questionsPerRound,
        });
      }
      bonusQuestions.forEach((b, idx) => {
        const row: Record<string, unknown> = {
          game_id: gameId,
          round_number: numRounds + idx + 1,
          round_type: "bonus",
          max_points: b.points,
          bonus_description: b.description,
          after_round: b.afterRound,
          bonus_type: b.bonusType,
        };
        if (b.bonusType === "three-chance") {
          row.bonus_round_numbers = b.roundNumbers ?? null;
          row.bonus_points_per_round = b.pointsPerRound ?? null;
        }
        rounds.push(row);
      });
      const { error: roundsError } = await supabase.from("rounds").insert(rounds);
      if (roundsError) throw roundsError;

      if (selectedTeams.size > 0) {
        const { error: teamsError } = await supabase
          .from("game_teams")
          .insert([...selectedTeams].map((team_id) => ({ game_id: gameId, team_id })));
        if (teamsError) throw teamsError;
      }

      // Seed a display-state row so the displays have something to read. A fresh game
      // opens on the JOIN QR stage on BOTH boards so the room sees the check-in code until
      // the host flips them (0038 board_stage + 0060 display_stage; after this seed, only
      // the Scoring BOARD / DISPLAY controls ever change them).
      await supabase
        .from("game_display_state")
        .insert({ game_id: gameId, is_display_active: false, board_stage: "qr", display_stage: "qr" });

      return gameId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["history"] });
      qc.invalidateQueries({ queryKey: ["leaderboard"] });
      navigate("/game/history");
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Failed to create game"),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (numRounds < 1) return setError("Need at least one round.");
    createGame.mutate();
  };

  const addBonus = () =>
    setBonusQuestions((b) => [
      ...b,
      { id: Math.random().toString(36).slice(2), description: "", afterRound: 2, points: 3, bonusType: "standard" },
    ]);
  const removeBonus = (id: string) => setBonusQuestions((b) => b.filter((q) => q.id !== id));
  const patchBonus = (id: string, patch: Partial<BonusQuestion>) =>
    setBonusQuestions((b) => b.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  const teams = regularTeams.data ?? [];
  const narrow = useIsMobile();

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 40px)", fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
          <h1 style={{ fontSize: 44, fontWeight: 700, letterSpacing: 2 }}>CREATE GAME</h1>
          <button type="button" onClick={() => navigate("/dashboard")} style={btnGhost}>← DASHBOARD</button>
        </div>
        <div className="terminal-separator" style={{ marginBottom: 24 }} />

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <Section title="GAME SETTINGS">
            <Row>
              <Field label="GAME DATE *">
                <input type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} required style={input} />
              </Field>
              <Field label="START TIME (OPTIONAL)">
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={input} />
              </Field>
            </Row>
            <Row>
              <Field label="NUMBER OF ROUNDS *">
                <input type="number" min={1} max={20} value={numRounds} onChange={(e) => setNumRounds(parseInt(e.target.value) || 1)} required style={input} />
              </Field>
              <Field label="QUESTIONS PER ROUND *">
                <input type="number" min={1} max={20} value={questionsPerRound} onChange={(e) => setQuestionsPerRound(parseInt(e.target.value) || 1)} required style={input} />
              </Field>
            </Row>
            <label style={checkRow}>
              <input type="checkbox" checked={isPlayoff} onChange={(e) => setIsPlayoff(e.target.checked)} />
              <span>PLAYOFF GAME (excluded from regular-season standings)</span>
            </label>
            <div style={{ fontSize: 20, opacity: 0.6 }}>
              The last round is the FINAL round. Start time sets the holding-screen countdown.
            </div>
          </Section>

          <Section
            title="BONUS QUESTIONS"
            action={<button type="button" onClick={addBonus} style={btnGhost}>+ ADD BONUS</button>}
          >
            {bonusQuestions.length === 0 ? (
              <div style={{ fontSize: 22, opacity: 0.6 }}>No bonus questions added.</div>
            ) : (
              bonusQuestions.map((b) => (
                <div key={b.id} className="terminal-border" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", gap: 12 }}>
                    <input
                      placeholder="Bonus description"
                      value={b.description}
                      onChange={(e) => patchBonus(b.id, { description: e.target.value })}
                      style={{ ...input, flex: 1 }}
                    />
                    <button type="button" onClick={() => removeBonus(b.id)} style={btnGhost}>✕</button>
                  </div>
                  <label style={checkRow}>
                    <input
                      type="checkbox"
                      checked={b.bonusType === "three-chance"}
                      onChange={(e) =>
                        patchBonus(b.id, e.target.checked
                          ? { bonusType: "three-chance", roundNumbers: [b.afterRound, b.afterRound + 1, b.afterRound + 2], pointsPerRound: [b.points, Math.max(1, b.points - 1), Math.max(1, b.points - 2)] }
                          : { bonusType: "standard", roundNumbers: undefined, pointsPerRound: undefined })
                      }
                    />
                    <span>THREE-CHANCE (one answer across 3 rounds, decreasing points)</span>
                  </label>
                  {b.bonusType === "three-chance" ? (
                    <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
                      {[0, 1, 2].map((idx) => (
                        <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ fontSize: 18, opacity: 0.7 }}>OPTION {idx + 1}</span>
                          <input type="number" min={1} max={numRounds} placeholder="Round #" value={b.roundNumbers?.[idx] ?? ""} onChange={(e) => { const r = [...(b.roundNumbers ?? [1, 2, 3])]; r[idx] = parseInt(e.target.value) || 1; patchBonus(b.id, { roundNumbers: r }); }} style={input} />
                          <input type="number" min={1} placeholder="Pts" value={b.pointsPerRound?.[idx] ?? ""} onChange={(e) => { const p = [...(b.pointsPerRound ?? [5, 4, 3])]; p[idx] = parseInt(e.target.value) || 1; patchBonus(b.id, { pointsPerRound: p }); }} style={input} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Row>
                      <Field label="AFTER ROUND">
                        <input type="number" min={1} max={numRounds} value={b.afterRound} onChange={(e) => patchBonus(b.id, { afterRound: parseInt(e.target.value) || 1 })} style={input} />
                      </Field>
                      <Field label="POINTS">
                        <input type="number" min={1} value={b.points} onChange={(e) => patchBonus(b.id, { points: parseInt(e.target.value) || 1 })} style={input} />
                      </Field>
                    </Row>
                  )}
                </div>
              ))
            )}
          </Section>

          <Section title="REGULAR TEAMS (OPTIONAL)">
            <div style={{ fontSize: 20, opacity: 0.6, marginBottom: 8 }}>
              Pre-select regulars; walk-ups join at check-in (Phase 2).
            </div>
            {regularTeams.isPending ? (
              <div style={{ fontSize: 22, opacity: 0.6 }}>LOADING…</div>
            ) : teams.length === 0 ? (
              <div style={{ fontSize: 22, opacity: 0.6 }}>No regular teams yet.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
                {teams.map((t) => (
                  <label key={t.id} className="terminal-border" style={{ ...checkRow, padding: "8px 12px" }}>
                    <input
                      type="checkbox"
                      checked={selectedTeams.has(t.id)}
                      onChange={() =>
                        setSelectedTeams((s) => {
                          const n = new Set(s);
                          n.has(t.id) ? n.delete(t.id) : n.add(t.id);
                          return n;
                        })
                      }
                    />
                    <span>{t.name}</span>
                  </label>
                ))}
              </div>
            )}
          </Section>

          {error && <div className="terminal-border" style={{ padding: 12, fontSize: 22 }}>⚠ {error}</div>}

          <div style={{ display: "flex", gap: 16 }}>
            <button type="submit" disabled={createGame.isPending} style={{ ...btnPrimary, flex: 1 }}>
              {createGame.isPending ? "CREATING…" : "CREATE GAME"}
            </button>
            <button type="button" onClick={() => navigate("/dashboard")} style={btnGhost}>CANCEL</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Small presentational helpers ──────────────────────────────────────────── */

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="terminal-border" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: 1 }}>{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  // Two-up on desktop; stack on phones so date/time inputs (which enforce a browser
  // minimum width larger than a cramped 1fr column) don't force page overflow.
  const narrow = useIsMobile();
  return <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 20, opacity: 0.8 }}>{label}</span>
      {children}
    </div>
  );
}

const input: React.CSSProperties = {
  background: "#000",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "8px 10px",
  fontSize: 22,
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--terminal-green)",
  color: "#000",
  border: "1px solid var(--terminal-green)",
  padding: "12px 20px",
  fontSize: 26,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "8px 14px",
  fontSize: 22,
  cursor: "pointer",
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const checkRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  fontSize: 22,
  cursor: "pointer",
  minHeight: 44, // whole label row is a ≥44px tap target (Phase 4c)
  padding: "4px 0",
};
