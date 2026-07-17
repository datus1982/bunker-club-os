import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * React.lazy that survives a stale-chunk import() failure (PR #42 incident residue).
 *
 * A code-split chunk can 404 during a deploy window: a client holding the previous
 * index.html requests a hashed chunk the new deploy has replaced. React.lazy simply
 * rejects → the Suspense subtree unmounts with no error surfaced → a BLACK FRAME on an
 * unattended TV until its next scheduled refresh (04:00). With PR #53 the /assets/* 404
 * function makes the miss uncacheable, so a single reload now reliably re-fetches a fresh
 * index.html + the current chunk map and recovers.
 *
 * So: the FIRST import failure triggers ONE full-page reload. A sessionStorage timestamp
 * caps auto-reloads at one per RELOAD_WINDOW_MS — a genuinely broken deploy (chunk still
 * missing after reload) can't loop-storm; the second failure inside the window renders a
 * plain inline error with a manual RETRY instead. This wraps every route chunk (display
 * surfaces are the priority beneficiary), but is generic and app-wide.
 */

const RELOAD_KEY = "bunker:chunk-reload-at";
const RELOAD_WINDOW_MS = 2 * 60_000; // at most one auto-reload per 2 minutes (loop guard)

function readLastReload(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    return 0; // sessionStorage blocked (private mode) — treat as never reloaded
  }
}

function markReload(now: number): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    /* ignore — best-effort; on failure we simply lose the loop guard for this pageview */
  }
}

/**
 * Minimal, dependency-free fallback shown only when a chunk keeps failing after a reload.
 * Deliberately plain: no terminal-theme classes and no imported UI — those could themselves
 * live in a chunk that just failed to load. Pure inline styles, always in the main bundle.
 */
function ChunkLoadFailed() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        color: "#33ff66",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        padding: "1.5rem",
        textAlign: "center",
        fontFamily: "monospace",
        fontSize: "1rem",
        letterSpacing: "0.08em",
      }}
    >
      <div>DISPLAY FAILED TO LOAD</div>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.removeItem(RELOAD_KEY);
          } catch {
            /* ignore */
          }
          window.location.reload();
        }}
        style={{
          background: "transparent",
          color: "#33ff66",
          border: "1px solid #33ff66",
          padding: "0.5rem 1.1rem",
          fontFamily: "monospace",
          fontSize: "0.9rem",
          letterSpacing: "0.08em",
          cursor: "pointer",
        }}
      >
        RETRY
      </button>
    </div>
  );
}

export function lazyWithReload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err) => {
      const now = Date.now();
      if (now - readLastReload() > RELOAD_WINDOW_MS) {
        markReload(now);
        window.location.reload();
        // Never resolve: keep Suspense in its fallback until the navigation replaces the page,
        // so nothing flashes in the interim.
        return new Promise<{ default: T }>(() => {});
      }
      // Reloaded recently and the chunk STILL won't load — stop looping, show the plain error.
      console.error("[lazyWithReload] chunk load failed after reload", err);
      return { default: ChunkLoadFailed as unknown as T };
    }),
  );
}
