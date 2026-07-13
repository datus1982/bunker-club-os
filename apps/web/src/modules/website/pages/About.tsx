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

          <div className="site-prose" style={{ marginTop: "1.5rem" }}>
            {(copy?.about ?? []).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>

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
