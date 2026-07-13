import { useEffect } from "react";
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
  LOGO_IMAGE,
} from "../seo";

/**
 * Home-hero LCP candidate set. The <img> srcset and the route-scoped preload
 * MUST use this EXACT string so the preload fetches the same candidate the img
 * resolves to at any DPR (mobile → 640w, larger → 960w/1920w) — no double
 * download. Mobile's LCP was the 960w (158 KB); the 640w (~98 KB) shaves it.
 */
const HERO_SRCSET =
  "/photos/hero-room-640.jpg 640w, /photos/hero-room-960.jpg 960w, /photos/hero-room-1920.jpg 1920w";
const HERO_SIZES = "100vw";
/** Must match the id used by the pre-hydration inline script in index.html. */
const HERO_PRELOAD_ID = "hero-lcp-preload";

/**
 * Route-scoped LCP preload (N8/W1/WARN-A). The FIRST paint of "/" is handled by a
 * tiny pre-hydration inline script in index.html (fires during HTML parse, before
 * React mounts — the only way to beat the <img>'s own discovery on mobile). This
 * hook exists for the SPA lifecycle:
 *   • initial "/" load  → the element already exists (injected by that script); we
 *     ADOPT it and only register cleanup, so there's no double-injection.
 *   • client-side nav INTO Home (the inline script does not re-run) → we inject it.
 *   • nav AWAY from Home → cleanup removes it, so /scoring, /leaderboard and the
 *     always-on display TVs never carry the hint.
 * imagesrcset/imagesizes mirror the <img> EXACTLY (HERO_SRCSET/SIZES) — and MUST
 * byte-match the strings in index.html's inline script (single source of truth).
 */
function useHeroPreload() {
  useEffect(() => {
    let link = document.getElementById(HERO_PRELOAD_ID) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = HERO_PRELOAD_ID;
      link.rel = "preload";
      link.as = "image";
      link.setAttribute("imagesrcset", HERO_SRCSET);
      link.setAttribute("imagesizes", HERO_SIZES);
      link.setAttribute("fetchpriority", "high");
      document.head.appendChild(link);
    }
    return () => {
      link?.remove();
    };
  }, []);
}

/**
 * Home (`/`) — hero, "this week" strip (trivia night / published events /
 * website promos, empty-state tolerant), an hours block, and CTAs to /menu and
 * /visit. Carries the LocalBusiness (BarOrPub) JSON-LD built from seeded copy.
 */
export function Home() {
  useHeroPreload();
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
        logo: LOGO_IMAGE,
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
        sameAs: [copy.socials.instagram, copy.socials.facebook, copy.socials.tiktok].filter(
          (u): u is string => !!u && u !== "#",
        ),
      }
    : null;

  return (
    <SiteLayout active="home">
      {jsonLd && <JsonLd data={jsonLd} />}

      {/* ── Hero ── */}
      <section className="site-hero">
        {/* Owner interior photo as the hero backdrop. Absolutely positioned + object-fit
            cover so it never participates in layout (zero CLS); the .site-hero box height
            is still set by its padding + the text content. Eager + fetchpriority=high +
            the route-scoped preload (useHeroPreload) make it the LCP. srcset/sizes here
            share HERO_SRCSET/HERO_SIZES with that preload so both resolve the SAME
            candidate. DECISION: descriptive alt (real editorial photo of the venue, not
            decoration) rather than empty. */}
        <img
          className="site-hero__bg"
          src="/photos/hero-room-1920.jpg"
          srcSet={HERO_SRCSET}
          sizes={HERO_SIZES}
          width={1920}
          height={1080}
          fetchPriority="high"
          decoding="async"
          alt="Inside Bunker Club — a long pewter bar lined with gold stools, red vinyl booths across the room, and screens glowing at the back"
        />
        <div className="site-hero__scrim" aria-hidden />
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
