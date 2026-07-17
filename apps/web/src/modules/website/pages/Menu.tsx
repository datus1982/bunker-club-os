import { SiteLayout } from "../SiteLayout";
import { useMenu } from "../useMenu";
import { useDocumentMeta } from "../seo";

/**
 * Menu (`/menu`) — the live bar menu, powered by the anon-safe `public_menu` view
 * (0015). Grouped sections in a bar-sensible order; each row shows name, optional
 * public blurb, and price. 86'd items are hidden (useMenu). Photos appear only where
 * Toast has one, as small lazy-loaded thumbnails — restraint, not a photo grid.
 * Empty-state tolerant (renders a friendly line if the menu hasn't synced).
 */
export function Menu() {
  const { data: groups, isLoading } = useMenu();
  useDocumentMeta({
    title: "Menu — Bunker Club · NW 23rd, OKC",
    description:
      "Drafts, cocktails, shots, spirits and more at Bunker Club on NW 23rd Street in Oklahoma City. Our live menu, straight from the bar.",
    path: "/menu",
  });

  const hasItems = groups && groups.length > 0;

  return (
    <SiteLayout active="menu">
      <section className="site-section">
        <div className="site-wrap">
          <p className="site-label">From the Bar</p>
          <h1>MENU</h1>
          <p style={{ color: "var(--site-ink-dim)", maxWidth: "52ch", marginTop: "0.5rem" }}>
            Pouring now at Bunker Club. Prices and availability update live — if it&apos;s
            listed, it&apos;s in the well.
          </p>

          {!hasItems ? (
            <p className="site-empty" style={{ marginTop: "2rem" }}>
              {isLoading
                ? "Loading the menu…"
                : "The menu is refreshing — check back in a moment, or ask at the bar."}
            </p>
          ) : (
            <div style={{ marginTop: "2.5rem", display: "flex", flexDirection: "column", gap: "2.75rem" }}>
              {groups!.map((g) => (
                <section key={g.group} aria-labelledby={`grp-${g.group}`}>
                  <h2 className="site-h-compact site-menu-group" id={`grp-${g.group}`}>
                    {g.group}
                  </h2>
                  <ul className="site-menu-list">
                    {g.items.map((it) => (
                      <li key={it.guid} className="site-menu-item">
                        {it.image && (
                          <img
                            className="site-menu-thumb"
                            src={it.image}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                        <div className="site-menu-item__body">
                          <div className="site-menu-item__head">
                            <span className="site-menu-item__name">{it.name}</span>
                            <span className="site-menu-item__dots" aria-hidden />
                            {/* Pour-size options (0050) render IN PLACE of the single price —
                                a $0-base liquor/draft item's real prices live here (SHOT/
                                COCKTAIL/DOUBLE, PINT/PITCHER). When there are options the base
                                price is meaningless, so it's never shown alongside. Falls back
                                to the single price otherwise; DECISION: hide a 0/null price
                                (variable/ask-the-bar items shouldn't render "$0"). */}
                            {it.priceOptions ? (
                              <span className="site-menu-item__options">
                                {it.priceOptions.map((o, i) => (
                                  <span key={`${o.label}-${i}`} className="site-menu-opt">
                                    <span className="site-menu-opt__label">{o.label}</span>
                                    <span className="site-menu-opt__price">${fmtPrice(o.price)}</span>
                                  </span>
                                ))}
                              </span>
                            ) : (
                              it.price != null &&
                              it.price > 0 && (
                                <span className="site-menu-item__price">${fmtPrice(it.price)}</span>
                              )
                            )}
                          </div>
                          {it.blurb && <p className="site-menu-item__blurb">{it.blurb}</p>}
                          {it.longBlurb && (
                            <p className="site-menu-item__longform">{it.longBlurb}</p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>
    </SiteLayout>
  );
}

/** Whole-dollar prices render without cents ("$6"), fractional with two decimals ("$6.50"). */
function fmtPrice(price: number): string {
  return Number.isInteger(price) ? String(price) : price.toFixed(2);
}
