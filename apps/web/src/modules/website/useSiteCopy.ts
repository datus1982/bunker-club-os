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
  clubRules: string[];
  historyIntro: string;
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
    "Bunker Club is an atomic age high-dive on NW 23rd — a Cold War fallout shelter of a bar tucked into a jewel-box storefront in the Tower Theater building, its rare green Vitrolite glass still catching the light out front. Inside it's warm, dim, and lush rather than stark: civil-defense signage, low light, and a proper drink while the end of the world stays safely out there.",
    'The room opened in 2017, built by hand as a post-war atomic-era dive — and built with a clear idea of what the theme meant. It was never politics; it was an affection for a moment in time. As the bar\'s original credo puts it: "It\'s an ode to the preparedness, it\'s an ode to the propaganda, it\'s an ode to the art, the fear of what\'s to come, the hope of a future, and what that inspired in the daily lives of people."',
    "That ode keeps evolving. These days the Bunker leans into the pop culture the atomic age set off — the retro-future of blast doors and ray guns, duck-and-cover kitsch, the movies and games that turned fallout into a playground. Less time capsule, more clubhouse for everyone who grew up loving the bunker fantasy.",
    "It's still a neighborhood dive at heart: open 4 PM to 2 AM every single day, Atomic Pub Trivia every Wednesday at 8, karaoke most Saturdays, and a bar that runs on its own screens — standings, specials, and the occasional all-screen birthday shout-out. The lights are low and the drinks are honest. The bunker's open.",
  ],
  // The house rules painted on the barroom wall (owner-approved brand voice).
  // DECISION: the wall is hand-lettered ALL-CAPS; stored here in sentence case
  // (a11y + owner-editable) and rendered uppercase via CSS `text-transform` on
  // `.site-rules` so it reproduces the wall's look. Words + punctuation are
  // verbatim from the wall: "death!", the "right-of-way" hyphens, "Don't"/"won't"
  // apostrophes. Owner changed the wall 2026-07-13 (candles → lamps, plus a new
  // "Don't break or steal the lamps" rule after the disfiguring rule → 8 rules).
  // MUST byte-match the live `site_club_rules` row AND the 0031 seed.
  clubRules: [
    "Don't start none, won't be none",
    "Tipping makes you sexy",
    "Disfiguring the lamps will result in death!",
    "Don't break or steal the lamps",
    "If you return empties to the bar, the staff will love you forever",
    "Waving cash at bar will not result in quicker service",
    "Anyone carrying two or more drinks has right-of-way",
    "If you are cut off, be happy we got you drunk in the first place",
  ],
  // Lead sentence for /history — overridable without a deploy (0032). MUST
  // byte-match the site_history_intro seed. The rest of /history is hardcoded
  // editorial in History.tsx.
  historyIntro:
    "For fifty-three years — from 1926 to 1979 — the asphalt outside 433 NW 23rd Street was U.S. Route 66. Bunker Club didn't invent this corner; it inherited it.",
};

const KEYS = [
  "site_hero_title",
  "site_hero_sub",
  "site_hours",
  "site_address",
  "site_parking",
  "site_socials",
  "site_about",
  "site_club_rules",
  "site_history_intro",
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
        clubRules: get("site_club_rules", FALLBACK.clubRules),
        historyIntro: get("site_history_intro", FALLBACK.historyIntro),
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
