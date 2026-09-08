import { useEffect, type ReactNode } from "react";

/**
 * Adds `<meta name="robots" content="noindex">` while its child route is mounted, and
 * removes it on unmount (decision E / addendum ruling 6).
 *
 * Used for `/drinks` — a live, unauthenticated, indexable TV board that the docs call
 * legacy. robots.txt would only stop crawling (an already-known URL can still be
 * listed), and `DrinksDisplay.tsx` is a frozen TV render path, so the tag is injected
 * from the route wrapper instead. Nothing else about that route changes.
 */
export function NoIndex({ children }: { children: ReactNode }) {
  useEffect(() => {
    const el = document.createElement("meta");
    el.name = "robots";
    el.content = "noindex";
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, []);
  return <>{children}</>;
}
