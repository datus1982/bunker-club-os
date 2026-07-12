import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import JSZip from "jszip";
import { supabase } from "@/shared/supabaseClient";
import { log } from "@/shared/log";

/**
 * Bulk Import from PowerPoint — host tool (host+; /game/:gameId/bulk-import). Ported
 * from the legacy BulkImport.tsx. All parsing is CLIENT-SIDE (JSZip) — the legacy
 * parse-powerpoint edge function was never actually called and is not ported.
 *
 * Flow: pick a .pptx → extract slide text + images (JSZip) → parse rounds/questions
 * (Round #N / Question #N / Answers; the first word on an answer slide is the answer)
 * + a trailing "Picture Round" → review → import into the game's existing rounds
 * (matched by round_number; picture round → the 'final' round), uploading the picture
 * image to the public `picture-rounds` bucket.
 *
 * Picture-round ANSWERS come from Gemini via the analyze-image edge function; if that
 * function isn't deployed the call fails gracefully and answers are left for manual
 * entry in QuestionEntry (legacy behaviour). Validated against a real Ronnie deck:
 * 5 rounds × 10 Q/A + 1 picture round parse correctly.
 */

interface ParsedQuestion {
  question_number: number;
  question_text: string;
  answer_text: string;
}
interface ParsedRound {
  round_number: number;
  round_name: string;
  questions: ParsedQuestion[];
  is_picture_round?: boolean;
  picture_image?: Blob;
}
interface SlideData {
  slideNumber: number;
  text: string;
  images: { name: string; data: Blob }[];
}

const decodeEntities = (t: string) => {
  const el = document.createElement("textarea");
  el.innerHTML = t;
  return el.value;
};

