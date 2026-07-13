import { Link } from "react-router-dom";

import { SiteLayout } from "../SiteLayout";
import { useSiteCopy, DAY_ORDER, dayLabel, fmtHours, todayKey } from "../useSiteCopy";
import { useThisWeek } from "../useThisWeek";
import {
  useDocumentMeta,
  JsonLd,
  SITE_ORIGIN,
  SITE_NAME,
  OG_IMAGE,
} from "../seo";

/**
 * Home (`/`) — hero, "this week" strip (trivia night / published events /
 * website promos, empty-state tolerant), an hours block, and CTAs to /menu and
 * /visit. Carries the LocalBusiness (BarOrPub) JSON-LD built from seeded copy.
 */
export function Home() {
  const { data: copy } = useSiteCopy();
  const { data: cards } = useThisWeek();
  useDocumentMeta({
    title: "Bunker Club — Bar & Atomic Pub Trivia on NW 23rd, OKC",
    description:
      "Bunker Club is a neighborhood bar on NW 23rd Street in Oklahoma City. Cold drinks, warm company, and Atomic Pub Trivia every Wednesday night.",
    path: "/",
  });

  const tkey = todayKey();

  const jsonLd = copy
    ? {
        "@context": "https://schema.org",
        "@type": "BarOrPub",
        name: SITE_NAME,
        url: SITE_ORIGIN,
        image: OG_IMAGE,
        description:
          "Neighborhood bar on NW 23rd Street in Oklahoma City, home of Atomic Pub Trivia every Wednesday.",
        address: {
          "@type": "PostalAddress",
          streetAddress: copy.address.line1,
          addressLocality: copy.address.city,
          addressRegion: copy.address.state,
          postalCode: copy.address.zip,
          addressCountry: "US",
        },
        ...(copy.address.lat && copy.address.lng
          ? {
              geo: {
                "@type": "GeoCoordinates",
                latitude: copy.address.lat,
                longitude: copy.address.lng,
              },
            }
          : {}),
        menu: `${SITE_ORIGIN}/menu`,
        openingHoursSpecification: DAY_ORDER.filter((d) => copy.hours[d]).map((d) => {
          const h = copy.hours[d]!;
          return {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: `https://schema.org/${dayLabel(d)}`,
            opens: h.open,
            closes: h.close,
          };
        }),
        sameAs: [copy.socials.instagram, copy.socials.facebook].filter(
          (u): u is string => !!u && u !== "#",
        ),
      }
    : null;

  return (
    <SiteLayout active="home">
      {jsonLd && <JsonLd data={jsonLd} />}

      {/* ── Hero ── */}
      <section className="site-hero">
        <div className="site-wrap site-hero__inner">
          <p className="site-label">▲ Shelter for the thirsty · OKC</p>
          <h1>{copy?.heroTitle ?? "BUNKER CLUB"}</h1>
          <p className="site-hero__sub">{copy?.heroSub}</p>
          <div className="site-hero__cta">
            <Link to="/menu" className="site-btn site-btn--primary">
              See the Menu
            </Link>
            <Link to="/visit" className="site-btn site-btn--ghost">
              Plan Your Visit
            </Link>
          </div>
        </div>
      </section>

      {/* ── This week strip ── */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label" style={{ marginBottom: "1rem" }}>
            What&apos;s On
          </p>
          {cards && cards.length > 0 ? (
            <div className="site-strip">
              {cards.map((c) => (
                <article key={c.key} className={`site-card${c.live ? " site-card--live" : ""}`}>
                  <div className="site-card__kicker">
                    {c.live && <span className="site-dot" aria-hidden />}
                    {c.kicker}
                  </div>
                  {/* Card titles are promo labels, not document headings — keeps the
                      page's heading outline sequential (h1 → h2). */}
                  <p className="site-card__title">{c.title}</p>
                  {c.body && <p className="site-card__body">{c.body}</p>}
                </article>
              ))}
            </div>
          ) : (
            <p className="site-empty">
              Nothing on the board right now — check back soon, or swing by the bar.
            </p>
          )}
        </div>
      </section>

      {/* ── Hours block ── */}
      <section className="site-section" style={{ borderTop: "1px solid var(--site-line)" }}>
        <div className="site-wrap site-grid-2">
          <div>
            <h2>Come In</h2>
            <p style={{ color: "var(--site-ink-dim)", maxWidth: "44ch" }}>
              We&apos;re on NW 23rd Street in the heart of Oklahoma City. Pull up a stool, bring a
              crew, and settle in.
            </p>
            <Link to="/visit" className="site-btn site-btn--ghost" style={{ marginTop: "1rem" }}>
              Directions &amp; Parking
            </Link>
          </div>
          <div>
            <p className="site-label" style={{ marginBottom: "0.75rem" }}>
              Hours
            </p>
            {copy && (
              <table className="site-hours">
                <tbody>
                  {DAY_ORDER.map((d) => {
                    const h = copy.hours[d];
                    return (
                      <tr key={d} data-today={d === tkey}>
                        <th scope="row">{dayLabel(d)}</th>
                        <td className={h ? undefined : "closed"}>{fmtHours(h)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
