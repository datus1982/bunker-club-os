import { useEffect, useState } from "react";

/**
 * Inter-round video (docs/04 port of VideoPlayer.tsx). YouTube URLs are normalised
 * to an embed with autoplay + chrome stripped (no controls/branding/related/kbd),
 * so an unattended display can't be navigated away. A black bar hides the YouTube
 * title card for the first 7s. Ported behavior-identical.
 */
export function VideoPlayer({ videoUrl, autoplay = true }: { videoUrl: string; autoplay?: boolean }) {
  const [showOverlay, setShowOverlay] = useState(true);

  useEffect(() => {
    setShowOverlay(true);
    const timer = window.setTimeout(() => setShowOverlay(false), 7000);
    return () => window.clearTimeout(timer);
  }, [videoUrl]);

  const embedUrl = getEmbedUrl(videoUrl, autoplay);

  return (
    <div style={{ width: "100%", height: "100%", background: "#000", position: "relative" }}>
      <iframe
        width="100%"
        height="100%"
        src={embedUrl}
        title="Inter-round video"
        frameBorder={0}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        style={{ width: "100%", height: "100%", border: 0 }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          background: "#000",
          pointerEvents: "none",
          transition: "opacity 1s",
          opacity: showOverlay ? 1 : 0,
        }}
      />
    </div>
  );
}

function parseYouTubeUrl(url: string): string | null {
  if (!url) return null;
  if (url.includes("youtube.com/embed/")) return url;
  const watch = url.match(/youtube\.com\/watch\?v=([^&]+)/);
  if (watch) return `https://www.youtube.com/embed/${watch[1]}`;
  const short = url.match(/youtu\.be\/([^?]+)/);
  if (short) return `https://www.youtube.com/embed/${short[1]}`;
  return null;
}

function getEmbedUrl(url: string, autoplay: boolean): string {
  const yt = parseYouTubeUrl(url);
  if (!yt) return url;
  const sep = yt.includes("?") ? "&" : "?";
  return `${yt}${sep}autoplay=${autoplay ? "1" : "0"}&controls=0&modestbranding=1&rel=0&loop=0&disablekb=1&fs=0&iv_load_policy=3`;
}