export function BulkImport() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedRound[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const game = useQuery({
    queryKey: ["bi", "game", gameId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase.from("games").select("id, game_date").eq("id", gameId).single();
      if (error) throw error;
      return data as { id: string; game_date: string };
    },
  });

  const rounds = useQuery({
    queryKey: ["bi", "rounds", gameId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase.from("rounds").select("id, round_number, round_type").eq("game_id", gameId).order("round_number");
      if (error) throw error;
      return (data ?? []) as { id: string; round_number: number; round_type: string }[];
    },
  });

  const process = async () => {
    if (!file) return;
    setProcessing(true);
    setStatus(null);
    try {
      const slides = await extractSlides(file);
      const result = await parseSlides(slides);
      if (result.length === 0) {
        setStatus("No rounds found in this PowerPoint.");
        return;
      }
      setParsed(result);
      const totalQ = result.reduce((s, r) => s + r.questions.length, 0);
      const pics = result.filter((r) => r.is_picture_round).length;
      setStatus(`Parsed ${result.length} round(s), ${totalQ} question(s)${pics ? `, ${pics} picture round` : ""}. Review, then import.`);
    } catch (e) {
      log("[BulkImport] parse error", e);
      setStatus(e instanceof Error ? e.message : "Failed to process PowerPoint");
    } finally {
      setProcessing(false);
    }
  };

  const importToDb = async () => {
    if (!parsed || !rounds.data || !gameId) return;
    setImporting(true);
    setStatus(null);
    try {
      let ok = 0;
      const problems: string[] = [];
      for (const pr of parsed) {
        const dbRound = rounds.data.find(
          (r) => r.round_number === pr.round_number && (pr.is_picture_round ? r.round_type === "final" : r.round_type !== "bonus"),
        );
        if (!dbRound) {
          problems.push(`Round ${pr.round_number}: no matching round in this game`);
          continue;
        }
        await supabase.from("rounds").update({ round_name: pr.round_name }).eq("id", dbRound.id);

        if (pr.is_picture_round && pr.picture_image) {
          const url = await uploadPicture(pr.picture_image, gameId);
          if (url) await supabase.from("rounds").update({ picture_url: url }).eq("id", dbRound.id);
          else problems.push(`Round ${pr.round_number}: picture upload failed`);
        }

        await supabase.from("questions").delete().eq("round_id", dbRound.id);
        if (pr.questions.length > 0) {
          const { error } = await supabase.from("questions").insert(
            pr.questions.map((q) => ({
              game_id: gameId,
              round_id: dbRound.id,
              question_number: q.question_number,
              question_text: q.question_text,
              answer_text: q.answer_text,
            })),
          );
          if (error) problems.push(`Round ${pr.round_number}: ${error.message}`);
          else ok++;
        } else {
          ok++;
        }
      }
      qc.invalidateQueries({ queryKey: ["qe"] });
      qc.invalidateQueries({ queryKey: ["bi", "rounds", gameId] });
      log("[BulkImport] imported", ok, "rounds; problems:", problems);
      if (ok > 0) {
        setStatus(`Imported ${ok} round(s).${problems.length ? " Issues: " + problems.join("; ") : ""} Redirecting…`);
        setTimeout(() => navigate(`/game/${gameId}/questions`), 1200);
      } else {
        setStatus(`Import failed. ${problems.join("; ")}`);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  if (!gameId) return <Centered text="NO GAME SELECTED" />;
  if (game.isPending) return <Centered text="LOADING…" />;
  if (game.isError || !game.data) return <Centered text="GAME NOT FOUND" />;

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: 40, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 44, fontWeight: 700, letterSpacing: 2 }}>BULK IMPORT · POWERPOINT</h1>
          <button type="button" onClick={() => navigate(`/game/${gameId}/questions`)} style={btnGhost}>← QUESTIONS</button>
        </div>
        <div style={{ fontSize: 24, opacity: 0.7 }}>GAME · {game.data.game_date}</div>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        <div className="terminal-border" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 20, opacity: 0.8, marginBottom: 12 }}>
            Upload the weekly .pptx. Extracts round names, questions + answers, and the picture round.
            Import matches parsed rounds to this game's existing rounds by number — create the game with the right round count first.
          </div>
          <input type="file" accept=".pptx" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setParsed(null); setStatus(null); }} style={{ ...input, width: "100%" }} />
          <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
            <button type="button" onClick={process} disabled={!file || processing} style={btnPrimary}>
              {processing ? "PROCESSING…" : "PROCESS POWERPOINT"}
            </button>
            {file && <span style={{ fontSize: 20, opacity: 0.7, alignSelf: "center" }}>✓ {file.name}</span>}
          </div>
        </div>

        {parsed && (
          <div className="terminal-border" style={{ padding: 20, marginBottom: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 28, fontWeight: 700 }}>REVIEW — {parsed.length} ROUND(S)</div>
            {parsed.map((r) => (
              <div key={r.round_number} className="terminal-border" style={{ padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>ROUND {r.round_number}: {r.round_name}{r.is_picture_round ? " [PICTURE]" : ""}</div>
                  <div style={{ fontSize: 20, opacity: 0.7 }}>{r.questions.length} {r.is_picture_round ? "answer(s)" : "question(s)"}</div>
                </div>
                {!r.is_picture_round && r.questions.slice(0, 2).map((q) => (
                  <div key={q.question_number} style={{ fontSize: 18, marginTop: 6 }}>
                    <div>Q{q.question_number}: {q.question_text.slice(0, 90)}</div>
                    <div style={{ opacity: 0.7 }}>A: {q.answer_text || "(no answer)"}</div>
                  </div>
                ))}
                {!r.is_picture_round && r.questions.length > 2 && <div style={{ fontSize: 16, opacity: 0.6, marginTop: 4 }}>… and {r.questions.length - 2} more</div>}
                {r.is_picture_round && r.picture_image && (
                  <div style={{ marginTop: 8 }}>
                    <img src={URL.createObjectURL(r.picture_image)} alt="picture round" style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain", border: "1px solid var(--terminal-green)" }} />
                    {r.questions.length === 0 && <div style={{ fontSize: 18, opacity: 0.7, marginTop: 4 }}>Answers not auto-extracted — enter them in Question Entry after import.</div>}
                  </div>
                )}
              </div>
            ))}
            <button type="button" onClick={importToDb} disabled={importing} style={btnPrimary}>
              {importing ? "IMPORTING…" : "IMPORT TO GAME"}
            </button>
          </div>
        )}

        {status && <div className="terminal-border" style={{ padding: 12, fontSize: 20 }}>{status}</div>}
      </div>
    </div>
  );
}

/* ── PPTX extraction + parsing (client-side) ───────────────────────────────── */

