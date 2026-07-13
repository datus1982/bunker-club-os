import { Link } from "react-router-dom";

import { SiteLayout } from "../SiteLayout";
import { useSiteCopy } from "../useSiteCopy";
import { useDocumentMeta, JsonLd, SITE_ORIGIN } from "../seo";

/**
 * Route 66 & the Neighborhood (`/history`) — docs/14, site-refinement-1.
 *
 * The one deep, image-rich heritage page. It tells the STREET's story: NW 23rd
 * was U.S. Route 66 for 53 years (1926–1979), and 433 NW 23rd sat on that
 * alignment the whole time. Copy is EDITORIAL and hardcoded here (versioned in
 * git) in the voice of /about; only the one lead sentence is a DB override
 * (site_history_intro). The Tower Theatre is scenery + a single link out
 * (Retro Metro OKC), never a chapter of its own.
 *
 * Every historic image carries a rendered credit line. Owner scans are from the
 * Oklahoma Historical Society (owner-cleared, credit required); two Library of
 * Congress / John Margolies images add roadside context (free to use). Images
 * are lazy with width/height reserved boxes (zero CLS); the 1957 banner is the
 * eager LCP element. FAQPage + Article JSON-LD target AI answer boxes.
 */

// Required credit lines (docs/route66-owner-photos.md).
const OHS_CREDIT =
  "Meyers Photo Shop, Z.P. Meyers/Barney Hillerman Photographic Collection, Courtesy of the Oklahoma Historical Society";
const LOC_CREDIT = "John Margolies / Library of Congress, Prints & Photographs Division";

const P = "/photos/history";

// Visible FAQ — mirrored verbatim into the FAQPage JSON-LD below.
const FAQ: { q: string; a: string }[] = [
  {
    q: "Was Bunker Club on Route 66?",
    a: "Yes. 433 NW 23rd Street was part of Route 66's active alignment from 1926 to 1979 — fifty-three years. NW 23rd Street served as the primary east–west Route 66 corridor through Oklahoma City for the highway's entire active life, and Bunker Club occupies a storefront directly on that historic roadway.",
  },
  {
    q: "When did Route 66 run through NW 23rd Street?",
    a: "From the highway's commissioning on November 11, 1926, until the US 66 Business Route through Oklahoma City was deleted on March 5, 1979. Route 66 was decommissioned statewide in Oklahoma in 1985.",
  },
  {
    q: "What was on NW 23rd Street before Bunker Club?",
    a: "In the Route 66 era the 400 block of NW 23rd was a busy retail strip — drug stores, hardware, groceries, furniture, and the Tower Theatre next door at 425 NW 23rd. After the highway years the storefront at 433 sat mostly quiet for decades before Bunker Club opened here in 2017.",
  },
  {
    q: "What is the Tower Theatre next to Bunker Club?",
    a: "The Tower Theatre (425 NW 23rd) opened in 1937 as a first-run movie house on Route 66. It ran films for decades, survived a fire in 1967, dimmed through the 1980s, and reopened as a live-music venue in 2016. Its neon marquee is the landmark of the block.",
  },
];

