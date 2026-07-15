import { useEffect, type CSSProperties, type ReactNode } from "react";
import { useIsMobile } from "@/shared/useIsMobile";

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
 */
const MONO = "'VT323','Share Tech Mono',monospace";

export function SlideOver({
  title, eyebrow, onClose, children, footer, width = 720,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
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
