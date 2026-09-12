import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

/**
 * The v2 two-tier staff navigation (audit §5 #2, mockup views 1–3).
 *
 * Desktop: top row = brand · HOME · section names · (extra) · VIEWING AS · SIGN OUT,
 * with a sub-nav row revealing the ACTIVE section's children. Optional dim group
 * kickers inside the sub-nav (e.g. `TRIVIA ▸` before the trivia tools) plus a hairline
 * divider where the group changes — a visual grouping only, never a third tier.
 *
 * Mobile (<640px, the shared `useIsMobile` breakpoint, passed in by the shell): a
 * compact bar plus a full-height drawer — HOME pinned at the top, section names as
 * STICKY non-tappable headers with their children indented, one thumb-scroll, and
 * VIEWING AS + the extras + SIGN OUT pinned to the bottom.
 *
 * Active state is passed in (`activeTo`) rather than derived from NavLink, because two
 * children can share a pathname and differ only by hash (`/signage#events` vs
 * `/signage#library`) — NavLink's isActive cannot tell them apart.
 *
 * The drawer is a `role="menu"`: ArrowUp/ArrowDown/Home/End move focus, Escape closes
 * and returns focus to the toggle (audit finding #3 — done here because the nav is new;
 * classic is deliberately NOT retrofitted).
 *
 * BEAT 6 (PR 1): text tiers come from the `st-t*` token classes (an inline colour can
 * never win against `.terminal-theme * { color: green !important }`), and SIGN OUT
 * drops `u-amber` — §B takes a routine, reversible action off the warning ink. The
 * ACTIVE treatment still uses `u-fill u-ink`: the token sheet re-declares both inside
 * the v2 scope, so the fill is the calmed accent and the ink is the ground colour.
 */

export interface SectionNavChild {
  to: string;
  label: string;
  end?: boolean;
  comingSoon?: boolean;
  group?: string;
  /** One-line task description, rendered under the label in the mobile drawer (§C5). */
  task?: string;
}
export interface SectionNavSection {
  label: string;
  children: SectionNavChild[];
}

/**
 * A drawer entry: the Label-role name, plus the one-line TASK description when the nav
 * data carries one (audit §C5). Desktop's chip strip has no room for the second line, so
 * it renders the label alone — the description is a phone-drawer affordance.
 * Sizes/colour come from the token classes: nothing inherits font-size here (PR #89) and
 * an inline colour cannot beat `.terminal-theme * { color: green !important }`.
 */
function DrawerLabel({ child }: { child: SectionNavChild }) {
  if (!child.task) return <>{child.label}</>;
  // BOTH `fontSize: "inherit"` values below are LOAD-BEARING, and the OUTER one is the
  // one that is easy to miss: wrapping the label in spans moved it out of the <a>'s own
  // size and under `.terminal-theme * { font-size: 1.5rem }` — a class rule on every
  // element, which inheritance (zero specificity) never beats. Without the outer
  // `inherit` the label "inherits" 24px from this wrapper instead of 14/15px from the
  // link, which is exactly what happened (the PR #89 class, twice in one component).
  // Hierarchy against the 15px Body task line comes from case + weight + tier, not size.
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, padding: "4px 0", fontSize: "inherit" }}>
      <span style={{ fontSize: "inherit", fontWeight: 700, letterSpacing: "0.04em" }}>{child.label}</span>
      {/* Helper copy is SECONDARY, not Disabled: §B assigns "labels, captions, helper
          copy, metadata" to Secondary, and the Disabled tier (0.38α) measures ~3.5:1 —
          under AA on every surface. Disabled is for disabled controls, placeholders and
          least-important timestamps only. */}
      <span className="st-body st-t2">{child.task}</span>
    </span>
  );
}

