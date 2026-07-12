/**
 * Seed-and-assert test for season_leaderboard() — the docs/10 Phase 4 gate.
 * `npx tsx scripts/test-season-leaderboard.ts` (pnpm test:seasons).
 *
 * Seeds a 3-team, 4-game fixture season (service role, bypasses RLS) with hand-computed
 * nightly points, then asserts standings + tiebreaks in ALL THREE scoring modes. Also
 * verifies (a) the auto-enroll trigger stamps season_id, (b) is_playoff games are excluded,
 * (c) a zero-game season returns empty. Cleans up its fixture at the end (always).
 *
 * Fixture nightly points (team C sits out G2, to exercise the games_played tiebreak):
 *   Game | A  | B  | C     places
 *   G1   | 50 | 30 | 20    A1 B2 C3
 *   G2   | 50 | 20 | -     A1 B2
 *   G3   | 10 | 50 | 40    B1 C2 A3
 *   G4   | 20 | 30 | 50    C1 B2 A3
 *   wins:  A=2  B=1  C=1     games_played: A=4 B=4 C=3
 *
 *   cumulative: A=130(2w) B=130(1w) C=110   -> A,B,C   (A>B by WINS tiebreak)
 *   placement [10,6,3]: A=26 B=28 C=19      -> B,A,C   (distinct ordering)
 *   best_n(3): A=120 B=110 C=110            -> A,C,B   (C>B by GAMES_PLAYED tiebreak)
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const VENUE = process.env.VENUE_ID ?? "11111111-1111-1111-1111-111111111111";

const SEASON = "5ea50000-0000-4000-8000-000000000001";
const EMPTY_SEASON = "5ea50000-0000-4000-8000-0000000000ee";
const T = { A: "5ea50000-0000-4000-8000-00000000000a", B: "5ea50000-0000-4000-8000-00000000000b", C: "5ea50000-0000-4000-8000-00000000000c" };
const G = ["5ea50000-0000-4000-8000-0000000000f1", "5ea50000-0000-4000-8000-0000000000f2", "5ea50000-0000-4000-8000-0000000000f3", "5ea50000-0000-4000-8000-0000000000f4"];
const PLAYOFF = "5ea50000-0000-4000-8000-0000000000f9";
const DATES = ["2026-05-06", "2026-05-13", "2026-05-20", "2026-05-27"];
// nightly points per game: [A, B, C|null]
const POINTS: Array<[number, number, number | null]> = [[50, 30, 20], [50, 20, null], [10, 50, 40], [20, 30, 50]];

let failures = 0;
function assert(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got ${g}\n    want ${w}`}`);
}

async function cleanup() {
  await admin.from("scores").delete().in("game_id", [...G, PLAYOFF]);
  await admin.from("game_teams").delete().in("game_id", [...G, PLAYOFF]);
  await admin.from("rounds").delete().in("game_id", [...G, PLAYOFF]);
  await admin.from("games").delete().in("id", [...G, PLAYOFF]);
  await admin.from("teams").delete().in("id", Object.values(T));
  await admin.from("seasons").delete().in("id", [SEASON, EMPTY_SEASON]);
}

async function seed() {
  await cleanup();
  // Seasons: main (best_n default, params for all modes) + an empty one.
  await admin.from("seasons").insert([
    { id: SEASON, venue_id: VENUE, name: "TEST — Circuit", starts_on: "2026-05-01", ends_on: "2026-05-31", scoring_mode: "best_n", best_n: 3, placement_points: [10, 6, 3], playoff_size: 2, status: "active" },
    { id: EMPTY_SEASON, venue_id: VENUE, name: "TEST — Empty", starts_on: "2026-09-01", ends_on: "2026-09-30", scoring_mode: "cumulative", status: "active" },
  ]);
  await admin.from("teams").insert([
    { id: T.A, venue_id: VENUE, name: "TEST Vault A" },
    { id: T.B, venue_id: VENUE, name: "TEST Vault B" },
    { id: T.C, venue_id: VENUE, name: "TEST Vault C" },
  ]);
  // Games inserted WITHOUT season_id — the trigger should stamp it (auto-enroll test).
  await admin.from("games").insert(G.map((id, i) => ({ id, venue_id: VENUE, game_date: DATES[i], status: "completed", is_playoff: false })));
  // A playoff game inside the window — must be EXCLUDED from standings.
  await admin.from("games").insert({ id: PLAYOFF, venue_id: VENUE, game_date: "2026-05-28", status: "completed", is_playoff: true });

  // One round per game; scores = nightly total on that round.
  const rounds = [...G, PLAYOFF].map((gid) => ({ id: gid.replace("f", "e"), game_id: gid, round_number: 1, round_type: "regular", is_complete: true }));
  await admin.from("rounds").insert(rounds);

  const gt: Record<string, unknown>[] = [];
  const scores: Record<string, unknown>[] = [];
  G.forEach((gid, i) => {
    const roundId = gid.replace("f", "e");
    const [a, b, c] = POINTS[i];
    const rows: Array<[string, number | null]> = [[T.A, a], [T.B, b], [T.C, c]];
    for (const [team, pts] of rows) {
      if (pts === null) continue;
      gt.push({ game_id: gid, team_id: team });
      scores.push({ game_id: gid, round_id: roundId, team_id: team, points: pts });
    }
  });
  // Playoff: give C a huge total — must NOT affect standings.
  gt.push({ game_id: PLAYOFF, team_id: T.C });
  scores.push({ game_id: PLAYOFF, round_id: PLAYOFF.replace("f", "e"), team_id: T.C, points: 999 });
  await admin.from("game_teams").insert(gt);
  await admin.from("scores").insert(scores);
}

// Return [{team, rank, score, wins, games_played}] ordered by rank for a given mode.
async function board(mode: string, params: Record<string, unknown>) {
  await admin.from("seasons").update({ scoring_mode: mode, ...params }).eq("id", SEASON);
  const { data, error } = await admin.rpc("season_leaderboard", { p_season_id: SEASON });
  if (error) throw new Error(`season_leaderboard(${mode}): ${error.message}`);
  const nameOf: Record<string, string> = { [T.A]: "A", [T.B]: "B", [T.C]: "C" };
  return (data as Array<{ team_id: string; rank: number; score: number; wins: number; games_played: number }>)
    .map((r) => ({ team: nameOf[r.team_id], rank: r.rank, score: Number(r.score), wins: r.wins, gp: r.games_played }))
    .sort((a, b) => a.rank - b.rank || a.team.localeCompare(b.team));
}

async function main() {
  await seed();
  try {
    // Auto-enroll trigger stamped season_id on all 4 games.
    const { data: enrolled } = await admin.from("games").select("id, season_id").in("id", G);
    assert("auto-enroll: all 4 games stamped with season_id", (enrolled ?? []).every((g) => g.season_id === SEASON), true);

    // CUMULATIVE — A,B,C; A>B by wins tiebreak (both 130).
    const cum = await board("cumulative", {});
    assert("cumulative order", cum.map((r) => `${r.team}#${r.rank}`), ["A#1", "B#2", "C#3"]);
    assert("cumulative scores", cum.map((r) => r.score), [130, 130, 110]);
    assert("cumulative wins (tiebreak: A 2 > B 1)", cum.map((r) => `${r.team}:${r.wins}`), ["A:2", "B:1", "C:1"]);

    // PLACEMENT [10,6,3] — B,A,C (distinct ordering).
    const plc = await board("placement", { placement_points: [10, 6, 3] });
    assert("placement order", plc.map((r) => `${r.team}#${r.rank}`), ["B#1", "A#2", "C#3"]);
    assert("placement scores", plc.map((r) => r.score), [28, 26, 19]);

    // BEST_N (3) — A,C,B; C>B by games_played tiebreak (both 110, both 1 win, C played 3).
    const bn = await board("best_n", { best_n: 3 });
    assert("best_n order", bn.map((r) => `${r.team}#${r.rank}`), ["A#1", "C#2", "B#3"]);
    assert("best_n scores", bn.map((r) => r.score), [120, 110, 110]);
    assert("best_n games_played (tiebreak: C 3 < B 4)", bn.map((r) => `${r.team}:${r.gp}`), ["A:4", "C:3", "B:4"]);

    // Playoff exclusion: C's 999-pt playoff game must not appear anywhere.
    assert("playoff excluded (C best_n score still 110, not 999+)", bn.find((r) => r.team === "C")!.score, 110);

    // Zero-game season returns empty (graceful).
    const { data: empty } = await admin.rpc("season_leaderboard", { p_season_id: EMPTY_SEASON });
    assert("empty season → 0 rows", (empty ?? []).length, 0);
  } finally {
    await cleanup();
  }

  if (failures > 0) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
  console.log("\nAll season_leaderboard assertions passed.");
}

main().catch((e) => { console.error("\n✗", e.message); cleanup().finally(() => process.exit(1)); });
