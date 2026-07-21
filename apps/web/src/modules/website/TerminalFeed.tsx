import { useEffect, useMemo, useRef, useState } from "react";

import type { StripCard } from "./useThisWeek";

/**
 * "What's On" as a BUNKER UNIFIED OS terminal feed (owner ask, 2026-07-14): a
 * framed terminal window that ROTATES through the assembled cards one at a time,
 * each streaming on with a finite type-on effect (kicker → title → body, a block
 * cursor while typing). This is the site's one place of extra terminal energy —
 * still amber/cream on the site's near-black, VT323 for the terminal type, NOT the
 * green staff theme.
 *
 * Rules honoured:
 *  • Finite animation — the type-on ends per item; the rotation is a plain timer.
 *  • prefers-reduced-motion — DECISION: fall back to the static card GRID (all
 *    items visible at once, no typing, no rotation). Unambiguously motion-safe and
 *    reuses the existing .site-card markup, so nothing is lost.
 *  • SEO / a11y — the animated screen is aria-hidden (presentational); every card's
 *    full text also lives in an always-present visually-hidden list, so crawlers and
 *    screen readers get the complete content, not just the frame that's typing.
 *  • No layout shift — the screen area reserves a fixed min-height, so revealing
 *    text fills a stable box (Lighthouse: no new CLS).
 */

const HOLD_MS = 6500; // dwell after an item finishes typing, before advancing
const CPS = 42; // type-on reveal speed (chars/second) — brisk but legible

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

type TypeState = {
  kicker: string;
  title: string;
  body: string;
  done: boolean;
  /** Which segment the cursor block currently sits after while typing (null when done). */
  cursor: "kicker" | "title" | "body" | null;
};

/** Reveal a card's three segments in sequence, char by char (rAF-driven, finite). */
function useTypeOn(card: StripCard | undefined, enabled: boolean): TypeState {
  const segs = useMemo(
    () => ({ kicker: card?.kicker ?? "", title: card?.title ?? "", body: card?.body ?? "" }),
    [card],
  );
  const total = segs.kicker.length + segs.title.length + segs.body.length;
  const [n, setN] = useState(enabled ? 0 : total);

  useEffect(() => {
    if (!enabled) {
      setN(total);
      return;
    }
    setN(0);
    let raf = 0;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const chars = Math.min(total, Math.floor(((ts - start) / 1000) * CPS));
      setN(chars);
      if (chars < total) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Re-run whenever the visible card changes (its key) or motion pref flips.
  }, [card?.key, enabled, total]);

  const kLen = segs.kicker.length;
  const tLen = segs.title.length;
  const kicker = segs.kicker.slice(0, Math.min(n, kLen));
  const afterK = Math.max(0, n - kLen);
  const title = segs.title.slice(0, Math.min(afterK, tLen));
  const afterT = Math.max(0, afterK - tLen);
  const body = segs.body.slice(0, Math.min(afterT, segs.body.length));
  const done = n >= total;
  const cursor: TypeState["cursor"] = !enabled || done ? null : afterK === 0 ? "kicker" : afterT === 0 ? "title" : "body";
  return { kicker, title, body, done, cursor };
}

const Cursor = () => <span className="site-feed__cursor" aria-hidden="true" />;

/** The static grid — used as the reduced-motion fallback and shared card markup. */
function FeedGrid({ cards }: { cards: StripCard[] }) {
  return (
    <div className="site-strip">
      {cards.map((c) => (
        <article
          key={c.key}
          className={`site-card${c.live ? " site-card--live" : ""}${c.image ? " site-card--media" : ""}`}
        >
          {c.image && (
            <img className="site-card__thumb" src={c.image} alt="" loading="lazy" decoding="async" />
          )}
          <div className="site-card__main">
            <div className="site-card__kicker">
              {c.live && <span className="site-dot" aria-hidden />}
              {c.badge ? `${c.kicker} · ${c.badge}` : c.kicker}
            </div>
            <p className="site-card__title">{c.title}</p>
            {c.body && <p className="site-card__body">{c.body}</p>}
            {c.credit && <p className="site-card__credit">{c.credit}</p>}
          </div>
        </article>
      ))}
    </div>
  );
}

export function TerminalFeed({ cards }: { cards: StripCard[] }) {
  const reduced = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const many = cards.length > 1;

  // Keep the index valid if the feed shrinks (data refetch).
  useEffect(() => {
    if (i >= cards.length) setI(0);
  }, [cards.length, i]);

  const active = cards[Math.min(i, Math.max(0, cards.length - 1))];
  const type = useTypeOn(active, !reduced);

  // Advance after the item finishes typing + a dwell. Only rotates with >1 card and
  // when not paused (hover/focus). Under reduced motion `type.done` is always true, so
  // this becomes a plain instant-swap rotation.
  const advanceRef = useRef(setI);
  advanceRef.current = setI;
  useEffect(() => {
    if (reduced || !many || paused || !type.done) return;
    const t = setTimeout(() => advanceRef.current((p) => (p + 1) % cards.length), HOLD_MS);
    return () => clearTimeout(t);
  }, [reduced, many, paused, type.done, i, cards.length]);

  if (cards.length === 0) {
    return (
      <p className="site-empty">
        Nothing on the board right now — check back soon, or swing by the bar.
      </p>
    );
  }

  // Reduced motion → static grid (motion-safe, all content visible).
  if (reduced) return <FeedGrid cards={cards} />;

  return (
    <div
      className="site-feed"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div className="site-feed__bar" aria-hidden="true">
        <span className="site-feed__lights">
          <i />
          <i />
          <i />
        </span>
        <span className="site-feed__name">BUNKER UNIFIED OS — LIVE FEED</span>
        <span className="site-feed__status">
          <span className="site-dot" /> LIVE
        </span>
      </div>

      {/* Animated screen — presentational only (the SR/crawler copy is the list below). */}
      <div className="site-feed__screen" aria-hidden="true">
        {active.image && (
          <img
            className="site-feed__thumb"
            src={active.image}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="site-feed__text">
          <div className={`site-feed__kicker${active.live ? " is-live" : ""}`}>
            {active.badge && <span className="site-feed__badge">{active.badge}</span>}
            <span className="site-feed__prompt">&gt;</span>
            <span>{type.kicker}</span>
            {type.cursor === "kicker" && <Cursor />}
          </div>
          <p className="site-feed__title">
            {type.title}
            {type.cursor === "title" && <Cursor />}
          </p>
          {active.body && (
            <p className="site-feed__body">
              {type.body}
              {type.cursor === "body" && <Cursor />}
            </p>
          )}
          {/* Attribution — shown once the card has fully typed on (finite), so it never streams
              character-by-character like content; it's a static credit, not part of the message. */}
          {active.credit && type.done && <p className="site-feed__credit">{active.credit}</p>}
        </div>
      </div>

      {/* Position / jump controls */}
      {many && (
        <div className="site-feed__dots">
          {cards.map((c, idx) => (
            <button
              key={c.key}
              type="button"
              className={`site-feed__dot${idx === i ? " is-on" : ""}`}
              aria-label={`Show: ${c.kicker} — ${c.title}`}
              aria-current={idx === i ? "true" : undefined}
              onClick={() => setI(idx)}
            />
          ))}
        </div>
      )}

      {/* Full content for crawlers + assistive tech (kept out of view, always in the DOM). */}
      <ul className="site-sr-only">
        {cards.map((c) => (
          <li key={c.key}>
            {c.kicker}
            {c.badge ? ` (${c.badge})` : ""}: {c.title}
            {c.body ? ` — ${c.body}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
