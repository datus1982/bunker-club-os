import { useQuery } from "@tanstack/react-query";

import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Public marketing-site copy (docs/14). Lives as (venue_id, key) rows in
 * venue_settings — anon-readable via the 0011 `public_read` policy, seeded by
 * migration 0029. One query pulls every `site_*` key; the page components read
 * strongly-typed slices with sensible fallbacks so the site renders even if the
 * DB is briefly unreachable (the seeded values ARE these fallbacks).
 */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type DayHours = { open: string; close: string } | null;
export type SiteHours = Record<DayKey, DayHours>;
export type SiteAddress = {
  line1: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
};
export type SiteSocials = { instagram?: string; facebook?: string; tiktok?: string };

export type SiteCopy = {
  heroTitle: string;
  heroSub: string;
  hours: SiteHours;
  address: SiteAddress;
  parking: string;
  socials: SiteSocials;
  about: string[];
};

// The FALLBACK MUST mirror the migration-0029 seed exactly — it's the first-paint /
// offline copy, and (critically) it's also React Query's `placeholderData`. If it
// diverges from the live DB value, the placeholder→data swap reflows the page and
// spikes CLS (measured 0.6 on /about when this was a stub). Keeping it identical to
// the seed means the swap changes no layout. Update both together (see 0029 header).
const FALLBACK: SiteCopy = {
  heroTitle: "BUNKER CLUB",
  heroSub:
    "An atomic age high-dive on NW 23rd — cold drinks, warm company, and Atomic Pub Trivia every Wednesday night.",
  hours: {
    mon: { open: "16:00", close: "02:00" },
    tue: { open: "16:00", close: "02:00" },
    wed: { open: "16:00", close: "02:00" },
    thu: { open: "16:00", close: "02:00" },
    fri: { open: "16:00", close: "02:00" },
    sat: { open: "16:00", close: "02:00" },
    sun: { open: "16:00", close: "02:00" },
  },
  address: {
    line1: "433 NW 23rd St",
    city: "Oklahoma City",
    state: "OK",
    zip: "73103",
    lat: 35.4926,
    lng: -97.5227,
  },
  parking:
    "Parking lots are just south across the street and to the northwest behind The Rise. Not sure where to land? Ask us and we'll point you to the closest spot.",
  socials: {
    instagram: "https://instagram.com/bunkerclubokc",
    facebook: "https://facebook.com/bunkerclubokc",
    tiktok: "https://tiktok.com/@bunkerclubokc",
  },
  about: [
    "Bunker Club opened April 2, 2017, on NW 23rd Street — its doors first swinging wide during Open Streets OKC. It was the work of Hailey and Ian McDermid, the couple behind The Pump Bar just up the block, who took a long-shuttered jewel-box storefront in the Tower Theater building and gave it new life. Its rare green Vitrolite glass, freshly restored, still catches the light out front.",
    "The idea, in Ian's words, was a post-war atomic-era dive bar — design elements and sounds borrowed from the Cold War, and most of it built by hand. Local artists gave the room its character: the painters at Mind Bender Tattoo, and the murals and hand-lettering of Tanner Fraidy at Fraidy Cat Signs. The result is warm and dim and lush rather than stark — an immersive place, and never a museum.",
    'The founders were always clear about what the theme meant. It was never politics; it was an affection for a moment in time. As they put it: "It\'s an ode to the preparedness, it\'s an ode to the propaganda, it\'s an ode to the art, the fear of what\'s to come, the hope of a future, and what that inspired in the daily lives of people."',
    "In 2023 the Bunker passed to the crew who run it now, who restocked the bar and widened the calendar without losing the room's original spirit. Today the heart of the week is Wednesday — Atomic Pub Trivia, teams squaring off across the season on the BUNKER UNIFIED OS screens overhead. The lights are still low and the drinks still honest: an atomic age high-dive on 23rd, same as ever.",
  ],
};

const KEYS = [
  "site_hero_title",
  "site_hero_sub",
  "site_hours",
  "site_address",
  "site_parking",
  "site_socials",
  "site_about",
] as const;

export function useSiteCopy() {
  return useQuery({
    queryKey: ["site-copy", VENUE_ID],
    staleTime: 5 * 60_000,
    // The seeded fallback keeps the UI populated during the first paint / offline.
    placeholderData: FALLBACK,
    queryFn: async (): Promise<SiteCopy> => {
      const { data, error } = await supabase
        .from("venue_settings")
        .select("key, value")
        .eq("venue_id", VENUE_ID)
        .in("key", KEYS as unknown as string[]);
      if (error) throw error;

      const map = new Map((data ?? []).map((r) => [r.key, r.value]));
      const get = <T>(key: string, fallback: T): T => {
        const v = map.get(key);
        return v == null ? fallback : (v as T);
      };

      return {
        heroTitle: get("site_hero_title", FALLBACK.heroTitle),
        heroSub: get("site_hero_sub", FALLBACK.heroSub),
        hours: get("site_hours", FALLBACK.hours),
        address: get("site_address", FALLBACK.address),
        parking: get("site_parking", FALLBACK.parking),
        socials: get("site_socials", FALLBACK.socials),
        about: get("site_about", FALLBACK.about),
      };
    },
  });
}

const DAY_LABEL: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};
export const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** JS getDay() (0=Sun) → our DayKey. */
export function todayKey(d = new Date()): DayKey {
  return (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as DayKey[])[d.getDay()];
}

export function dayLabel(k: DayKey): string {
  return DAY_LABEL[k];
}

/** "16:00" → "4 PM"; "16:30" → "4:30 PM"; "02:00" → "2 AM". On-the-hour times drop
 *  the ":00" for cleaner marketing copy. Robust to bad input. */
export function fmtTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return min === "00" ? `${h} ${ampm}` : `${h}:${min} ${ampm}`;
}

export function fmtHours(dh: DayHours): string {
  if (!dh) return "Closed";
  return `${fmtTime(dh.open)} – ${fmtTime(dh.close)}`;
}
