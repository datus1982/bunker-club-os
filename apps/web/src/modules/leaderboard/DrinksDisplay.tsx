import { useEffect, useMemo, useState } from "react";
import { DisplayCanvas } from "@/shared/DisplayCanvas";
import { useDrinksBoard, type DrinkItem } from "./useDrinks";

/**
 * /drinks — top-selling drinks board (docs/08 port). Portrait DisplayCanvas (1080×1920),
 * pixel-faithful to the legacy terminal display. Pure realtime reader of sales_cache
 * (AUTH-1 b) — never calls Toast. Perf rules (docs/01): no infinite animations (the
 * legacy CRT flicker loop is dropped; the terminal theme's static scanline stays), no
 * sub-30s polling (realtime only). Rotation is a finite CSS fade per group change.
 */

// Dynamic item-name sizing (ported from legacy getItemNameFontSize), tuned for 1080 canvas.
function itemNameFont(name: string): number {
  const n = name.length;
  if (n <= 12) return 84;
  if (n <= 18) return 76;
  if (n <= 24) return 68;
  if (n <= 30) return 60;
  if (n <= 36) return 54;
  if (n <= 42) return 48;
  return 42;
}

export function DrinksDisplay() {
  const { config, groups, sales } = useDrinksBoard();

  // Only rotate through groups that currently have sales data.
  const activeGroups = useMemo(
    () => groups.filter((g) => (sales[g.toast_menu_guid]?.length ?? 0) > 0),
    [groups, sales],
  );

  const [index, setIndex] = useState(0);

  // Reset index if it falls out of bounds after data changes.
  useEffect(() => {
    if (index >= activeGroups.length && activeGroups.length > 0) setIndex(0);
  }, [activeGroups.length, index]);

  // Auto-rotate (finite interval; no animation loop).
  useEffect(() => {
    if (config.display_mode !== "rotate" || activeGroups.length <= 1) return;
    const t = setInterval(
      () => setIndex((i) => (i + 1) % activeGroups.length),
      Math.max(3, config.auto_rotate_seconds) * 1000,
    );
    return () => clearInterval(t);
  }, [config.display_mode, config.auto_rotate_seconds, activeGroups.length]);

  const current = activeGroups[index];
  const items = current ? sales[current.toast_menu_guid] ?? [] : [];

  return (
    <DisplayCanvas orientation="portrait">
      <style>{FADE_KEYFRAMES}</style>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", color: "var(--terminal-green)" }}>
        {/* Header */}
        <header style={{ flexShrink: 0, height: 360, borderBottom: "2px solid var(--terminal-green)", padding: "40px 56px 24px", display: "flex", flexDirection: "column", justifyContent: "center", textAlign: "center" }}>
          <h1 style={{ fontSize: 72, fontWeight: 700, letterSpacing: 4, textTransform: "uppercase", lineHeight: 1, textShadow: "0 0 12px var(--terminal-glow)", margin: 0 }}>
            {config.header_text}
          </h1>
          <div className="terminal-separator" style={{ margin: "18px 0" }} />
          {current && (
            <>
              <p style={{ fontSize: 64, textTransform: "uppercase", lineHeight: 1, margin: 0, textShadow: "0 0 10px var(--terminal-glow)" }}>
                &gt;&gt; {current.name}
              </p>
              {activeGroups.length > 1 && config.display_mode === "rotate" && (
                <div style={{ display: "flex", gap: 18, marginTop: 18, justifyContent: "center" }}>
                  {activeGroups.map((_, i) => (
                    <div key={i} style={{
                      width: 22, height: 22,
                      border: "2px solid var(--terminal-green)",
                      background: i === index ? "var(--terminal-green)" : "transparent",
                      boxShadow: i === index ? "0 0 15px var(--terminal-glow)" : "none",
                      transform: i === index ? "scale(1.25)" : "none",
                    }} />
                  ))}
                </div>
              )}
            </>
          )}
        </header>

        {/* Cards */}
        <main style={{ flex: 1, overflow: "hidden", padding: "28px 40px", minHeight: 0 }}>
          {items.length > 0 ? (
            <div key={current?.toast_menu_guid} style={{ display: "flex", flexDirection: "column", gap: 20, height: "100%", animation: "drinksFade 0.4s ease-out" }}>
              {items.map((item) => <DrinkCard key={item.rank} item={item} />)}
            </div>
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div className="terminal-border" style={{ padding: 48, textAlign: "center" }}>
                <p style={{ fontSize: 40, textTransform: "uppercase", margin: 0 }}>&gt;&gt; NO SALES DATA YET</p>
                <div className="terminal-separator" style={{ margin: "20px 0" }} />
                <p style={{ fontSize: 26, textTransform: "uppercase", margin: 0, opacity: 0.7 }}>Waiting for tonight's first pours</p>
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer style={{ flexShrink: 0, height: 120, borderTop: "2px solid var(--terminal-green)", padding: "0 56px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 30, fontWeight: 700, textTransform: "uppercase", textAlign: "center", width: "100%", margin: 0 }}>
            {config.footer_text}
          </p>
        </footer>
      </div>
    </DisplayCanvas>
  );
}

function DrinkCard({ item }: { item: DrinkItem }) {
  return (
    <div className="terminal-border" style={{ flex: 1, minHeight: 0, padding: "16px 28px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        {/* Rank badge */}
        <div className="terminal-border" style={{ flexShrink: 0, padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 84, fontWeight: 700, lineHeight: 1 }}>#{item.rank}</span>
        </div>

        {/* Item details */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <h2 style={{ fontSize: itemNameFont(item.item_name), fontWeight: 700, textTransform: "uppercase", lineHeight: 1.05, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip" }}>
            {item.item_name}
          </h2>
          <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginTop: 8 }}>
            <span style={{ fontSize: 64, fontWeight: 700 }}>${Math.round(item.price)}</span>
            <span style={{ fontSize: 52 }}>| SOLD: {item.sales_count}</span>
          </div>
        </div>

        {/* Percentage box */}
        <div className="terminal-border" style={{ flexShrink: 0, padding: "16px 24px", textAlign: "right" }}>
          <span style={{ fontSize: 76, fontWeight: 700 }}>{Math.round(item.sales_percentage)}%</span>
        </div>
      </div>

      {/* Sales bar (static width — no animation loop) */}
      <div className="terminal-border" style={{ marginTop: 16, width: "100%", height: 28 }}>
        <div style={{ height: "100%", width: `${item.sales_percentage}%`, background: "var(--terminal-green)", boxShadow: "0 0 10px var(--terminal-glow)" }} />
      </div>
    </div>
  );
}

// One-shot fade on group change (finite — respects the no-infinite-animation perf rule).
const FADE_KEYFRAMES = `@keyframes drinksFade { from { opacity: 0; transform: translateX(40px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { [style*="drinksFade"] { animation: none !important; } }`;
