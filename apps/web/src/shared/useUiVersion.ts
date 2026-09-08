import { useCallback, useEffect, useState } from "react";

/**
 * The staff-shell version switch (UX overhaul Beat 1).
 *
 * `classic` = the shipped StaffNav shell, unchanged. `v2` = the new StaffShellV2.
 * Default is ALWAYS `classic` — RULE #1: nothing changes for anyone until they opt in.
 *
 * Stored in localStorage, so it is PER DEVICE, not per account (owner ruling, addendum
 * item 5: no prefs column, no migration in this phase). Every read/write is wrapped —
 * Safari private mode throws on localStorage access.
 *
 * Components in the same tab stay in sync through a module-level subscriber set (the
 * `storage` event only fires in OTHER tabs, and the app has no global store).
 */
export type UiVersion = "classic" | "v2";

const KEY = "bunker.ui_version";
const DEFAULT: UiVersion = "classic";

function read(): UiVersion {
  try {
    return localStorage.getItem(KEY) === "v2" ? "v2" : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

function write(v: UiVersion): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode / storage disabled — the switch just doesn't persist */
  }
}

const subscribers = new Set<(v: UiVersion) => void>();

/** Read the current version without subscribing (for non-React call sites). */
export function getUiVersion(): UiVersion {
  return read();
}

/** Set the version and notify every mounted `useUiVersion` in this tab. */
export function setUiVersionGlobal(v: UiVersion): void {
  write(v);
  subscribers.forEach((fn) => fn(v));
}

export function useUiVersion(): [UiVersion, (v: UiVersion) => void] {
  const [version, setVersion] = useState<UiVersion>(read);

  useEffect(() => {
    subscribers.add(setVersion);
    // Re-sync on mount in case the value changed between the initial read and here.
    setVersion(read());
    // Other tabs on this device: keep them honest too.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setVersion(read());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      subscribers.delete(setVersion);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const set = useCallback((v: UiVersion) => setUiVersionGlobal(v), []);
  return [version, set];
}