async function extractSlides(file: File): Promise<SlideData[]> {
  const zip = await JSZip.loadAsync(file);
  const slideFiles: { name: string; num: number }[] = [];
  zip.forEach((path) => {
    const m = path.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (m) slideFiles.push({ name: path, num: parseInt(m[1]) });
  });
  slideFiles.sort((a, b) => a.num - b.num);

  const slides: SlideData[] = [];
  for (const sf of slideFiles) {
    const xml = (await zip.file(sf.name)?.async("string")) ?? "";
    const texts = Array.from(xml.matchAll(/<a:t>([^<]*)<\/a:t>/g), (m) => m[1]);
    const text = texts.join("\n").replace(/\n+/g, "\n").trim();

    const images: { name: string; data: Blob }[] = [];
    const embedIds = Array.from(xml.matchAll(/r:embed="(rId\d+)"/g), (m) => m[1]);
    if (embedIds.length > 0) {
      const rels = (await zip.file(`ppt/slides/_rels/slide${sf.num}.xml.rels`)?.async("string")) ?? "";
      for (const id of embedIds) {
        const target = rels.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`));
        if (target) {
          const path = `ppt/${target[1].replace("../", "")}`;
          const f = zip.file(path);
          if (f) images.push({ name: path.split("/").pop() ?? "", data: await f.async("blob") });
        }
      }
    }
    slides.push({ slideNumber: sf.num, text, images });
  }
  return slides;
}

async function parseSlides(slides: SlideData[]): Promise<ParsedRound[]> {
  const out: ParsedRound[] = [];
  let cur: ParsedRound | null = null;
  let buf: ParsedQuestion[] = [];
  let inAnswers = false;

  for (const s of slides) {
    const text = s.text.trim();
    if (!text && !(cur?.is_picture_round && s.images.length > 0)) continue;

    // Picture round (a slide titled "Picture Round" that carries the image).
    if (/^Picture\s+Round/i.test(text) && s.images.length > 0) {
      if (cur) { cur.questions = buf; out.push(cur); }
      const last = out.length ? Math.max(...out.map((r) => r.round_number)) : 0;
      cur = { round_number: last + 1, round_name: "Picture Round", is_picture_round: true, questions: [], picture_image: s.images[0]?.data };
      buf = [];
      inAnswers = false;
      continue;
    }

    // Picture-round title/answers slide: pull the round name; try AI for answers.
    if (cur?.is_picture_round && (/^PICTURE\s+ROUND/i.test(text) || /^Answers/i.test(text))) {
      if (/^PICTURE\s+ROUND/i.test(text)) {
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        if (lines.length >= 2 && lines[1].toLowerCase() !== "answers") cur.round_name = decodeEntities(lines[1]);
      }
      if (s.images.length > 0) {
        const answers = await analyzePicture(s.images[0].data);
        answers.forEach((a, i) => buf.push({ question_number: i + 1, question_text: "", answer_text: decodeEntities(a) }));
      }
      continue;
    }

    // Round marker: "Round #N Title".
    const rm = text.match(/^Round\s*#(\d+)(\s*.*)?$/im);
    if (rm) {
      if (cur) { cur.questions = buf; out.push(cur); }
      const n = parseInt(rm[1]);
      cur = { round_number: n, round_name: rm[2] ? decodeEntities(rm[2].trim()) : `Round ${n}`, questions: [] };
      buf = [];
      inAnswers = false;
      continue;
    }

    // Answer-section marker.
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const first = lines[0]?.toLowerCase() ?? "";
    if (first === "answers" || first.startsWith("answers ")) { inAnswers = true; continue; }

    // Question / answer slides.
    const qm = text.match(/^Question\s*#(\d+)\s+([\s\S]+)$/im);
    if (qm && cur) {
      const n = parseInt(qm[1]);
      const content = qm[2].trim();
      const existing = buf.find((q) => q.question_number === n);
      if (existing && !existing.answer_text && !inAnswers) inAnswers = true; // missing "Answers" slide
      if (!inAnswers) {
        buf.push({ question_number: n, question_text: decodeEntities(content.replace(/\n/g, " ")), answer_text: "" });
      } else {
        let ans = content.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
        const nx = ans.match(/^(.+?)\s+Question\s*#\d+/i);
        if (nx) ans = nx[1].trim();
        ans = ans.replace(/\s+Question\s*#\d+.*$/i, "").trim();
        if (existing) existing.answer_text = decodeEntities(ans);
      }
    }
  }
  if (cur) { cur.questions = buf; out.push(cur); }
  return out;
}

/**
 * Picture-round answers via the analyze-image edge function (Gemini). Returns [] if
 * the function isn't deployed or errors — answers are then entered manually.
 */
async function analyzePicture(blob: Blob): Promise<string[]> {
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve((r.result as string).split(",")[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-image`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        image: base64,
        mimeType: blob.type || "image/png",
        prompt: "Extract ALL the trivia answers from this image, in order. Ignore numbering; return just the text. Keep multi-part answers whole.",
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return JSON.parse(data.text ?? "{}").answers ?? [];
  } catch (e) {
    log("[BulkImport] analyze-image unavailable", e);
    return [];
  }
}

async function uploadPicture(blob: Blob, gameId: string): Promise<string | null> {
  const ext = blob.type?.split("/")[1] || "png";
  const name = `game-${gameId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("picture-rounds").upload(name, blob, { cacheControl: "3600", upsert: false });
  if (error) {
    log("[BulkImport] upload error", error);
    return null;
  }
  return supabase.storage.from("picture-rounds").getPublicUrl(name).data.publicUrl;
}

function Centered({ text }: { text: string }) {
  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
      {text}
    </div>
  );
}

const input: React.CSSProperties = {
  background: "#000",
  color: "var(--terminal-green)",
  border: "1px solid var(--terminal-green)",
  padding: "8px 10px",
  fontSize: 20,
  fontFamily: "'VT323','Share Tech Mono',monospace",
};
const btnPrimary: React.CSSProperties = {
  background: "var(--terminal-green)",
  color: "#000",
  border: "1px solid var(--terminal-green)",
  padding: "12px 20px",
  fontSize: 24,
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
