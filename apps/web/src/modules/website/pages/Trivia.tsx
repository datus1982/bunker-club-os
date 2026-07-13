import { Link } from "react-router-dom";

import { SiteLayout } from "../SiteLayout";
import { useStandings } from "../useStandings";
import { useDocumentMeta } from "../seo";

/**
 * Trivia (`/trivia`) — the marketing pitch for Atomic Pub Trivia (in-world garnish,
 * original IP only), a HOW IT WORKS walkthrough, live public season standings
 * (season_leaderboard, anon-safe), and a CTA into /checkin. Graceful when there's no
 * active season (between seasons the standings block invites you to start one).
 */

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Round Up A Team",
    body: "Bring a crew or make friends at the bar. Teams of any size — the best table names get bonus glory.",
  },
  {
    n: "02",
    title: "Check In",
    body: "Scan the QR code on your table (or at the door) to check in at the terminal. First time? You'll be set up in under a minute.",
  },
  {
    n: "03",
    title: "Play The Night",
    body: "Multiple rounds, a picture round, wildcards, and a wager. Answers go in at your table — no paper, no fuss.",
  },
  {
    n: "04",
    title: "Climb The Board",
    body: "Every Wednesday counts toward the season leaderboard. Rack up nights, chase the top spot, earn your place in the Bunker.",
  },
];

export function Trivia() {
  const { data: standings, isLoading } = useStandings(10);
  useDocumentMeta({
    title: "Atomic Pub Trivia — Bunker Club · Wednesdays · OKC",
    description:
      "Atomic Pub Trivia every Wednesday at 8 PM at Bunker Club on NW 23rd Street, Oklahoma City. Free to play. Check the live season standings and round up a team.",
    path: "/trivia",
  });

  return (
    <SiteLayout active="trivia">
      {/* ── Pitch ── */}
      <section className="site-hero">
        <div className="site-wrap site-hero__inner">
          <p className="site-label">▲ Civil Defense Drill · Wednesdays 8 PM</p>
          <h1>ATOMIC PUB TRIVIA</h1>
          <p className="site-hero__sub">
            The best night of the week in the Bunker. Six rounds, a picture round, and a wager
            that can blow the whole thing wide open. Free to play — bring your smartest friends
            (or your loudest).
          </p>
          <div className="site-hero__cta">
            <Link to="/checkin" className="site-btn site-btn--primary">
              Check In To Play
            </Link>
            <Link to="/visit" className="site-btn site-btn--ghost">
              Find Us
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="site-section">
        <div className="site-wrap">
          <p className="site-label" style={{ marginBottom: "1.25rem" }}>
            How It Works
          </p>
          <ol className="site-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="site-step">
                <span className="site-step__n" aria-hidden>
                  {s.n}
                </span>
                <div>
                  <h2 className="site-h-compact site-step__title">{s.title}</h2>
                  <p className="site-step__body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Standings ── */}
      <section className="site-section" style={{ borderTop: "1px solid var(--site-line)" }}>
        <div className="site-wrap">
          <p className="site-label" style={{ marginBottom: "0.75rem" }}>
            Season Standings
          </p>

          {isLoading ? (
            <p className="site-empty">Loading the leaderboard…</p>
          ) : standings && standings.rows.length > 0 ? (
            <>
              <h2 className="site-h-compact">{standings.seasonName}</h2>
              <table className="site-standings">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Team</th>
                    <th scope="col">Wins</th>
                    <th scope="col">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.rows.map((r) => (
                    <tr key={r.team_id} data-top={r.rank <= 3}>
                      <td className="site-standings__rank">{r.rank}</td>
                      <td>{r.team_name}</td>
                      <td>{r.wins}</td>
                      <td className="site-standings__score">{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ color: "var(--site-ink-dim)", fontSize: "0.9rem", marginTop: "0.75rem" }}>
                Standings update live as each Wednesday is scored.
              </p>
            </>
          ) : (
            <p className="site-empty">
              A new season is loading up. Come out this Wednesday and be there when the board
              resets — first game back, everyone starts from zero.
            </p>
          )}

          <div style={{ marginTop: "2rem" }}>
            <Link to="/checkin" className="site-btn site-btn--primary">
              Check In To Play
            </Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
