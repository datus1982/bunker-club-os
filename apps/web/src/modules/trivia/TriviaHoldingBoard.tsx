import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/supabaseClient";
import { CheckinQR } from "../registration/CheckinQR";

/**
 * Pre-game HOLDING board (trivia-sandbox arc). Shown on the bar screens when trivia is
 * ARMED (0056) but the game hasn't STARTED yet (status 'setup') — the pre-game check-in
 * card. Content: the trivia headline, SCAN TO JOIN + the /checkin?source=qr code, and a
 * LIVE COUNT of teams checked in for tonight's game (game_teams, realtime).
 *
 * Rendered by the signage SlotDisplay (both orientations) and the /game/preview window.
 * Fills its parent (the fixed display canvas); orientation drives the type scale so it
 * reads at 20 feet in both 9:16 portrait and 16:9 landscape. Reuses the shared CheckinQR
 * (the same code the /checkin/qr host-stand tent renders) so the URL is one source.
 */
export function TriviaHoldingBoard({
  gameId,
  orientation,
}: {
  gameId: string | null;
  orientation: "portrait" | "landscape";
}) {
  const count = useCheckedInCount(gameId);
  const portrait = orientation === "portrait";
  const qrSize = portrait ? 460 : 360;

  return (
    <div
      className="terminal-theme"
      style={{
        position: "absolute", inset: 0, background: "#000", color: "var(--terminal-green)",
        display: "flex", flexDirection: portrait ? "column" : "row",
        alignItems: "center", justifyContent: "center",
        gap: portrait ? 40 : 100, padding: portrait ? 64 : "64px 96px", boxSizing: "border-box",
        fontFamily: "'VT323','Share Tech Mono',monospace", textAlign: "center",
      }}
    >
      {/* Headline block */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: portrait ? 14 : 22 }}>
        <div style={{ fontSize: portrait ? 40 : 40, opacity: 0.7, letterSpacing: 6 }}>SHELTER REGISTRATION · TONIGHT</div>
        <div style={{ fontSize: portrait ? 120 : 108, fontWeight: 700, lineHeight: 0.92, letterSpacing: 2, textShadow: "0 0 18px var(--terminal-glow)" }}>
          ATOMIC PUB<br />TRIVIA
        </div>
        <div style={{ fontSize: portrait ? 96 : 84, fontWeight: 700, letterSpacing: 3, marginTop: portrait ? 8 : 4, textShadow: "0 0 18px var(--terminal-glow)" }}>
          SCAN TO JOIN
        </div>
      </div>

      {/* QR + live count */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: portrait ? 24 : 28 }}>
        <div style={{ background: "#000", padding: 26, border: "4px solid var(--terminal-green)", boxShadow: "0 0 28px var(--terminal-glow)" }}>
          <CheckinQR size={qrSize} />
        </div>
        <div style={{ fontSize: 40, opacity: 0.75, letterSpacing: 3 }}>◊ POINT YOUR PHONE CAMERA AT THE CODE</div>
        <div className="terminal-border" style={{ padding: portrait ? "20px 40px" : "18px 44px", boxShadow: "0 0 16px var(--terminal-glow)" }}>
          <div style={{ fontSize: 40, opacity: 0.75, letterSpacing: 3 }}>TEAMS CHECKED IN</div>
          <div style={{ fontSize: portrait ? 150 : 132, fontWeight: 700, lineHeight: 1 }}>{count.data ?? 0}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Live count of teams checked in for one game (game_teams rows). Anon-readable (0011
 * public_read on game_teams). Realtime on game_teams keeps it current as patrons and the
 * host walk-up add teams during the hold (no sub-30s poll; 60s safety refetch).
 */
export function useCheckedInCount(gameId: string | null) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["holding", "checkedInCount", gameId],
    enabled: !!gameId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("game_teams")
        .select("id", { count: "exact", head: true })
        .eq("game_id", gameId as string);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!gameId) return;
    const ch = supabase
      .channel(`holding:teams:${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_teams", filter: `game_id=eq.${gameId}` },
        () => qc.invalidateQueries({ queryKey: ["holding", "checkedInCount", gameId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId, qc]);

  return query;
}
