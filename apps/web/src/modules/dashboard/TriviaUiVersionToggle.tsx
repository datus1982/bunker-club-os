import type { CSSProperties } from "react";
import { useTriviaUiVersion } from "@/shared/useTriviaUiVersion";

/**
 * The trivia page-look switch (polish arc 2, PR 3 — spec §A1, owner letter A1).
 *
 * Lives in the GAMES ▸ TRIVIA sub-nav row so a host can flip back mid-task without
 * hunting for it — the same "there is always a way back" reasoning the shell toggle
 * follows. Rendered ONLY by the v2 shell and ONLY while a trivia page is active: a
 * classic device never sees it, because the trivia key does nothing without the shell
 * key (see `TriviaVersioned`).
 *
 * Styled from the same inline object as `UiVersionToggle` (dashed 1px edge,
 * transparent fill, 44px tap floor, quiet by design) rather than from a stylesheet —
 * a sibling control should read as a sibling. Inside `.sv2-nav` the token sheet
 * re-points its border COLOUR to the hairline and leaves the dashed STYLE, which is
 * exactly what the shell toggle beside it already does.
 *
 * It does NOT live in `modules/trivia/` on purpose: the shell would then static-import
 * the trivia chunk and undo its lazy split.
 */
export function TriviaUiVersionToggle({ style }: { style?: CSSProperties }) {
  const [version, setVersion] = useTriviaUiVersion();
  const next = version === "v2" ? "classic" : "v2";
  return (
    <button
      type="button"
      onClick={() => setVersion(next)}
      title={next === "v2" ? "Switch the trivia pages to the new look" : "Switch the trivia pages back to the current look"}
      style={{ ...btn, ...style }}
    >
      {version === "v2" ? "← BACK TO CLASSIC TRIVIA" : "TRY THE NEW TRIVIA LOOK →"}
    </button>
  );
}

const btn: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  minHeight: 44, padding: "0 12px",
  // No fontSize here, for the same reason as UiVersionToggle: `.staff-ui button`
  // force-sizes every staff button, so this control sits at the shared scale rather
  // than pretending to a size it cannot have.
  letterSpacing: 1, whiteSpace: "nowrap",
  color: "var(--terminal-green)", background: "transparent",
  border: "1px dashed rgba(0,255,65,0.55)", cursor: "pointer", opacity: 0.8,
};
