import { Link } from "react-router-dom";

import { SiteLayout } from "../SiteLayout";
import { useSiteCopy } from "../useSiteCopy";
import { useDocumentMeta } from "../seo";

/**
 * About (`/about`) — the bar's story, rendered from the seeded `site_about`
 * paragraphs. Restrained styling; a single CTA back into the site.
 */
export function About() {
  const { data: copy } = useSiteCopy();
  useDocumentMeta({
    title: "About Bunker Club — Our Story · OKC",
    description:
      "The story of Bunker Club, a neighborhood bar on NW 23rd Street in Oklahoma City and home of Atomic Pub Trivia.",
    path: "/about",
    ogType: "article",
  });

  return (
    <SiteLayout active="about">
      <section className="site-section">
        <div className="site-wrap">
          <p className="site-label">Our Story</p>
          <h1>ABOUT</h1>

          {/* The bar + hand-lettered CLUB RULES wall. Lazy + reserved 16:9 box (no CLS). */}
          <figure style={{ margin: "1.5rem 0 0" }}>
            <img
              className="site-photo"
              src="/photos/bar-rules-1400.jpg"
              srcSet="/photos/bar-rules-700.jpg 700w, /photos/bar-rules-1400.jpg 1400w"
              sizes="(max-width: 1080px) 100vw, 1080px"
              width={1400}
              height={787}
              loading="lazy"
              decoding="async"
              alt="The Bunker Club bar — gold stools along a pewter counter, backbar bottles, and the hand-lettered CLUB RULES painted on the deep-red wall"
            />
          </figure>

          <div className="site-prose" style={{ marginTop: "1.75rem" }}>
            {(copy?.about ?? []).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>

          {/* ── CLUB RULES (owner-approved brand voice; transcribed from the wall) ── */}
          {copy?.clubRules && copy.clubRules.length > 0 && (
            <section className="site-rules" aria-labelledby="club-rules-h">
              <h2 id="club-rules-h" className="site-rules__head">
                • Club Rules •
              </h2>
              <ul className="site-rules__list">
                {copy.clubRules.map((rule, i) => (
                  <li key={i}>{rule}</li>
                ))}
              </ul>
            </section>
          )}

          {/* The street came first — pointer into the Route 66 heritage page. */}
          <Link to="/history" className="site-pointer">
            <span className="site-pointer__kicker">The street came first</span>
            <span className="site-pointer__title">Route 66 &amp; the Neighborhood →</span>
            <span className="site-pointer__body">
              433 NW 23rd sat on Route 66 for fifty-three years. The history of the block — and how
              it shaped this bar — has its own page.
            </span>
          </Link>

          <div style={{ marginTop: "2rem", display: "flex", gap: "0.85rem", flexWrap: "wrap" }}>
            <Link to="/trivia" className="site-btn site-btn--primary">
              Trivia Night
            </Link>
            <Link to="/visit" className="site-btn site-btn--ghost">
              Come Visit
            </Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
