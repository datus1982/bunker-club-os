import { useQuery } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Status-board data layer for the admin shell (Phase 4b, docs/12 freshness pattern).
 * Pure READER over data other modules already write — no new sync mechanisms, no new
 * tables. Everything here is derived from existing `updated_at` columns, `games`,
 * `seasons`/`season_leaderboard`, and `venue_settings`.
 */

// ── helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD for `now` in the given IANA timezone (matches games.game_date, a date). */
function venueDate(now: Date, timeZone: string): string {
  // en-CA renders ISO-ordered YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** Is `now` inside the venue-local {open,close} window? Overnight-safe (close < open).
 *  Mirrors withinWindow() in the toast-sync edge fn. Null/absent window → always true. */
function withinWindow(now: Date, timeZone: string, win: { open?: string; close?: string } | null): boolean {
  if (!win?.open || !win?.close) return true;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const hh = Number(parts.find((p) => p.type === "hour")!.value);
  const mm = Number(parts.find((p) => p.type === "minute")!.value);
  const cur = hh * 60 + mm;
  const [oh, om] = win.open.split(":").map(Number);
  const [ch, cm] = win.close.split(":").map(Number);
  const open = oh * 60 + om, close = ch * 60 + cm;
  return open <= close ? cur >= open && cur < close : cur >= open || cur < close;
}

export type Freshness = "fresh" | "amber" | "red" | "idle" | "never";

/** Amber >15min, red >60min (docs/12). `gated` sources (toast-sync) only escalate
 *  during operating hours; outside the window a stale value reads as "idle", not alarm. */
function classify(updatedAt: string | null, opts: { gated: boolean; inWindow: boolean }): { state: Freshness; ageMs: number | null } {
  if (!updatedAt) return { state: "never", ageMs: null };
  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const min = ageMs / 60000;
  if (min <= 15) return { state: "fresh", ageMs };
  if (opts.gated && !opts.inWindow) return { state: "idle", ageMs };
  if (min <= 60) return { state: "amber", ageMs };
  return { state: "red", ageMs };
}

export interface SyncStatus {
  toastSync: { state: Freshness; ageMs: number | null; updatedAt: string | null; inWindow: boolean };
  menuSync: { state: Freshness; ageMs: number | null; updatedAt: string | null };
}

/** Freshness of the two Toast syncs, from the newest updated_at in each cache table. */
export function useSyncStatus() {
  return useQuery({
    queryKey: ["dashboard", "sync"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<SyncStatus> => {
      const now = new Date();

      const [{ data: venue }, { data: winRow }, sales, menu] = await Promise.all([
        supabase.from("venues").select("timezone").eq("id", VENUE_ID).maybeSingle(),
        supabase.from("venue_settings").select("value").eq("venue_id", VENUE_ID).eq("key", "drinks_sync_window").maybeSingle(),
        supabase.from("sales_cache").select("updated_at").eq("venue_id", VENUE_ID).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("toast_menu_cache").select("updated_at").eq("venue_id", VENUE_ID).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const tz = (venue?.timezone as string | undefined) ?? "America/Chicago";
      const win = (winRow?.value as { open?: string; close?: string } | null) ?? null;
      const inWindow = withinWindow(now, tz, win);

      const salesAt = (sales.data?.updated_at as string | undefined) ?? null;
      const menuAt = (menu.data?.updated_at as string | undefined) ?? null;

      const t = classify(salesAt, { gated: true, inWindow });
      const m = classify(menuAt, { gated: false, inWindow: true });
      return {
        toastSync: { ...t, updatedAt: salesAt, inWindow },
        menuSync: { ...m, updatedAt: menuAt },
      };
    },
  });
}

export interface TonightGame {
  id: string;
  status: "setup" | "active" | "paused" | "stopped" | "completed";
  game_date: string;
  is_playoff: boolean;
  team_count: number;
}

/** The game dated today (venue TZ), if any — powers the "Tonight" tile + Scoring hint. */
export function useTonight() {
  return useQuery({
    queryKey: ["dashboard", "tonight"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<TonightGame | null> => {
      const { data: venue } = await supabase.from("venues").select("timezone").eq("id", VENUE_ID).maybeSingle();
      const tz = (venue?.timezone as string | undefined) ?? "America/Chicago";
      const today = venueDate(new Date(), tz);

      const { data, error } = await supabase
        .from("games")
        .select("id, status, game_date, is_playoff")
        .eq("venue_id", VENUE_ID)
        .eq("game_date", today)
        // Prefer a live/in-prep game over a finished one if the date has both.
        .order("status", { ascending: true })
        .limit(5);
      if (error) throw error;
      const games = (data ?? []) as Omit<TonightGame, "team_count">[];
      if (!games.length) return null;
      const PRIORITY = ["active", "paused", "setup", "stopped", "completed"];
      games.sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status));
      const g = games[0];

      const { count } = await supabase
        .from("game_teams")
        .select("team_id", { count: "exact", head: true })
        .eq("game_id", g.id);
      return { ...g, team_count: count ?? 0 };
    },
  });
}

export interface SeasonStatus {
  id: string;
  name: string;
  ends_on: string;
  days_remaining: number;
  top3: { rank: number; team_name: string; score: number }[];
}

/** Active season summary + top 3 (standings ALWAYS via season_leaderboard, the single source). */
export function useActiveSeason() {
  return useQuery({
    queryKey: ["dashboard", "season"],
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<SeasonStatus | null> => {
      const { data: season, error } = await supabase
        .from("seasons")
        .select("id, name, ends_on")
        .eq("venue_id", VENUE_ID)
        .eq("status", "active")
        .order("starts_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!season) return null;

      const { data: lb } = await supabase.rpc("season_leaderboard", { p_season_id: season.id });
      const rows = ((lb ?? []) as { team_id: string; score: number; rank: number }[])
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 3);
      const ids = rows.map((r) => r.team_id);
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: teams } = await supabase.from("teams").select("id, name").in("id", ids);
        for (const t of teams ?? []) names.set(t.id as string, t.name as string);
      }
      const top3 = rows.map((r) => ({ rank: r.rank, score: r.score, team_name: names.get(r.team_id) ?? r.team_id.slice(0, 8) }));

      const endMs = new Date(season.ends_on + "T23:59:59").getTime();
      const days_remaining = Math.max(0, Math.ceil((endMs - Date.now()) / 86_400_000));
      return { id: season.id, name: season.name, ends_on: season.ends_on, days_remaining, top3 };
    },
  });
}

/** "12m ago" / "3h ago" for a millisecond age. */
export function formatAge(ageMs: number | null): string {
  if (ageMs == null) return "—";
  const min = Math.floor(ageMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
