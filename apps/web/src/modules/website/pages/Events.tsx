import { Link } from "react-router-dom";

import { SiteLayout } from "../SiteLayout";
import { useEvents } from "../useEvents";
import { useDocumentMeta } from "../seo";

/**
 * Events (`/events`) — what's coming up. A fixed weekly Trivia card (Atomic Pub Trivia,
 * every Wednesday 8 PM) leads, followed by upcoming events + website-flagged promos from
 * `useEvents` (scheduled_events + signage_items). Empty-state tolerant: with nothing on
 * the books it still points people at trivia night.
 */
export function Events() {
  const { data: cards } = useEvents();
  useDocumentMeta({
    title: "Events — Bunker Club · Trivia & More · OKC",
    description:
      "What's on at Bunker Club: Atomic Pub Trivia every Wednesday night, plus upcoming events and celebrations on NW 23rd Street in Oklahoma City.",
    path: "/events",
  });

  const list = cards ?? [];

  return (
    <SiteLayout active="events">
      <section className="site-section">
        <div className="site-wrap">
          <p className="site-label">What&apos;s On</p>
          <h1>EVENTS</h1>

          {/* Fixed weekly anchor — always true, so it never depends on data. */}
          <div className="site-event site-event--feature" style={{ marginTop: "2rem" }}>
            <div className="site-event__kicker">
              <span className="site-dot" aria-hidden /> Every Wednesday
            </div>
            <h2 className="site-h-compact site-event__title">Atomic Pub Trivia</h2>
            <p className="site-event__when">Wednesdays · 8:00 PM</p>
            <p className="site-event__body">
              Round up a team and take your shot at the season leaderboard. Free to play — just
              show up, check in, and settle in for the night.
            </p>
            <Link to="/trivia" className="site-btn site-btn--ghost" style={{ marginTop: "0.5rem" }}>
              How Trivia Works
            </Link>
          </div>

          {list.length > 0 ? (
            <div className="site-events-grid" style={{ marginTop: "2rem" }}>
              {list.map((c) => (
                <article key={c.key} className="site-event">
                  <div className="site-event__kicker">{c.kicker}</div>
                  <h2 className="site-h-compact site-event__title">{c.title}</h2>
                  {c.when && <p className="site-event__when">{c.when}</p>}
                  {c.body && <p className="site-event__body">{c.body}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="site-empty" style={{ marginTop: "2rem" }}>
              Nothing else on the books right now — but there&apos;s always trivia every Wednesday.
              Follow along on social for one-off nights and specials.
            </p>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}
