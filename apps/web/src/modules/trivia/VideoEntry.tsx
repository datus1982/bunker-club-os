import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/supabaseClient";
import { log } from "@/shared/log";

/**
 * Inter-Round Videos — host tool (host+; /game/:gameId/videos). Ported from the
 * legacy VideoEntry.tsx. Set a YouTube URL per non-bonus round; the host reveals it
 * during the game (game_display_state.show_video) and GameDisplay plays it from
 * rounds.video_url. Save updates each round's video_url. Only regular/final rounds
 * can carry a video (bonus rounds are excluded, matching legacy).
 */

interface Round {
  id: string;
  round_number: number;
  round_type: string;
  round_name: string | null;
  video_url: string | null;
}

export function VideoEntry() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const initialized = useRef(false);

  const game = useQuery({
    queryKey: ["ve", "game", gameId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase.from("games").select("id, game_date").eq("id", gameId).single();
      if (error) throw error;
      return data as { id: string; game_date: string };
    },
  });

  const rounds = useQuery({
    queryKey: ["ve", "rounds", gameId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rounds")
        .select("id, round_number, round_type, round_name, video_url")
        .eq("game_id", gameId)
        .neq("round_type", "bonus")
        .order("round_number");
      if (error) throw error;
      return (data ?? []) as Round[];
    },
  });

  useEffect(() => {
    if (!rounds.data || initialized.current) return;
    const init: Record<string, string> = {};
    for (const r of rounds.data) init[r.id] = r.video_url ?? "";
    setUrls(init);
    initialized.current = true;
  }, [rounds.data]);

  const save = useMutation({
    mutationFn: async () => {
      for (const r of rounds.data ?? []) {
        const { error } = await supabase.from("rounds").update({ video_url: urls[r.id]?.trim() || null }).eq("id", r.id);
        if (error) throw error;
      }
      log("[VideoEntry] saved videos for", (rounds.data ?? []).length, "rounds");
    },
    onSuccess: () => {
      setDirty(false);
      setStatus("Videos saved.");
      qc.invalidateQueries({ queryKey: ["ve", "rounds", gameId] });
    },
    onError: (e: unknown) => setStatus(e instanceof Error ? e.message : "Save failed"),
  });

  if (!gameId) return <Centered text="NO GAME SELECTED" />;
  if (game.isPending || rounds.isPending) return <Centered text="LOADING…" />;
  if (game.isError || !game.data) return <Centered text="GAME NOT FOUND" />;

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: 40, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 44, fontWeight: 700, letterSpacing: 2 }}>INTER-ROUND VIDEOS</h1>
          <button type="button" onClick={() => navigate("/game/history")} style={btnGhost}>← HISTORY</button>
        </div>
        <div style={{ fontSize: 24, opacity: 0.7 }}>GAME · {game.data.game_date}{dirty && "  ·  ⚠ UNSAVED"}</div>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        <div style={{ fontSize: 20, opacity: 0.7, marginBottom: 16 }}>
          YouTube URL per round; the host reveals it during scoring and it autoplays on the audience display.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {rounds.data?.map((r) => {
            const embed = youTubeEmbed(urls[r.id] ?? "");
            return (
              <div key={r.id} className="terminal-border" style={{ padding: 16, display: "flex", gap: 16 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>
                    {r.round_type === "final" ? "FINAL ROUND" : `ROUND ${r.round_number}`}
                    {r.round_name ? <span style={{ opacity: 0.7 }}> — {r.round_name}</span> : null}
                  </div>
                  <input
                    value={urls[r.id] ?? ""}
                    onChange={(e) => { setUrls((u) => ({ ...u, [r.id]: e.target.value })); setDirty(true); }}
                    placeholder="https://www.youtube.com/watch?v=…"
                    style={input}
                  />
                  <div style={{ fontSize: 18, opacity: 0.6 }}>Plays after this round completes.</div>
                </div>
                <div style={{ width: 260, flexShrink: 0, aspectRatio: "16 / 9", background: "#000", border: "1px solid var(--terminal-green)" }}>
                  {embed ? (
                    <iframe width="100%" height="100%" src={embed} title={`preview ${r.round_number}`} frameBorder={0} allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" style={{ border: 0 }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, opacity: 0.5 }}>NO VIDEO</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 20 }}>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending} style={btnPrimary}>
            {save.isPending ? "SAVING…" : "SAVE ALL VIDEOS"}
          </button>
          {status && <span style={{ fontSize: 22 }}>{status}</span>}
        </div>
      </div>
    </div>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
      {text}
    </div>
  );
}

/** YouTube watch/short/embed URL → embed URL, or null. */
function youTubeEmbed(url: string): string | null {
  if (!url) return null;
  if (url.includes("youtube.com/embed/")) return url;
  const watch = url.match(/youtube\.com\/watch\?v=([^&]+)/);
  if (watch) return `https://www.youtube.com/embed/${watch[1]}`;
  const short = url.match(/youtu\.be\/([^?]+)/);
  if (short) return `https://www.youtube.com/embed/${short[1]}`;
  return null;
}

const input: React.CSSProperties = {
  background: "#000",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "8px 10px",
  fontSize: 22,
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--terminal-green)",
  color: "#000",
  border: "1px solid var(--terminal-green)",
  padding: "12px 20px",
  fontSize: 26,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnGhost: React.CSSProperties = {
  background: "transparent",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "8px 14px",
  fontSize: 22,
  cursor: "pointer",
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
