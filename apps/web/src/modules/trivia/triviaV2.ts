import { createContext, useContext } from "react";

/**
 * "Is this trivia page rendering in the v2 token look?" (polish arc 2, PR 3).
 *
 * Deliberately its own module with a single dependency (react) so the shared trivia
 * primitives in `ui.tsx` — which `modules/signage/ItemEditor.tsx` also imports — can
 * read it without dragging the version hooks, the router or the shell into their
 * chunk.
 *
 * DEFAULT IS `false` WITH NO PROVIDER. That is the byte-identity guarantee: every
 * existing caller (classic trivia, and ItemEditor over in signage) reads `false` and
 * renders exactly what it rendered before. Only `TriviaVersioned` ever provides `true`,
 * and only when BOTH device switches say v2.
 */
export const TriviaV2Context = createContext(false);

export function useTriviaV2(): boolean {
  return useContext(TriviaV2Context);
}

/**
 * Join class names, dropping falsy parts, and return `undefined` when nothing is left.
 *
 * The `undefined` matters: `className={undefined}` emits NO attribute, while
 * `className=""` emits `class=""`. Classic output has to be byte-identical in
 * `innerHTML`, so an empty-string class attribute on every trivia button would fail
 * the parity gate on its own.
 */
export function cx(...parts: Array<string | false | null | undefined>): string | undefined {
  const out = parts.filter(Boolean).join(" ");
  return out || undefined;
}
