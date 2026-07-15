import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { eventStage, minutesToFire, flavorOf, type LiveEvent } from "./eventStage";

/**
 * Footer-ticker sources (docs/09 persistent chrome). Interleaves, in order:
 *   • EVENT lines (docs/13) — a TEASE "T-MINUS N MIN" or an active WINDOW/MESSAGE/EVENT
 *     "NOW UNTIL H:MM" reprint, so a scheduled promo is announced even when the moment
 *     itself is waiting out a game (moment stages surface only as ticker lines then),
 *   • manual lines — venue_settings key `signage_ticker_lines` (jsonb string[]),
 *   • live SEASON top-3 (green = live feed),
 *   • live NOW POURING = the LAST ITEM RUNG IN (venue_settings `signage_last_rung`,
 *     written by toast-sync; green = live feed; shown only when < 90 min fresh).
 * The chrome reprints ONE line every ~9s (no scroll animation — perf + terminal
 * authenticity). Realtime on scores keeps the standings line fresh; no sub-30s poll.
 */

export interface TickerLine {
  text: string;
  live: boolean; // green ink when true (docs/09 color-state: green = live)
}

/** Phrase an active window's timing for the room (owner note 2026-07-14): a window that
 *  simply runs to close must not advertise closing time as if it were a deadline —
 *  "NOW UNTIL 2:00 AM" reads like the promo expiring at 2. Ends-at-close (2–4 AM
 *  venue-local within the same service night; docs/14 hours, 4 AM = the display's
 *  nightly reload) → just "ON NOW". A real same-evening ending keeps "NOW UNTIL
 *  7:00 PM". A multi-day window (ENDS ON, 0041 era) names the day — "NOW THRU WED
 *  11:59 PM" — so a long promo carries its true deadline. Exported pure for tests. */
export function untilPhrase(endMs: number, now: number, timezone: string): string {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts }).format(new Date(endMs)).toUpperCase();
  const hoursAway = (endMs - now) / 3_600_000;
  const endHour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date(endMs)),
  );
  if (hoursAway <= 14 && endHour >= 2 && endHour < 4) return "ON NOW";
  if (hoursAway > 14) return `NOW THRU ${fmt({ weekday: "short" })} ${fmt({ hour: "numeric", minute: "2-digit" })}`;
  return `NOW UNTIL ${fmt({ hour: "numeric", minute: "2-digit" })}`;
}

/** Reframe untilPhrase() for a BULLETIN (owner beat): a bulletin is information, not a sale,
 *  so drop the "NOW" urgency framing. Promo keeps it. Shares the one time helper so there is
 *  no duplicated deadline logic — only the "NOW" prefix is stripped for bulletins:
 *    ON NOW              → (nothing — the bulletin is simply on the wall) → "◆ NAME"
 *    NOW UNTIL 7:00 PM   → "UNTIL 7:00 PM"                               → "◆ NAME — UNTIL 7:00 PM"
 *    NOW THRU WED 11:59 PM → "THRU WED 11:59 PM"                         → "◆ NAME — THRU WED 11:59 PM"
 *  Exported pure for tests. */
export function eventTickerText(name: string, flavor: "promo" | "bulletin", endMs: number, now: number, timezone: string): string {
  const phrase = untilPhrase(endMs, now, timezone);
  if (flavor === "promo") return `◆ ${name} — ${phrase}`;
  const b = phrase === "ON NOW" ? "" : phrase.replace(/^NOW /, "");
  return b ? `◆ ${name} — ${b}` : `◆ ${name}`;
}

/** Derive event ticker lines from the live events (docs/13). TEASE → T-MINUS; active
 *  WINDOW/MESSAGE and the moment EVENT window → untilPhrase(), reframed per flavor for
 *  window/message (promo keeps NOW-framing, bulletin drops it). `now`/`tz` passed in. */
export function buildEventTickerLines(events: LiveEvent[], timezone: string, now: number): TickerLine[] {
  const lines: TickerLine[] = [];
  for (const ev of events) {
    const stage = eventStage(ev, now);
    const name = ev.name.toUpperCase();
    if (stage === "tease") {
      lines.push({ text: `◆ ${name} — T-MINUS ${minutesToFire(ev, now)} MIN`, live: false });
    } else if (stage === "active" || stage === "event") {
      const end = ev.fire_at ? new Date(ev.fire_at).getTime() + ev.window_minutes * 60_000 : now;
      lines.push({ text: eventTickerText(name, flavorOf(ev.fields, ev.kind), end, now, timezone), live: false });
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

      // 3) NOW POURING = the LAST ITEM RUNG IN (green, live), not the top seller (owner
      //    design-beat: "it would be really cool if that was just the last thing rung in").
      //    toast-sync writes venue_settings key `signage_last_rung` = { name, at } during its
      //    sales pass, already POS-visibility-gated on the WRITE side (only an explicit
      //    pos_visible=false is skipped; 86'd is fine — it was just sold). Read it the SAME
      //    anon way as signage_ticker_lines (venue_settings public_read). Only surface the
      //    line when the ring is FRESH — within the last 90 min — so a stale ring drops off.
      const { data: rungRow } = await supabase
        .from("venue_settings")
        .select("value")
        .eq("venue_id", VENUE_ID)
        .eq("key", "signage_last_rung")
        .maybeSingle();
      const rung = rungRow?.value as { name?: unknown; at?: unknown } | null;
      const rungName = typeof rung?.name === "string" ? rung.name.trim() : "";
      const rungAt = typeof rung?.at === "string" ? Date.parse(rung.at) : NaN;
      const NINETY_MIN = 90 * 60_000;
      if (rungName && Number.isFinite(rungAt) && Date.now() - rungAt <= NINETY_MIN) {
        lines.push({ text: `◆ NOW POURING: ${rungName.toUpperCase()}`, live: true });
      }

      return lines.length ? lines : DEFAULT_LINES.map((text) => ({ text, live: false }));
    },
    // venue_settings is not in the realtime publication, so a 60s fallback refetch keeps the
    // last-rung / manual / season lines current (within the display polling rule: one 30–60s
    // fallback poll; immediacy for standings still comes from the scores realtime below).
    refetchInterval: 60_000,
  });

  useEffect(() => {
    // Scores realtime keeps the SEASON STANDINGS line fresh immediately. The last-rung line
    // rides the 60s fallback refetch (venue_settings has no realtime publication).
    const ch = supabase
      .channel("signage:ticker")
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" },
        () => qc.invalidateQueries({ queryKey: ["signage", "ticker"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  // Event lines lead — a scheduled promo/moment is the most timely thing on the wall.
  const base = query.data ?? DEFAULT_LINES.map((text) => ({ text, live: false }));
  return [...eventLines, ...base];
}