export function History() {
  const { data: copy } = useSiteCopy();

  useDocumentMeta({
    title: "Route 66 History — 433 NW 23rd & Uptown OKC | Bunker Club",
    description:
      "Bunker Club sits on Route 66's original Oklahoma City alignment at 433 NW 23rd. Explore 53 years of Mother Road history, the Tower Theatre block, and the Uptown 23rd story.",
    path: "/history",
    ogType: "article",
  });

  const intro = copy?.historyIntro;

  return (
    <SiteLayout active="history">
      {/* Banner — the 1957 panorama, full-bleed. Eager LCP; sized to avoid CLS. */}
      <div className="site-banner">
        <img
          src={`${P}/banner-2400.jpg`}
          srcSet={`${P}/banner-1200.jpg 1200w, ${P}/banner-2400.jpg 2400w`}
          sizes="100vw"
          width={2400}
          height={1084}
          fetchPriority="high"
          decoding="async"
          alt="NW 23rd Street in Oklahoma City in 1957 — the Tower Theatre marquee, C.R. Anthony Co. department store, and angle-parked cars along U.S. Route 66"
        />
      </div>
      <div className="site-wrap site-banner__cap">
        <p className="site-credit">
          NW 23rd Street, 1957 — U.S. Route 66, looking toward the Tower Theatre. {OHS_CREDIT}.
        </p>
      </div>

      {/* Lead / thesis */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label">NW 23rd Street · U.S. Route 66</p>
          <h1>Route 66 &amp; the Neighborhood</h1>

          <div className="site-prose" style={{ marginTop: "1rem" }}>
            {intro && <p>{intro}</p>}
            <p>
              When Route 66 was commissioned in 1926, its path through Oklahoma City ran straight
              down NW 23rd Street — and it stayed there for over half a century. Through the
              Depression, the war years, and the whole neon-and-chrome heyday of the Mother Road,
              cross-country travelers rolled past this exact address. The storefront at 433 has
              been many things, but for fifty-three years its front door opened onto a national
              highway.
            </p>
            <p>
              That heritage is still on the map. National Geographic's 2026 Route 66 guide to
              Oklahoma City names Bunker Club by name among the street's{" "}
              <a
                href="https://www.nationalgeographic.com/travel/article/paid-content-creative-guide-route-66-oklahoma-city"
                target="_blank"
                rel="noreferrer noopener"
              >
                throwback pleasures
              </a>
              . We didn't earn a spot on the highway — we just kept the lights on where it used
              to run.
            </p>
          </div>

          <figure className="site-hfig">
            <img
              className="site-hphoto"
              src={`${P}/block-veazey-1400.jpg`}
              srcSet={`${P}/block-veazey-700.jpg 700w, ${P}/block-veazey-1400.jpg 1400w`}
              sizes="(max-width: 1080px) 100vw, 1080px"
              width={1400}
              height={1163}
              loading="lazy"
              decoding="async"
              alt="NW 23rd Street in the early 1950s — the Tudor-gabled corner block with Veazey Drug Co., Pettee's Hardware and Frances Food Shop, the Tower marquee down the street"
            />
            <figcaption className="site-hcap">
              <b>The Bunker's block, early 1950s.</b> Veazey Drug Co. — "A Home Institution" —
              anchors the Tudor-gabled corner, with the Tower marquee rising down the street. Our
              stretch of NW 23rd is the block between them.
              <span className="site-credit" style={{ display: "block" }}>
                {OHS_CREDIT}.
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Timeline */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label">How the corner got here</p>
          <h2>The Timeline</h2>

          <ol className="site-timeline">
            <li className="site-tl">
              <div className="site-tl__year">1926</div>
              <p className="site-tl__title">Route 66 is commissioned</p>
              <p className="site-tl__body">
                On November 11, 1926, the new U.S. Route 66 is signed across eight states. Its
                Oklahoma City alignment turns onto NW 23rd Street — the road outside 433 becomes
                the Mother Road.
              </p>
            </li>

            <li className="site-tl">
              <div className="site-tl__year">1937</div>
              <p className="site-tl__title">The Tower Theatre opens</p>
              <p className="site-tl__body">
                A block anchor arrives next door at 425 NW 23rd: an Art-Deco movie palace whose
                neon tower still names the street. Its full story lives at{" "}
                <a
                  href="https://www.retrometrookc.org/tower-theatre/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Retro Metro OKC
                </a>
                .
              </p>
            </li>

            <li className="site-tl">
              <div className="site-tl__year">1940s–50s</div>
              <p className="site-tl__title">The golden era</p>
              <p className="site-tl__body">
                NW 23rd becomes Oklahoma City's first great shopping strip away from downtown —
                drug stores and dime stores, hardware and groceries, angle parking bumper to
                bumper, and a steady current of Route 66 traffic threading it all together.
              </p>

              <figure className="site-hfig">
                <img
                  className="site-hphoto"
                  src={`${P}/street-1940s-1400.jpg`}
                  srcSet={`${P}/street-1940s-700.jpg 700w, ${P}/street-1940s-1400.jpg 1400w`}
                  sizes="(max-width: 1080px) 100vw, 1080px"
                  width={1400}
                  height={1109}
                  loading="lazy"
                  decoding="async"
                  alt="NW 23rd Street in the late 1940s looking east toward the Tower marquee, with a city bus and rows of postwar cars"
                />
                <figcaption className="site-hcap">
                  <b>Looking east toward the Tower, late 1940s.</b> A city bus and a curb of
                  postwar sedans on a working main street.
                  <span className="site-credit" style={{ display: "block" }}>
                    {OHS_CREDIT}.
                  </span>
                </figcaption>
              </figure>

              <div className="site-grid-2" style={{ marginTop: "1.1rem" }}>
                <figure className="site-hfig" style={{ marginTop: 0 }}>
                  <img
                    className="site-hphoto"
                    src={`${P}/golden-pano-2000.jpg`}
                    srcSet={`${P}/golden-pano-1000.jpg 1000w, ${P}/golden-pano-2000.jpg 2000w`}
                    sizes="(max-width: 720px) 100vw, 520px"
                    width={2000}
                    height={903}
                    loading="lazy"
                    decoding="async"
                    alt="A mid-1950s block of NW 23rd with home-furnishings and appliance stores and a full curb of parked cars"
                  />
                  <figcaption className="site-hcap">
                    <b>Mid-1950s, a few doors down.</b> Furniture, appliances, a supermarket — the
                    strip at full tide.
                    <span className="site-credit" style={{ display: "block" }}>{OHS_CREDIT}.</span>
                  </figcaption>
                </figure>

                <figure className="site-hfig" style={{ marginTop: 0 }}>
                  <img
                    className="site-hphoto"
                    src={`${P}/retail-modern-1400.jpg`}
                    srcSet={`${P}/retail-modern-700.jpg 700w, ${P}/retail-modern-1400.jpg 1400w`}
                    sizes="(max-width: 720px) 100vw, 520px"
                    width={1400}
                    height={1097}
                    loading="lazy"
                    decoding="async"
                    alt="A mid-1950s modern retail corner on NW 23rd with a butterfly-canopy storefront and a hardware store"
                  />
                  <figcaption className="site-hcap">
                    <b>Space-age retail, mid-1950s.</b> A butterfly-canopy storefront — the
                    atomic-age design language arriving on 23rd.
                    <span className="site-credit" style={{ display: "block" }}>{OHS_CREDIT}.</span>
                  </figcaption>
                </figure>
              </div>
            </li>

            <li className="site-tl">
              <div className="site-tl__year">1953</div>
              <p className="site-tl__title">The bypass — and the atomic age</p>
              <p className="site-tl__body">
                A new expressway opens and pulls through-traffic off NW 23rd, which is redesignated
                US 66 Business Route. The timing is its own story: the early 1950s are the height
                of the atomic age — duck-and-cover, backyard shelters, ray-gun futures. That exact
                mood — the preparedness and the propaganda, the fear of what's to come and the hope
                of a future — is the one this bar was later built to keep. The Cold War never quite
                left this block; we just poured it a drink.
              </p>

              <figure className="site-hfig">
                <img
                  className="site-hphoto"
                  src={`${P}/phillips66-1400.jpg`}
                  srcSet={`${P}/phillips66-700.jpg 700w, ${P}/phillips66-1400.jpg 1400w`}
                  sizes="(max-width: 1080px) 100vw, 1080px"
                  width={1400}
                  height={1117}
                  loading="lazy"
                  decoding="async"
                  alt="A Phillips 66 filling station at a NW 23rd intersection in the early 1950s, with a cottage-style station and early-1950s cars"
                />
                <figcaption className="site-hcap">
                  <b>Phillips 66 on the corner, early 1950s.</b> The highway's own shield, a
                  cottage-style station, and Cheever's Flowers beyond.
                  <span className="site-credit" style={{ display: "block" }}>{OHS_CREDIT}.</span>
                </figcaption>
              </figure>
            </li>

            <li className="site-tl">
              <div className="site-tl__year">1979</div>
              <p className="site-tl__title">Route 66 leaves NW 23rd</p>
              <p className="site-tl__body">
                On March 5, 1979, the US 66 Business Route through Oklahoma City is deleted. After
                fifty-three years, the highway shields come down. (Route 66 is decommissioned
                statewide in Oklahoma in 1985.)
              </p>
            </li>

            <li className="site-tl">
              <div className="site-tl__year">1980s–2010s</div>
              <p className="site-tl__title">The quiet decades</p>
              <p className="site-tl__body">
                The strip fades as the highway crowds move on. Storefronts empty; the Tower dims.
                The building at 433 NW 23rd sits mostly quiet for decades — waiting, as it turns
                out, for a very specific idea.
              </p>
            </li>

            <li className="site-tl site-tl--now">
              <div className="site-tl__year">2017 — today</div>
              <p className="site-tl__title">Bunker Club opens</p>
              <p className="site-tl__body">
                An atomic-age high-dive takes over the jewel-box storefront in the Tower building —
                green Vitrolite glass out front, civil-defense signage and low light within. The
                Uptown 23rd district revives around it. The road out front is a business street
                now, but its history is the whole reason this room makes sense.
              </p>
            </li>
          </ol>
        </div>
      </section>

      {/* Night neon moment — the mood bridge */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label">After dark on 23rd</p>
          <h2 className="site-h-compact">The Neon Hour</h2>
          <figure className="site-night site-hfig">
            <img
              className="site-hphoto"
              src={`${P}/night-liquor-1600.jpg`}
              srcSet={`${P}/night-liquor-800.jpg 800w, ${P}/night-liquor-1600.jpg 1600w`}
              sizes="(max-width: 1080px) 100vw, 1080px"
              width={1600}
              height={1197}
              loading="lazy"
              decoding="async"
              alt="A glass-front drive-up liquor store glowing at night on NW 23rd, the Tower neon at left and Coca-Cola and Schlitz billboards above"
            />
            <figcaption className="site-hcap">
              <b>NW 23rd after dark, around 1960.</b> A glass box of light, the Tower's neon down
              the block, King-Size Coke and Schlitz overhead. This is the register the bar still
              runs on — low light, honest drinks, the glow doing the talking.
              <span className="site-credit" style={{ display: "block" }}>{OHS_CREDIT}.</span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Marquee through the decades — LIGHT */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label">Next door</p>
          <h2 className="site-h-compact">The Tower Marquee, Through the Decades</h2>
          <p className="site-tl__body" style={{ maxWidth: "66ch" }}>
            The one constant on the block is the Tower's neon, changing only what it advertises.
            Three glimpses across three decades — and for the full theatre story,{" "}
            <a
              href="https://www.retrometrookc.org/tower-theatre/"
              target="_blank"
              rel="noreferrer noopener"
            >
              Retro Metro OKC
            </a>{" "}
            tells it best.
          </p>

          <div className="site-marquee-strip">
            <figure className="site-marquee">
              <img
                src={`${P}/tower-1966-800.jpg`}
                width={651}
                height={800}
                loading="lazy"
                decoding="async"
                alt="The Tower Theatre marquee lit at night in 1966 for a film premiere, a crowd queued on a wet sidewalk"
              />
              <figcaption>
                1966 · premiere night
                <span className="site-credit" style={{ display: "block", textTransform: "none" }}>
                  {OHS_CREDIT}.
                </span>
              </figcaption>
            </figure>

            <figure className="site-marquee">
              <img
                src={`${P}/tower-1969-800.jpg`}
                width={640}
                height={800}
                loading="lazy"
                decoding="async"
                alt="The Tower Theatre facade and neon marquee around 1969"
              />
              <figcaption>
                1969 · a full house
                <span className="site-credit" style={{ display: "block", textTransform: "none" }}>
                  {OHS_CREDIT}.
                </span>
              </figcaption>
            </figure>

            <figure className="site-marquee">
              <img
                src={`${P}/tower-1979-900.jpg`}
                width={900}
                height={516}
                loading="lazy"
                decoding="async"
                alt="The Tower Theatre block in the late 1970s, its neon still lit above a changed street"
              />
              <figcaption>
                late 1970s · the lean years
                <span className="site-credit" style={{ display: "block", textTransform: "none" }}>
                  {OHS_CREDIT}.
                </span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* One block west — the Milk Bottle (LOC) + roadside neon (LOC) */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label">On the same road</p>
          <h2 className="site-h-compact">One Block West</h2>

          <div className="site-callout">
            <figure className="site-callout__img">
              <img
                src={`${P}/milkbottle-708.jpg`}
                srcSet={`${P}/milkbottle-380.jpg 380w, ${P}/milkbottle-708.jpg 708w`}
                sizes="(max-width: 620px) 100vw, 220px"
                width={708}
                height={1024}
                loading="lazy"
                decoding="async"
                alt="The giant Townley milk bottle atop a small brick grocery at 24th and Classen, with the Gold Dome visible behind"
              />
            </figure>
            <div className="site-callout__body">
              <p>
                One block west, at 24th &amp; Classen, the Townley milk bottle still tops its
                little brick grocery — a roadside landmark since 1948, and one of the last relics
                of Route 66's <em>original</em> 1926 alignment, which ran down Classen before it
                found NW 23rd. It's on the National Register now.
              </p>
              <p style={{ margin: 0 }}>
                <span className="site-credit">Townley milk bottle, 1993. {LOC_CREDIT}.</span>
              </p>
            </div>
          </div>

          <figure className="site-hfig">
            <img
              className="site-hphoto"
              src={`${P}/flamingo-708.jpg`}
              srcSet={`${P}/flamingo-380.jpg 380w, ${P}/flamingo-708.jpg 708w`}
              sizes="(max-width: 620px) 100vw, 380px"
              width={708}
              height={1024}
              loading="lazy"
              decoding="async"
              style={{ maxWidth: 380 }}
              alt="A neon Flamingo Motel sign in Oklahoma City, classic Route 66 roadside signage advertising refrigerated air and color TV"
            />
            <figcaption className="site-hcap">
              <b>The look of the road.</b> Oklahoma City's Route 66 was all neon and promise —
              refrigerated air, room phones, color TV. The Flamingo Motel's sign, the exact
              roadside idiom the bunker fantasy grew out of.
              <span className="site-credit" style={{ display: "block" }}>
                Flamingo Motel, Oklahoma City, 1979. {LOC_CREDIT}.
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Centennial + events tie-in */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <div className="site-centennial">
            <div className="site-centennial__badge">▲ Route 66 Centennial · 1926–2026</div>
            <h2 className="site-h-compact">One Hundred Years on the Mother Road</h2>
            <p className="site-tl__body" style={{ maxWidth: "66ch", marginBottom: "0.9rem" }}>
              November 11, 2026 marks one hundred years since Route 66 was commissioned — and
              Oklahoma, home to more original 66 miles than any other state, is celebrating all
              year. Uptown 23rd, our own district, kicked off with Cruisin' 23rd in April, and the
              statewide calendar runs right through the centennial date.
            </p>
            <p className="site-tl__body" style={{ maxWidth: "66ch", margin: 0 }}>
              We keep a short list of nearby centennial happenings on our{" "}
              <Link to="/events">Events page, under "Around the Neighborhood"</Link> — plus links
              to the{" "}
              <a href="https://oklahomaroute66.com/centennial" target="_blank" rel="noreferrer noopener">
                Oklahoma Route 66 Association
              </a>{" "}
              and{" "}
              <a href="https://uptown23rd.com/" target="_blank" rel="noreferrer noopener">
                Uptown 23rd
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label">Common questions</p>
          <h2 className="site-h-compact">Route 66 &amp; 433 NW 23rd — FAQ</h2>
          <div className="site-faq">
            {FAQ.map((f) => (
              <div key={f.q}>
                <h3 className="site-faq__q">{f.q}</h3>
                <p className="site-faq__a">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sources & further reading */}
      <section className="site-section site-section--tight">
        <div className="site-wrap">
          <p className="site-label">For the record</p>
          <h2 className="site-h-compact">Sources &amp; Further Reading</h2>
          <ul className="site-sources">
            <li>
              <a href="https://www.retrometrookc.org/tower-theatre/" target="_blank" rel="noreferrer noopener">
                Retro Metro OKC — Tower Theatre
              </a>
            </li>
            <li>
              <a href="https://uptown23rd.com/history" target="_blank" rel="noreferrer noopener">
                Uptown 23rd — District History
              </a>
            </li>
            <li>
              <a href="https://oklahomaroute66.com/" target="_blank" rel="noreferrer noopener">
                Oklahoma Route 66 Association
              </a>
            </li>
            <li>
              <a
                href="https://www.visitokc.com/things-to-do/route-66/route-66-alignments/"
                target="_blank"
                rel="noreferrer noopener"
              >
                VisitOKC — Route 66 Alignments
              </a>
            </li>
            <li>
              <a href="https://gateway.okhistory.org/" target="_blank" rel="noreferrer noopener">
                Oklahoma Historical Society — Gateway to Oklahoma History
              </a>
            </li>
            <li>
              <a
                href="https://www.nationalgeographic.com/travel/article/paid-content-creative-guide-route-66-oklahoma-city"
                target="_blank"
                rel="noreferrer noopener"
              >
                National Geographic — Route 66 Oklahoma City
              </a>
            </li>
          </ul>
          <p className="site-credit" style={{ marginTop: "1.25rem", maxWidth: "70ch" }}>
            Historic Oklahoma City photographs courtesy of the Oklahoma Historical Society (Meyers
            Photo Shop / Z.P. Meyers–Barney Hillerman Photographic Collection). Roadside neon
            images by John Margolies, Library of Congress, Prints &amp; Photographs Division.
          </p>

          <Link to="/visit" className="site-pointer">
            <span className="site-pointer__kicker">Come see it in person</span>
            <span className="site-pointer__title">Visit Bunker Club →</span>
            <span className="site-pointer__body">
              433 NW 23rd St — on the old Route 66 alignment. Open 4 PM to 2 AM, every day.
            </span>
          </Link>
        </div>
      </section>

      {/* Structured data — Article + FAQPage (AI answer boxes / rich results). */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "Route 66 & the Neighborhood — 433 NW 23rd Street, Oklahoma City",
          about: "History of U.S. Route 66 on NW 23rd Street in Oklahoma City and the Bunker Club building",
          url: `${SITE_ORIGIN}/history`,
          mainEntityOfPage: `${SITE_ORIGIN}/history`,
          publisher: { "@type": "Organization", name: "Bunker Club" },
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }}
      />
    </SiteLayout>
  );
}
