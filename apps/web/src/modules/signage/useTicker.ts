import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { eventStage, minutesToFire, type LiveEvent } from "./eventStage";

/**
 * Footer-ticker sources (docs/09 persistent chrome). Interleaves, in order:
 *   • EVENT lines (docs/13) — a TEASE "T-MINUS N MIN" or an active WINDOW/MESSAGE/EVENT
 *     "NOW UNTIL H:MM" reprint, so a scheduled promo is announced even when the moment
 *     itself is waiting out a game (moment stages surface only as ticker lines then),
 *   • manual lines — venue_settings key `signage_ticker_lines` (jsonb string[]),
 *   • live SEASON top-3 (green = live feed),
 *   • live NOW POURING top seller from sales_cache (green = live feed).
 * The chrome reprints ONE line every ~9s (no scroll animation — perf + terminal
 * authenticity). Realtime on scores keeps the standings line fresh; no sub-30s poll.
 */

export interface TickerLine {
  text: string;
  live: boolean; // green ink when true (docs/09 color-state: green = live)
}

/** Derive event ticker lines from the live events (docs/13). TEASE → T-MINUS; active
 *  WINDOW/MESSAGE and the moment EVENT window → "NOW UNTIL H:MM". `now`/`tz` passed in. */
export function buildEventTickerLines(events: LiveEvent[], timezone: string, now: number): TickerLine[] {
  const fmtTime = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(ms)).toUpperCase();
  const lines: TickerLine[] = [];
  for (const ev of events) {
    const stage = eventStage(ev, now);
    const name = ev.name.toUpperCase();
    if (stage === "tease") {
      lines.push({ text: `◆ ${name} — T-MINUS ${minutesToFire(ev, now)} MIN`, live: false });
    } else if (stage === "active" || stage === "event") {
      const end = ev.fire_at ? new Date(ev.fire_at).getTime() + ev.window_minutes * 60_000 : now;
      lines.push({ text: `◆ ${name} — NOW UNTIL ${fmtTime(end)}`, live: false });
    }
    // alert / moment / allclear are full-screen beats — not ticker lines (docs/13).
  }
  return lines;
}

const DEFAULT_LINES = [
  "WEDNESDAYS: ATOMIC PUB TRIVIA 8PM · HAPPY HOUR 4-7",
  "SHELTER AUTHORITY · CIVIL DEFENSE APPROVED · STAY UNDERGROUND",
];

export function useTicker(opts?: { events?: LiveEvent[]; timezone?: string }): TickerLine[] {
  const qc = useQueryClient();
  const events = opts?.events ?? [];
  const timezone = opts?.timezone ?? "America/Chicago";

  // Re-derive the time-based event lines on a 30s tick (T-MINUS / NOW UNTIL only need
  // minute granularity; the reprint cadence is separate in ChromeFooter). No sub-30s poll.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const eventLines = useMemo(
    () => buildEventTickerLines(events, timezone, nowTick),
    [events, timezone, nowTick],
  );

  const query = useQuery({
    queryKey: ["signage", "ticker"],
    staleTime: 30_000,
    queryFn: async (): Promise<TickerLine[]> => {
      const lines: TickerLine[] = [];

      // 1) manual lines (venue_settings)
      const { data: setting } = await supabase
        .from("venue_settings")
        .select("value")
        .eq("venue_id", VENUE_ID)
        .eq("key", "signage_ticker_lines")
        .maybeSingle();
      const manual = Array.isArray(setting?.value) ? (setting!.value as unknown[]) : null;
      const manualLines = (manual ?? DEFAULT_LINES)
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        .map((text) => ({ text: text.toUpperCase(), live: false }));
      lines.push(...manualLines);

      // 2) SEASON top-3 (green) — standings ALWAYS via season_leaderboard (single source)
      const { data: season } = await supabase
        .from("seasons")
        .select("id, name")
        .eq("venue_id", VENUE_ID)
        .eq("status", "active")
        .lte("starts_on", new Date().toISOString().slice(0, 10))
        .gte("ends_on", new Date().toISOString().slice(0, 10))
        .maybeSingle();
      if (season) {
        const { data: lb } = await supabase.rpc("season_leaderboard", { p_season_id: season.id });
        const top3 = ((lb ?? []) as { team_id: string; rank: number }[])
          .filter((r) => r.rank <= 3)
          .sort((a, b) => a.rank - b.rank);
        if (top3.length) {
          const { data: teams } = await supabase
            .from("teams_public")
            .select("id, name")
            .in("id", top3.map((r) => r.team_id));
          const names = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]));
          const parts = top3.map((r) => `${r.rank}. ${(names.get(r.team_id) ?? "—").toUpperCase()}`);
          lines.push({ text: `SEASON STANDINGS: ${parts.join(" · ")}`, live: true });
        }
      }

      // 3) NOW POURING top seller (green) — highest sales_count in sales_cache,
      //    gated on POS visibility (0034 / reviewer NOTE-2): the owner never wants
      //    a product advertised unless it's active on the POS view. sales_cache
      //    rows carry item_guid (populated by toast-sync); we drop any whose Toast
      //    row is explicitly pos_visible=false, matching by guid and (guid-less
      //    rows) by name. Unknown items stay visible — mirrors 0034's default-true.
      const { data: sales } = await supabase
        .from("sales_cache")
        .select("item_name, sales_count, item_guid")
        .eq("venue_id", VENUE_ID)
        .order("sales_count", { ascending: false })
        .limit(12);
      const topSellers = (sales ?? []) as { item_name: string; item_guid: string | null }[];
      if (topSellers.length) {
        // Explicitly POS-hidden items only (small set — Winter Cocktails etc.).
        const { data: hidden } = await supabase
          .from("toast_menu_cache")
          .select("guid, name")
          .eq("venue_id", VENUE_ID)
          .eq("pos_visible", false);
        const hiddenGuids = new Set((hidden ?? []).map((h) => h.guid as string));
        const hiddenNames = new Set(
          (hidden ?? []).map((h) => String(h.name ?? "").trim().toLowerCase()),
        );
        const pouring = topSellers.find((s) =>
          s.item_guid
            ? !hiddenGuids.has(s.item_guid)
            : !hiddenNames.has(String(s.item_name).trim().toLowerCase()),
        );
        if (pouring?.item_name) {
          lines.push({ text: `NOW POURING: ${String(pouring.item_name).toUpperCase()}`, live: true });
        }
      }

      return lines.length ? lines : DEFAULT_LINES.map((text) => ({ text, live: false }));
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("signage:ticker")
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" },
        () => qc.invalidateQueries({ queryKey: ["signage", "ticker"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "ticker"] }))
      // POS-visibility flips live in toast_menu_cache — refresh so a hidden top
      // seller stops appearing as NOW POURING (0034 / reviewer NOTE-2).
      .on("postgres_changes", { event: "*", schema: "public", table: "toast_menu_cache", filter: `venue_id=eq.${VENUE_ID}` },
        () => qc.invalidateQueries({ queryKey: ["signage", "ticker"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Event lines lead — a scheduled promo/moment is the most timely thing on the wall.
  const base = query.data ?? DEFAULT_LINES.map((text) => ({ text, live: false }));
  return [...eventLines, ...base];
}
