import { useQuery } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * Data layer for the `instagram` signage template (0042). Pure anon READER of
 * instagram_cache — the instagram-sync edge fn owns the writes (mirrors @bunkerclubokc
 * posts + active stories and the expiring CDN images into the `signage` bucket). Stories
 * sort first (is_story desc) then newest-first; post_count caps how many recent posts are
 * in the rotation cycle.
 *
 * Display polling rule (docs/01): Instagram changes at Instagram pace, so a 60s fallback
 * poll is plenty — no realtime channel (content isn't time-critical like a game).
 */

export interface IgPost {
  media_id: string;
  media_type: string | null;
  is_story: boolean;
  caption: string | null;
  permalink: string;
  username: string | null;
  posted_at: string;
  /** Public URL of the mirrored image in the `signage` bucket (bucket is public). */
  image: string | null;
  expires_at: string | null;
}

const BUCKET = "signage";

export function useInstagramFeed(postCount: number, includeStories: boolean) {
  const limit = Math.max(1, Math.min(10, Math.floor(postCount) || 5));
  const q = useQuery({
    queryKey: ["signage", "instagram", limit, includeStories],
    refetchInterval: 60_000,
    staleTime: 60_000,
    queryFn: async (): Promise<IgPost[]> => {
      // Stories first, then newest posts. Fetch enough posts to satisfy `limit` even when a
      // few active stories ride at the head of the list.
      let query = supabase
        .from("instagram_cache")
        .select("media_id, media_type, is_story, caption, permalink, username, posted_at, storage_path, expires_at")
        .eq("venue_id", VENUE_ID)
        .order("is_story", { ascending: false })
        .order("posted_at", { ascending: false })
        .limit(limit + 5);
      if (!includeStories) query = query.eq("is_story", false);

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []) as Array<{
        media_id: string; media_type: string | null; is_story: boolean;
        caption: string | null; permalink: string; username: string | null;
        posted_at: string; storage_path: string | null; expires_at: string | null;
      }>;

      const now = Date.now();
      const mapped: IgPost[] = rows
        // Defensive: never show a story whose expiry passed before the next sync prunes it.
        .filter((r) => !(r.is_story && r.expires_at && new Date(r.expires_at).getTime() <= now))
        .map((r) => ({
          media_id: r.media_id,
          media_type: r.media_type,
          is_story: r.is_story,
          caption: r.caption,
          permalink: r.permalink,
          username: r.username,
          posted_at: r.posted_at,
          expires_at: r.expires_at,
          image: r.storage_path ? supabase.storage.from(BUCKET).getPublicUrl(r.storage_path).data.publicUrl : null,
        }));

      // Active stories always ride at the head (they jump the queue), then the newest posts
      // fill out to `limit`. The head stories don't count against the post cap.
      const stories = mapped.filter((m) => m.is_story);
      const posts = mapped.filter((m) => !m.is_story).slice(0, limit);
      return [...stories, ...posts];
    },
  });
  return { items: q.data ?? [], loading: q.isLoading };
}