export function SectionNav({
  brand = "▚ BUNKER OS",
  home,
  sections,
  activeTo,
  activeSectionLabel,
  isMobile,
  roleLabel,
  onSignOut,
  extra,
  sectionExtra,
  locationKey,
}: {
  brand?: string;
  /** HOME entry, or null when the viewer can't see it. */
  home: SectionNavChild | null;
  sections: SectionNavSection[];
  /** `to` of the active child (already gate-filtered + resolved by the shell). */
  activeTo?: string;
  activeSectionLabel?: string;
  isMobile: boolean;
  roleLabel: string;
  onSignOut: () => void;
  /** Shell-level extras (the classic/v2 switch) — desktop top row + drawer footer. */
  extra?: ReactNode;
  /**
   * SECTION-level extra (polish arc 2, PR 3): the trivia look switch, which belongs to
   * the GAMES ▸ TRIVIA sub-nav row, not to the shell. Desktop renders it at the end of
   * the sub-nav row; mobile has no sub-nav row, so it joins the drawer footer beside
   * `extra` — both switches then sit together in the one place a phone user looks for
   * them. Omitted (and the shell passes nothing) on every non-trivia page.
   */
  sectionExtra?: ReactNode;
  /** Router `location.key` — the drawer closes on ANY route change, including browser
   *  back/forward (link taps alone would miss those; classic closes on pathname). */
  locationKey?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const itemRefs = useRef<HTMLElement[]>([]);

  // Drop the drawer when we cross up to the desktop bar.
  useEffect(() => { if (!isMobile) setOpen(false); }, [isMobile]);
  // Close on every navigation (covers hardware/browser back, not just our own links).
  useEffect(() => { setOpen(false); }, [locationKey]);

  const activeSection = sections.find((s) => s.label === activeSectionLabel);
  const activeChild =
    (home && home.to === activeTo ? home : undefined) ??
    sections.flatMap((s) => s.children).find((c) => c.to === activeTo);

  // Clicking a section name jumps to its first REAL child (placeholders never navigate).
  const goToSection = (s: SectionNavSection) => {
    const first = s.children.find((c) => !c.comingSoon && c.to);
    if (first) navigate(first.to);
  };

  const close = useCallback(() => setOpen(false), []);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = itemRefs.current.filter(Boolean);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[i < 0 || i === items.length - 1 ? 0 : i + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[i <= 0 ? items.length - 1 : i - 1]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();
    }
  };

  // Collect focusable menu items in DOM order on every open (placeholders are skipped —
  // DECISION: aria-disabled entries stay out of the focus ring; there is nothing to
  // activate and stepping through dead rows costs the one-thumb-scroll its speed).
  const collect = (el: HTMLElement | null, idx: number) => {
    if (el) itemRefs.current[idx] = el;
  };

  /* ── mobile ─────────────────────────────────────────────────────────────── */
  if (isMobile) {
    itemRefs.current = [];
    let idx = 0;
    return (
      <nav className="sv2-nav sv2-nav-mobile">
        <div className="sv2-mbar">
          <Link to={home?.to ?? "/dashboard"} className="u-head st-heading st-t1 sv2-brand">{brand}</Link>
          {activeChild && activeChild.to !== home?.to && (
            <span className="st-t2 sv2-mcrumb" aria-hidden="true">▸ {activeChild.label}</span>
          )}
          <button
            type="button"
            ref={toggleRef}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className={"sv2-mtoggle" + (open ? " u-fill u-ink" : "")}
          >
            {open ? "▟ CLOSE" : "▚ MENU"}
          </button>
        </div>
        {open && (
          <>
            <div className="sv2-backdrop" onClick={close} aria-hidden="true" />
            <div className="sv2-drawer" role="menu" aria-label="Staff navigation" onKeyDown={onMenuKeyDown}>
              <div className="sv2-drawer-top">
                {home && (
                  <Link
                    to={home.to}
                    role="menuitem"
                    ref={(el) => collect(el, idx++)}
                    onClick={close}
                    className={"sv2-dlink sv2-dhome" + (activeTo === home.to ? " u-fill u-ink sv2-on" : "")}
                  >
                    <DrawerLabel child={home} />
                  </Link>
                )}
              </div>
              <div className="sv2-drawer-scroll">
                {sections.map((s) => (
                  <div key={s.label}>
                    {/* Sticky, deliberately NOT tappable (mockup view 3). */}
                    <div className="st-label st-t2 sv2-dsect" aria-hidden="true">{s.label}</div>
                    {s.children.map((c) =>
                      c.comingSoon ? (
                        <span key={s.label + c.label} className="sv2-dlink sv2-dsub sv2-soon" aria-disabled="true">
                          {c.label}<span className="sv2-soon-tag">COMING SOON</span>
                        </span>
                      ) : (
                        <Link
                          key={c.to}
                          to={c.to}
                          role="menuitem"
                          ref={(el) => collect(el, idx++)}
                          onClick={close}
                          className={"sv2-dlink sv2-dsub" + (activeTo === c.to ? " u-fill u-ink sv2-on" : "")}
                        >
                          <DrawerLabel child={c} />
                        </Link>
                      ),
                    )}
                  </div>
                ))}
              </div>
              <div className="sv2-drawer-foot">
                <span className="st-t2 sv2-viewas">{roleLabel}</span>
                {sectionExtra}
                {extra}
                <button type="button" onClick={onSignOut} className="st-t2 sv2-signout">SIGN OUT</button>
              </div>
            </div>
          </>
        )}
      </nav>
    );
  }

  /* ── desktop ────────────────────────────────────────────────────────────── */
  return (
    <nav className="sv2-nav">
      <div className="sv2-toprow">
        <Link to={home?.to ?? "/dashboard"} className="u-head st-heading st-t1 sv2-brand">{brand}</Link>
        <div className="sv2-sections">
          {home && (
            <Link
              to={home.to}
              className={"u-head sv2-sect" + (activeTo === home.to ? " u-fill u-ink sv2-on" : "")}
            >
              {home.label}
            </Link>
          )}
          {sections.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => goToSection(s)}
              className={"u-head sv2-sect" + (s.label === activeSectionLabel ? " u-fill u-ink sv2-on" : "")}
            >
              {s.label}
            </button>
          ))}
        </div>
        {extra}
        <span className="st-t2 sv2-viewas">{roleLabel}</span>
        <button type="button" onClick={onSignOut} className="st-t2 sv2-signout">SIGN OUT</button>
      </div>
      {activeSection && (
        <div className="sv2-subrow">
          <span className="st-label st-t2 sv2-subkick">{activeSection.label} ▸</span>
          {activeSection.children.map((c, i, arr) => {
            const prev = i > 0 ? arr[i - 1] : undefined;
            const groupChanged = i === 0 ? !!c.group : c.group !== prev?.group;
            return (
              <span key={(c.to || c.label) + i} className="sv2-subwrap">
                {i > 0 && groupChanged && <span className="sv2-divider" aria-hidden="true" />}
                {groupChanged && c.group && <span className="st-label st-t2 sv2-groupkick">{c.group}</span>}
                {c.comingSoon ? (
                  <span className="sv2-subitem sv2-soon" aria-disabled="true">
                    {c.label}<span className="sv2-soon-tag">COMING SOON</span>
                  </span>
                ) : (
                  <Link
                    to={c.to}
                    className={"sv2-subitem" + (activeTo === c.to ? " u-fill u-ink sv2-on" : "")}
                  >
                    {c.label}
                  </Link>
                )}
              </span>
            );
          })}
          {sectionExtra && <span className="sv2-subextra">{sectionExtra}</span>}
        </div>
      )}
    </nav>
  );
}
