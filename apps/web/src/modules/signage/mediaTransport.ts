import { useEffect, useRef } from "react";
import { supabase } from "@/shared/supabaseClient";

/**
 * Media transport commands (docs/15 M2 — Q-SYS external control).
 *
 * Program-level switches (playlist / rotation / capture) are DB state: the `media-control` edge
 * fn writes signage_slots.program and the TV follows via the signage_slots realtime the slot
 * already watches (single source of truth, hub chip follows too). Transport-level commands
 * (pause / resume / next) are ephemeral — they must NOT persist in the DB (a paused program that
 * survives a reload would be a footgun), so they ride a Supabase realtime BROADCAST channel
 * `media-cmd:{slug}` (event `cmd`, payload `{cmd}`) that the player subscribes to. The edge fn
 * sends the broadcast server-side; the player reacts live.
 *
 * The channel name is the contract shared with supabase/functions/media-control/index.ts — keep
 * the two literals in sync (a fn constant mirrors this, same as MEDIA_SHELL_PORT ↔ the shell).
 */

export type TransportCmd = "pause" | "resume" | "next";

/** The realtime broadcast channel a slot's transport commands ride on. */
export function transportTopic(slug: string): string {
  return `media-cmd:${slug}`;
}

/**
 * Subscribe to a slot's transport-command broadcast for the lifetime of the calling component.
 * Only PLAYLIST programs react (pause/resume/advance the <video>); capture ignores transport, so
 * it never calls this. Because the subscription lives with the program renderer, it cleans up the
 * instant a takeover / MOMENT / live game unmounts the program tier.
 *
 * Handlers are held in a ref so the channel is subscribed ONCE per slug (not re-subscribed on
 * every render as the video's index/callbacks change).
 */
export function useTransportCommands(
  slug: string | null,
  handlers: { onPause: () => void; onResume: () => void; onNext: () => void },
): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!slug) return;
    const ch = supabase
      .channel(transportTopic(slug))
      .on("broadcast", { event: "cmd" }, (msg) => {
        const cmd = (msg.payload as { cmd?: TransportCmd } | undefined)?.cmd;
        if (cmd === "pause") ref.current.onPause();
        else if (cmd === "resume") ref.current.onResume();
        else if (cmd === "next") ref.current.onNext();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [slug]);
}
