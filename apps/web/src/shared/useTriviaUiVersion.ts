import { useCallback, useEffect, useState } from "react";

/**
 * The TRIVIA page-look switch (UX overhaul polish arc 2, PR 3).
 *
 * A SECOND key beside `bunker.ui_version`, not a third value on it (spec §A1, owner
 * letter A1): `UiVersion` is typed `"classic" | "v2"` and consumed across the shell,
 * so widening that union would touch every consumer for a trivia-only feature.
 *
 * `classic` = the shipped green-terminal trivia pages, unchanged. `v2` = the same
 * pages wrapped in `data-st-page` so the token sheet reaches them. Default is ALWAYS
 * `classic` — RULE #1: nobody's Scoring console changes look until they opt in.
 *
 * COMPOSITION: this key only takes effect (and its control is only offered) when the
 * device is ALSO on the main `v2` shell — see `TriviaVersioned` in
 * `modules/trivia/triviaVersion.tsx`. A classic device never sees the switch.
 *
 * Stored in localStorage, so it is PER DEVICE, not per account — same ruling as the
 * shell switch. Every read/write is wrapped: Safari private mode throws on access.
 *
 * Read/write/subscribe shape is deliberately IDENTICAL to `useUiVersion.ts` (module-
 * level subscriber set for this tab, `storage` event for the others) so a maintainer
 * who knows one already knows the other.
 */
export type TriviaUiVersion = "classic" | "v2";

const KEY = "bunker.trivia_ui_version";
const DEFAULT: TriviaUiVersion = "classic";

function read(): TriviaUiVersion {
  try {
    return localStorage.getItem(KEY) === "v2" ? "v2" : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function write(v: TriviaUiVersion): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode / storage disabled — the switch just doesn't persist */
  }
}

const subscribers = new Set<(v: TriviaUiVersion) => void>();

/** Read the current version without subscribing (for non-React call sites). */
export function getTriviaUiVersion(): TriviaUiVersion {
  return read();
}

/** Set the version and notify every mounted `useTriviaUiVersion` in this tab. */
export function setTriviaUiVersionGlobal(v: TriviaUiVersion): void {
  write(v);
  subscribers.forEach((fn) => fn(v));
}

export function useTriviaUiVersion(): [TriviaUiVersion, (v: TriviaUiVersion) => void] {
  const [version, setVersion] = useState<TriviaUiVersion>(read);

  useEffect(() => {
    subscribers.add(setVersion);
    // Re-sync on mount in case the value changed between the initial read and here.
    setVersion(read());
    // Other tabs on this device: keep them honest too.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setVersion(read());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      subscribers.delete(setVersion);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((v: TriviaUiVersion) => setTriviaUiVersionGlobal(v), []);
  return [version, set];
}
