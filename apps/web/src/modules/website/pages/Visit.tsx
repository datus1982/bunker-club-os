import { SiteLayout } from "../SiteLayout";
import { useSiteCopy, DAY_ORDER, dayLabel, fmtHours, todayKey } from "../useSiteCopy";
import { useDocumentMeta } from "../seo";

/**
 * Visit (`/visit`) — hours table, address, a lazy-loaded OpenStreetMap embed (no
 * API key dependency), parking notes, and contact/socials. All copy from the
 * seeded venue_settings keys.
 */
export function Visit() {
  const { data: copy } = useSiteCopy();
  useDocumentMeta({
    title: "Visit Bunker Club — Hours, Map & Parking · NW 23rd, OKC",
    description:
      "Find Bunker Club at 433 NW 23rd St, Oklahoma City. Hours, directions, parking, and how to reach us.",
    path: "/visit",
  });

  const tkey = todayKey();
  const addr = copy?.address;
  // OpenStreetMap embed centered on the venue — a small bbox around lat/lng.
  const mapSrc =
    addr?.lat && addr?.lng
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${addr.lng - 0.004}%2C${
          addr.lat - 0.0025
        }%2C${addr.lng + 0.004}%2C${addr.lat + 0.0025}&layer=mapnik&marker=${addr.lat}%2C${
          addr.lng
        }`
      : null;
  const directionsHref =
    addr?.lat && addr?.lng
      ? `https://www.openstreetmap.org/directions?to=${addr.lat}%2C${addr.lng}`
      : undefined;

  return (
    <SiteLayout active="visit">
      <section className="site-section">
        <div className="site-wrap">
          <p className="site-label">Plan Your Visit</p>
          <h1>VISIT</h1>

          <div className="site-grid-2" style={{ marginTop: "2rem" }}>
            {/* Left — address, hours, parking, contact */}
            <div>
              <h2 className="site-h-compact">Where</h2>
              {addr && (
                <address style={{ fontStyle: "normal", lineHeight: 1.8, marginBottom: "1.5rem" }}>
                  {addr.line1}
                  <br />
                  {addr.city}, {addr.state} {addr.zip}
                  {directionsHref && (
                    <>
                      <br />
                      <a href={directionsHref} target="_blank" rel="noreferrer noopener">
                        Get directions →
                      </a>
                    </>
                  )}
                </address>
              )}

              <h2 className="site-h-compact">Hours</h2>
              {copy && (
                <table className="site-hours" style={{ marginBottom: "1.75rem" }}>
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

              <h2 className="site-h-compact">Parking</h2>
              <p style={{ color: "var(--site-ink-dim)", maxWidth: "44ch", marginBottom: "1.75rem" }}>
                {copy?.parking}
              </p>

              <h2 className="site-h-compact">Follow</h2>
              <div className="site-footer__socials">
                {copy?.socials.instagram && copy.socials.instagram !== "#" && (
                  <a href={copy.socials.instagram} target="_blank" rel="noreferrer noopener">
                    Instagram
                  </a>
                )}
                {copy?.socials.facebook && copy.socials.facebook !== "#" && (
                  <a href={copy.socials.facebook} target="_blank" rel="noreferrer noopener">
                    Facebook
                  </a>
                )}
                {copy?.socials.tiktok && copy.socials.tiktok !== "#" && (
                  <a href={copy.socials.tiktok} target="_blank" rel="noreferrer noopener">
                    TikTok
                  </a>
                )}
              </div>
            </div>

            {/* Right — map */}
            <div>
              {mapSrc ? (
                <iframe
                  className="site-map"
                  src={mapSrc}
                  loading="lazy"
                  title="Map to Bunker Club"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <p className="site-empty">Map unavailable.</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}
