import { Link } from "react-router-dom";

import { SiteLayout } from "../SiteLayout";
import { useEvents } from "../useEvents";
import {
  useNeighborhoodEvents,
  upcomingNeighborhoodEvents,
  fmtNeighborhoodDate,
} from "../useNeighborhoodEvents";
import { useDocumentMeta } from "../seo";

/**
 * Events (`/events`) — what's coming up. Two fixed weekly cards lead: Atomic Pub Trivia
 * (every Wednesday 8 PM) and Karaoke (most Saturdays — genuinely not every week, so the
 * copy stays honest). They're followed by upcoming events + website-flagged promos from
 * `useEvents` (scheduled_events + signage_items). Empty-state tolerant: with nothing on
 * the books it still points people at the weekly rhythm.
 */
export function Events() {
  const { data: cards } = useEvents();
  const { data: neighborhood } = useNeighborhoodEvents();
  useDocumentMeta({
    title: "Events — Bunker Club · Trivia & More · OKC",
    description:
      "What's on at Bunker Club: Atomic Pub Trivia every Wednesday night, plus upcoming events and celebrations on NW 23rd Street in Oklahoma City.",
    path: "/events",
  });

  const list = cards ?? [];
  const nearby = upcomingNeighborhoodEvents(neighborhood ?? []);

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

          {/* Fixed weekly anchor #2 — karaoke runs MOST Saturdays, not every one, so the
              cadence line and body both say so honestly rather than promising a date. */}
          <div className="site-event site-event--feature" style={{ marginTop: "1.25rem" }}>
            <div className="site-event__kicker">
              <span className="site-dot" aria-hidden /> Most Saturdays
            </div>
            <h2 className="site-h-compact site-event__title">Karaoke Night</h2>
            <p className="site-event__when">Saturday nights</p>
            <p className="site-event__body">
              Grab the mic and let it ring down the fallout tunnels — the bunker's own open
              mic. We run karaoke most Saturdays, though not every week, so check our socials
              before you head out.
            </p>
          </div>

          {list.length > 0 ? (
            <div className="site-events-grid" style={{ marginTop: "2rem" }}>
              {list.map((c) => (
                <article
                  key={c.key}
                  className={`site-event${c.image ? " site-event--media" : ""}`}
                >
                  {c.image && (
                    <img
                      className="site-event__thumb"
                      src={c.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div className="site-event__main">
                    <div className="site-event__kicker">{c.kicker}</div>
                    <h2 className="site-h-compact site-event__title">{c.title}</h2>
                    {c.when && <p className="site-event__when">{c.when}</p>}
                    {c.body && <p className="site-event__body">{c.body}</p>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="site-empty" style={{ marginTop: "2rem" }}>
              Nothing else on the books right now — but there&apos;s always trivia every Wednesday
              and karaoke most Saturdays. Follow along on social for one-off nights and specials.
            </p>
          )}

          {/* ── Around the Neighborhood — curated external Route 66 / Uptown highlights.
              Past-dated entries auto-hide (upcomingNeighborhoodEvents). We're on the
              Mother Road; these are our neighbors' events, not ours. ── */}
          <div style={{ marginTop: "3.5rem" }}>
            <p className="site-label">On the Mother Road</p>
            <h2 className="site-h-compact">Around the Neighborhood</h2>
            <p className="site-event__body" style={{ maxWidth: "62ch" }}>
              Bunker Club sits on historic Route 66, and 2026 is the highway&apos;s centennial.
              A few nearby happenings worth the drive — see our{" "}
              <Link to="/history">Route 66 &amp; the Neighborhood</Link> page for the backstory.
            </p>

            {nearby.length > 0 && (
              <div className="site-events-grid" style={{ marginTop: "1.5rem" }}>
                {nearby.map((n) => (
                  <article key={`${n.title}-${n.date}`} className="site-event">
                    <div className="site-event__kicker">
                      <span className="site-dot" aria-hidden /> Route 66 Centennial
                    </div>
                    <h3 className="site-h-compact site-event__title">{n.title}</h3>
                    {fmtNeighborhoodDate(n.date) && (
                      <p className="site-event__when">{fmtNeighborhoodDate(n.date)}</p>
                    )}
                    {n.blurb && <p className="site-event__body">{n.blurb}</p>}
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="site-btn site-btn--ghost"
                      style={{ marginTop: "0.25rem" }}
                    >
                      Details
                    </a>
                    {/* Defensive: `source` is optional — live DB rows may predate it
                        (see neighborhoodEvents.ts). Render the attribution only when present. */}
                    {n.source && <p className="site-event__source">via {n.source}</p>}
                  </article>
                ))}
              </div>
            )}

            <p style={{ marginTop: "1.5rem" }}>
              <a href="https://oklahomaroute66.com/centennial" target="_blank" rel="noreferrer noopener">
                Oklahoma Route 66 Association — centennial events →
              </a>
              <br />
              <a href="https://uptown23rd.com/" target="_blank" rel="noreferrer noopener">
                Uptown 23rd Association — our district →
              </a>
            </p>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
