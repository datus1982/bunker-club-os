import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useIsMobile } from "@/shared/useIsMobile";
import { space, TAP } from "@/shared/ui/tokens";

/**
 * SlideOver — the hub's overlay surface (docs/signage-hub-consolidation-mockup.html).
 *
 * The consolidation retires every signage sub-page: + ADD, QUEUE, TAKEOVER and the event
 * editor all open OVER the hub instead of navigating. On desktop this is a right-anchored
 * drawer; on mobile (≤640px, bar-ops is phone-first) it goes full-screen — the ratified
 * mockup's view-7 rule. Terminal theme throughout; pinned header (title + ✕) with a single
 * scrolling body, matching the trivia Modal's pinned-header idiom.
 *
 * Backdrop click + Esc close. `width` sizes the desktop drawer only (mobile is always 100vw).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * BEAT 8 (PR 1) — `variant`, and why the two legs are written out separately.
 *
 * Stephen's ruling (Marvin, 2026-09-12): every overlay a v2 page can open must render in
 * the v2 tokens; classic stays byte-identical. This component is the frame EVERY signage
 * slide-over mounts in (+ADD, QUEUE, TAKEOVER, EVENT, PROGRAM, SCHEDULE, the slide editor,
 * the playlist editor), and it is SHARED — the classic hub mounts the same node. So the
 * classic branch below is the shipped markup character for character, and the v2 branch is
 * a separate `return`. Not a pile of ternaries: a shared tree with a dozen `v2 &&` forks is
 * exactly how a "byte-identical" claim rots. The two hooks above the branch run
 * unconditionally, so hook order is stable across a variant change.
 *
 * `variant` DEFAULTS TO "classic" and NO CALLER PASSES "v2" IN THIS PR. PR 1 ships inert on
 * purpose: the frame and its token rules land, and classic **and** v2 are proven pixel- and
 * innerHTML-identical before a single surface moves (PRs 2–6 flip the callers one family at
 * a time, so a regression is attributable to one family).
 *
 * THE v2 LEG, decision by decision:
 *  · `st-sheet` on the backdrop + `st-panel` on the drawer — the same two hooks
 *    `ConfirmDialog` uses. `st-sheet` is the token sheet's third scope (a v2 overlay that
 *    is not inside a `[data-st-page]` root; every signage slide-over is mounted OUTSIDE the
 *    page wrapper deliberately, see SignageHubV2.tsx:68-78). It also buys the ratified
 *    scanline/vignette suppression at staff-tokens-v2.css §7 for free.
 *  · `terminal-theme staff-ui` STAY on the backdrop. They are what make the nested
 *    primitives resolve at all (`.staff-ui button` sizing, the `u-*` utilities the bodies
 *    still carry), and `ConfirmDialog` keeps them for the same reason.
 *  · The header title is a `role="heading"` DIV, not the classic `<h2>`: `.terminal-theme
 *    h2 { font-size: 2rem !important }` beats an inline size, so an `<h2>` would ignore the
 *    `st-heading` role (the Beat 1 `StaffPageHeader` lesson, and PR #89's before it).
 *  · No `fontFamily` on the v2 backdrop. The classic leg's `MONO` there is already INERT —
 *    `.staff-ui, .staff-ui * { font-family: JetBrains !important }` (terminal-theme.css:534)
 *    beats an inline family — so dropping it changes nothing and stops implying VT323.
 *  · `st-drawer` (+ `st-drawer-full` on phones) carries the edge geometry: a full-height
 *    right-anchored panel wants its two LEFT corners rounded and its left edge only, which
 *    the generic `.st-sheet .st-panel` rule (all four corners, a full frame) cannot express.
 *    The mobile full-screen case is a JS class, not a media query, so it cannot drift from
 *    the `useIsMobile(640)` breakpoint that decides the geometry two lines above it.
 *
 * MOTION — ENTER ONLY, and that is a DECISION, not an omission.
 *  The panel carries `data-state="entering"`, which is the attribute the ratified sheet
 *  motion already keys on: the backdrop's `st-backdrop-enter` fade (bound via
 *  `:has(.st-panel[data-state="entering"])`) applies verbatim, and a `.st-drawer` rule
 *  replaces the centre-dialog's 8px Y-rise with the 10px X-slide §B asks for on an
 *  edge-anchored surface (10px is `sv2-drawer-in`'s existing number — no new constant).
 *  There is NO exit. An exit means a deferred unmount, which means porting ConfirmDialog's
 *  ~70-line phase machine (entering → exiting → closed, the `animationend`-vs-fallback-timer
 *  race, the re-open-inside-the-exit-window retarget heuristic keyed on `title`). That is
 *  not "cheap and identical", and getting it subtly wrong here strands a transparent
 *  click-blocker over the hub — the exact failure mode that machine exists to prevent. Every
 *  caller unmounts this component synchronously on close today, so enter-only is honest:
 *  the drawer slides in and disappears on close, which is what it does now. An exit is a
 *  later beat, and it should move BOTH surfaces onto one shared hook rather than grow a
 *  second copy of the machine.
 * ───────────────────────────────────────────────────────────────────────────────────── */
