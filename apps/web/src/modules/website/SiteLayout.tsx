import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import "./site.css";
import {
  useSiteCopy,
  fmtHours,
  todayKey,
  dayLabel,
} from "./useSiteCopy";

/**
 * Public-site chrome (docs/14): slim sticky header with the BUNKER CLUB
 * wordmark + primary nav (mobile hamburger drawer), a content slot, and a
 * footer (address, hours summary, socials, BUNKER UNIFIED OS credit, subtle
 * staff link). Never wrapped in `.terminal-theme` — the site owns its styling
 * via `.site` in site.css. Mobile-first; no horizontal overflow at 390px.
 */

type PageId = "home" | "menu" | "events" | "trivia" | "visit" | "about";

const NAV: { id: PageId; to: string; label: string }[] = [
  { id: "menu", to: "/menu", label: "Menu" },
  { id: "events", to: "/events", label: "Events" },
  { id: "trivia", to: "/trivia", label: "Trivia" },
  { id: "visit", to: "/visit", label: "Visit" },
  { id: "about", to: "/about", label: "About" },
];

export function SiteLayout({ active, children }: { active: PageId; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { data: copy } = useSiteCopy();

  const tkey = todayKey();
  const todayHours = copy?.hours?.[tkey];

  return (
    <div className="site">
      <header className="site-header">
        <div className="site-wrap site-header__bar">
          <Link to="/" className="site-wordmark" aria-label="Bunker Club — home">
            BUNKER CLUB
          </Link>

          <nav className="site-nav" aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.id} to={n.to} aria-current={active === n.id ? "page" : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            className="site-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "✕" : "☰"}
          </button>
        </div>

        {open && (
          <nav className="site-wrap site-drawer" aria-label="Primary mobile">
            {NAV.map((n) => (
              <Link
                key={n.id}
                to={n.to}
                aria-current={active === n.id ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="site-wrap">
          <div className="site-footer__cols">
            <div>
              <h2>Find Us</h2>
              {copy && (
                <address style={{ fontStyle: "normal", lineHeight: 1.7 }}>
                  {copy.address.line1}
                  <br />
                  {copy.address.city}, {copy.address.state} {copy.address.zip}
                  <br />
                  <Link to="/visit">Map &amp; parking →</Link>
                </address>
              )}
            </div>

            <div>
              <h2>Hours</h2>
              {copy && (
                <p style={{ margin: 0, lineHeight: 1.7 }}>
                  Today ({dayLabel(tkey)}):
                  <br />
                  <span style={{ color: "var(--site-amber)" }}>{fmtHours(todayHours ?? null)}</span>
                  <br />
                  <Link to="/visit">Full hours →</Link>
                </p>
              )}
            </div>

            <div>
              <h2>Follow</h2>
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
          </div>

          <div className="site-footer__legal">
            <span className="site-cred">
              ▲ POWERED BY BUNKER UNIFIED OS
            </span>
            <span>
              © {new Date().getFullYear()} Bunker Club ·{" "}
              <Link to="/login" className="site-staff-link">
                STAFF
              </Link>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
