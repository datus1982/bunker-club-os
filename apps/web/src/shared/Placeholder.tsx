import type { ReactNode } from "react";
import { DisplayCanvas } from "./DisplayCanvas";

/**
 * Phase 0 shell stubs. Every module route resolves to one of these so the app
 * boots, the router is exercised, and the terminal theme is visibly applied.
 * Real module UIs replace these in their phases.
 */
export function Placeholder({
  title,
  phase,
  children,
}: {
  title: string;
  phase: string;
  children?: ReactNode;
}) {
  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: 48 }}>
      <div className="terminal-text" style={{ fontSize: 40, marginBottom: 8 }}>
        BUNKER UNIFIED OS
      </div>
      <div className="terminal-separator" />
      <h2>{title}</h2>
      <p style={{ opacity: 0.8 }}>Scaffolding — implemented in {phase}.</p>
      {children}
    </div>
  );
}

/** Display-route stub, rendered through the fixed-canvas scaler. */
export function DisplayPlaceholder({
  title,
  orientation,
}: {
  title: string;
  orientation: "landscape" | "portrait";
}) {
  return (
    <DisplayCanvas orientation={orientation}>
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ fontSize: 96 }}>BUNKER UNIFIED OS</div>
        <div style={{ fontSize: 48, opacity: 0.8 }}>{title}</div>
        <div style={{ fontSize: 28, opacity: 0.6, marginTop: 24 }}>
          add ?calibrate to this URL for the test pattern
        </div>
      </div>
    </DisplayCanvas>
  );
}