const MONO = "'VT323','Share Tech Mono',monospace";

export function SlideOver({
  title, eyebrow, onClose, children, footer, width = 720, variant = "classic",
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** "v2" renders the tokened sheet. Defaults to the shipped classic drawer. */
  variant?: "classic" | "v2";
}) {
  const isMobile = useIsMobile();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const panel: CSSProperties = isMobile
    ? { width: "100vw", height: "100dvh", maxWidth: "100vw" }
    : { width: `min(${width}px, 96vw)`, height: "100dvh", marginLeft: "auto" };

  if (variant === "v2") {
    return (
      <div
        onClick={onClose}
        className="terminal-theme staff-ui st-sheet"
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
          display: "flex", justifyContent: "flex-end",
        }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          data-state="entering"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={`st-panel st-drawer${isMobile ? " st-drawer-full" : ""}`}
          /* NOTE-7 (review): `overflow: hidden` matches ConfirmDialog's panel. The desktop
             drawer rounds its two LEFT corners, and without this a header or footer row
             with its own background paints square into them. Inert on phones (no corners
             there) and harmless to the body, which does its own scrolling. */
          style={{ ...panel, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          {/* Header — pinned (does not scroll). `borderBottom: "1px solid"` with no colour
              is the ConfirmDialog idiom: the blanket paints it the hairline. */}
          <div style={v2Head}>
            <div style={{ minWidth: 0 }}>
              {eyebrow && <div className="st-label st-t3">{eyebrow}</div>}
              <div
                role="heading"
                aria-level={2}
                className="u-head st-heading st-t1"
                style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              >{title}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="st-btn st-body st-t2"
              /* NOTE-7/8 (review): `border: "1px solid"` — WIDTH and STYLE only; the colour
                 is the token sheet's (`.st-sheet button { border-color: hairline-strong }`),
                 the same split ConfirmDialog's footer rows use. Without it this renders as a
                 BARE GLYPH: the base theme sets `border-color` on a button but never a
                 width, and Tailwind's preflight zeroes it — so dropping the classic leg's
                 inline `1px solid var(--terminal-green)` had quietly removed the frame that
                 makes the close affordance read as a control. */
              style={{ minWidth: TAP, minHeight: TAP, cursor: "pointer", flexShrink: 0, border: "1px solid" }}
            >✕</button>
          </div>
          {/* Body — the only scrolling region. `st-body` sizes THIS element; its children
              keep their own sizes (nothing inherits font-size in this app), which is what
              PRs 2–6 token one family at a time. */}
          <div className="st-body" style={v2Body}>
            {children}
          </div>
          {footer && <div style={v2Foot}>{footer}</div>}
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      className="terminal-theme staff-ui"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 1000,
        display: "flex", justifyContent: "flex-end", fontFamily: MONO,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="terminal-border"
        style={{
          ...panel, background: "#000", display: "flex", flexDirection: "column",
          borderTop: "none", borderRight: "none", borderBottom: "none",
          boxShadow: "-8px 0 32px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header — pinned (does not scroll) */}
        <div style={{ padding: "16px 20px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, borderBottom: "1px solid var(--terminal-green)" }}>
          <div style={{ minWidth: 0 }}>
            {eyebrow && <div style={{ fontSize: 12, letterSpacing: 3, opacity: 0.55 }}>{eyebrow}</div>}
            <h2 style={{ fontSize: 28, fontWeight: 700, letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--terminal-green)" }}>{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", minWidth: 44, minHeight: 44, fontSize: 18, cursor: "pointer", fontFamily: MONO, flexShrink: 0 }}
          >✕</button>
        </div>
        {/* Body — the only scrolling region */}
        <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "16px 20px 24px", color: "var(--terminal-green)" }}>
          {children}
        </div>
        {footer && (
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", padding: "14px 20px", borderTop: "1px solid var(--terminal-green)", background: "#000" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* v2 geometry — the 8pt scale, so the drawer measures like every other v2 surface.
 * No `background` on the header/footer: the panel's surface-4 fill is the surface, and
 * the classic leg's `#000` footer fill exists only because its panel is black. */
const v2Head: CSSProperties = {
  padding: `${space.s4}px ${space.s6}px ${space.s3}px`,
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: space.s3, borderBottom: "1px solid",
};
const v2Body: CSSProperties = {
  flex: "1 1 auto", overflowY: "auto",
  padding: `${space.s4}px ${space.s6}px ${space.s6}px`,
};
/* `flexWrap` for the same measured reason as ConfirmDialog's footer: the buttons carry
 * `minWidth: TAP`, and a min-width defeats flex shrinking — without wrapping an over-long
 * pair spills its text past its own borders instead of stacking. */
const v2Foot: CSSProperties = {
  display: "flex", flexWrap: "wrap", gap: space.s3, justifyContent: "flex-end",
  padding: `${space.s4}px ${space.s6}px`, borderTop: "1px solid",
};
