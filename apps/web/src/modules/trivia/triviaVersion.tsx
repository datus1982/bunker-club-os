import type { ComponentType, ReactNode } from "react";
import { useUiVersion } from "@/shared/useUiVersion";
import { useTriviaUiVersion } from "@/shared/useTriviaUiVersion";
import { TriviaV2Context } from "./triviaV2";

/**
 * The trivia page-look picker (polish arc 2, PR 3 — spec §A1).
 *
 * Mirrors `StaffLayout`'s own pattern: the version branch lives in a PARENT, not as an
 * early return inside a page. Here the parent supplies a context value rather than
 * swapping component types, because the five trivia pages are ONE component each with
 * a variant applied at the leaves (spec: "prefer one component with a variant flag
 * over duplicating 520-line pages"). The `key` still forces a clean unmount/mount on a
 * flip, so no page carries stale local state across the switch.
 *
 * COMPOSITION (§A1): v2 requires BOTH switches. A device on the classic SHELL has
 * never loaded the token stylesheet — `staff-tokens-v2.css` is imported by
 * `StaffShellV2` alone — so a trivia-only opt-in there would emit `data-st-page` with
 * no rules behind it and render a half-styled page. Hence: classic shell OR classic
 * trivia ⇒ classic page, byte for byte.
 */
export function TriviaVersioned({ children }: { children: ReactNode }) {
  const [shell] = useUiVersion();
  const [trivia] = useTriviaUiVersion();
  const v2 = shell === "v2" && trivia === "v2";
  return (
    <TriviaV2Context.Provider key={v2 ? "v2" : "classic"} value={v2}>
      {children}
    </TriviaV2Context.Provider>
  );
}

/**
 * Wrap a trivia page so it renders under the version context. Used in the two route
 * modules (`modules/trivia/routes.tsx`, `modules/seasons/routes.tsx`) so `App.tsx`'s
 * route table — and therefore the TV/staff chunk split — is untouched.
 */
export function withTriviaVersion<P extends object>(Page: ComponentType<P>): ComponentType<P> {
  const Wrapped = (props: P) => (
    <TriviaVersioned>
      <Page {...props} />
    </TriviaVersioned>
  );
  Wrapped.displayName = `withTriviaVersion(${Page.displayName ?? Page.name ?? "Page"})`;
  return Wrapped;
}
