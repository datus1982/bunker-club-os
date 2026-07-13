import { useEffect, useState } from "react";

/**
 * True when the viewport is narrower than `breakpoint` (px). Used for mobile-only
 * layout switches a CSS media query alone can't express — e.g. an exact grid column
 * count that must stay 2-up (or 3-up) on desktop but collapse to a single column on
 * phones. matchMedia-based, so it updates on resize / orientation change.
 *
 * (StaffNav.tsx carries its own local copy from Phase 4c's first commit; this shared
 * version is for the other staff surfaces fixed in the overflow/headings pass.)
 */
export function useIsMobile(breakpoint = 640): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return isMobile;
}
