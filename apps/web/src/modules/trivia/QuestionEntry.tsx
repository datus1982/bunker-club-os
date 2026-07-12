import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/supabaseClient";
import { log } from "@/shared/log";

/**
 * Question Entry — host tool (host+; /game/:gameId/questions). Ported from the legacy
 * QuestionEntry.tsx. Pick a round, fill its question/answer slots, save. Bonus rounds
 * number their questions from 11 (so displays can tell bonus from regular, matching
 * GameDisplay's `question_number > 10` check); a three-chance bonus has 3 questions
 * sharing ONE answer. Save = delete the round's questions then insert the filled ones.
 *
 * DECISIONS: header shows game_date (no legacy games.name); picture-round IMAGE UPLOAD
 * and the "Bulk Import" link land with BulkImport (needs the parse-powerpoint edge fn).
 * The paste-text import is kept (self-contained).
 */

interface Round {
  id: string;
  round_number: number;
  round_type: string;
  round_name: string | null;
  picture_url: string | null;
  bonus_description: string | null;
  bonus_type: string | null;
  bonus_round_numbers: number[] | null;
}

interface QSlot {
  id?: string;
  question_number: number;
  question_text: string;
  answer_text: string;
}

export function QuestionEntry() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [slots, setSlots] = useState<QSlot[]>([]);
  const [roundName, setRoundName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const loadedRound = useRef<string>("");

  const game = useQuery({
    queryKey: ["qe", "game", gameId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("games")
        .select("id, game_date, questions_per_round")
        .eq("id", gameId)
        .single();
      if (error) throw error;
      return data as { id: string; game_date: string; questions_per_round: number };
    },
  });

  const rounds = useQuery({
    queryKey: ["qe", "rounds", gameId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rounds")
        .select("id, round_number, round_type, round_name, picture_url, bonus_description, bonus_type, bonus_round_numbers")
        .eq("game_id", gameId)
        .order("round_number");
      if (error) throw error;
      return (data ?? []) as Round[];
    },
  });

  const allQuestions = useQuery({
    queryKey: ["qe", "questions", gameId],
    enabled: !!gameId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("questions")
        .select("id, round_id, question_number, question_text, answer_text")
        .eq("game_id", gameId)
        .order("question_number");
      if (error) throw error;
      return (data ?? []) as (QSlot & { round_id: string })[];
    },
  });

  const selectedRound = rounds.data?.find((r) => r.id === selectedRoundId) ?? null;
  const isThreeChance = selectedRound?.round_type === "bonus" && selectedRound?.bonus_type === "three-chance";

  // Per-round completion (has ≥1 saved question) for the selector indicators.
  const answeredRounds = useMemo(() => {
    const s = new Set<string>();
    for (const q of allQuestions.data ?? []) if (q.question_text) s.add(q.round_id);
    return s;
  }, [allQuestions.data]);

  // Initialise the editable slots when a round is (re)selected and its data is ready.
  useEffect(() => {
    if (!selectedRoundId || !selectedRound || !game.data || !allQuestions.isSuccess) return;
    if (loadedRound.current === selectedRoundId) return;
    loadedRound.current = selectedRoundId;

    const start = selectedRound.round_type === "bonus" ? 11 : 1;
    const count = selectedRound.round_type === "bonus" ? (isThreeChance ? 3 : 1) : game.data.questions_per_round;
    const existing = (allQuestions.data ?? [])
      .filter((q) => q.round_id === selectedRoundId)
      .sort((a, b) => a.question_number - b.question_number);

    const next: QSlot[] = [];
    for (let i = 0; i < count; i++) {
      const ex = existing[i];
      next.push(
        ex
          ? { id: ex.id, question_number: ex.question_number, question_text: ex.question_text, answer_text: ex.answer_text }
          : { question_number: start + i, question_text: "", answer_text: "" },
      );
    }
    setSlots(next);
    setRoundName(selectedRound.round_name ?? "");
    setDirty(false);
    setStatus(null);
  }, [selectedRoundId, selectedRound, game.data, allQuestions.isSuccess, allQuestions.data, isThreeChance]);

  const save = useMutation({
    mutationFn: async () => {
      const filled = slots.filter((s) => s.question_text.trim() && s.answer_text.trim());
      if (filled.length === 0) throw new Error("Enter at least one question and answer.");
      const { error: delErr } = await supabase.from("questions").delete().eq("round_id", selectedRoundId);
      if (delErr) throw delErr;
      const { error: insErr } = await supabase.from("questions").insert(
        filled.map((s) => ({
          game_id: gameId,
          round_id: selectedRoundId,
          question_number: s.question_number,
          question_text: s.question_text.trim(),
          answer_text: s.answer_text.trim(),
        })),
      );
      if (insErr) throw insErr;
      log("[QuestionEntry] saved", filled.length, "questions to round", selectedRoundId);
      return filled.length;
    },
    onSuccess: (n) => {
      setDirty(false);
      setStatus(`Saved ${n} question${n === 1 ? "" : "s"}.`);
      qc.invalidateQueries({ queryKey: ["qe", "questions", gameId] });
    },
    onError: (e: unknown) => setStatus(e instanceof Error ? e.message : "Save failed"),
  });

  const saveRoundName = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("rounds").update({ round_name: roundName.trim() || null }).eq("id", selectedRoundId);
      if (error) throw error;
    },
    onSuccess: () => {
      setStatus("Round name updated.");
      qc.invalidateQueries({ queryKey: ["qe", "rounds", gameId] });
    },
    onError: (e: unknown) => setStatus(e instanceof Error ? e.message : "Failed to update round name"),
  });

  const patch = (i: number, field: "question_text" | "answer_text", value: string) => {
    setSlots((s) => {
      const n = [...s];
      if (isThreeChance && field === "answer_text") n.forEach((q, idx) => (n[idx] = { ...q, answer_text: value }));
      else n[i] = { ...n[i], [field]: value };
      return n;
    });
    setDirty(true);
  };

  const runImport = () => {
    const parsed = parseQA(importText);
    if (parsed.length === 0) {
      setStatus("No Q/A pairs found. Use 'Q: …' / 'A: …' lines.");
      return;
    }
    setSlots((s) => s.map((slot, i) => (parsed[i] ? { ...slot, question_text: parsed[i].q, answer_text: parsed[i].a } : slot)));
    setDirty(true);
    setImportOpen(false);
    setImportText("");
    setStatus(`Imported ${parsed.length} question(s) — review and Save.`);
  };

  if (!gameId) return <Centered text="NO GAME SELECTED" />;
  if (game.isPending || rounds.isPending) return <Centered text="LOADING…" />;
  if (game.isError || !game.data) return <Centered text="GAME NOT FOUND" />;

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: 40, fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
          <h1 style={{ fontSize: 44, fontWeight: 700, letterSpacing: 2 }}>QUESTION ENTRY</h1>
          <button type="button" onClick={() => navigate("/history")} style={btnGhost}>← HISTORY</button>
        </div>
        <div style={{ fontSize: 24, opacity: 0.7 }}>GAME · {game.data.game_date}{dirty && "  ·  ⚠ UNSAVED"}</div>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        <div className="terminal-border" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 24, marginBottom: 8 }}>SELECT ROUND</div>
          <select value={selectedRoundId} onChange={(e) => setSelectedRoundId(e.target.value)} style={{ ...input, width: "100%" }}>
            <option value="">— choose a round —</option>
            {rounds.data?.map((r) => (
              <option key={r.id} value={r.id}>
                {answeredRounds.has(r.id) ? "✓ " : "○ "}{roundLabel(r)}{r.round_name ? ` — ${r.round_name}` : ""}{r.picture_url ? " [IMG]" : ""}
              </option>
            ))}
          </select>
        </div>

        {selectedRound && (
          <div className="terminal-border" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ fontSize: 30, fontWeight: 700 }}>{roundLabel(selectedRound)}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setImportOpen((o) => !o)} style={btnGhost}>IMPORT TEXT</button>
                <button type="button" onClick={() => save.mutate()} disabled={save.isPending} style={btnPrimary}>
                  {save.isPending ? "SAVING…" : "SAVE ROUND"}
                </button>
              </div>
            </div>

            <div style={{ fontSize: 20, opacity: 0.7 }}>
              {isThreeChance
                ? "3 questions (one per round) sharing ONE answer."
                : selectedRound.round_type === "bonus"
                  ? "1 bonus question and answer."
                  : `${slots.length} questions and answers.`}
            </div>

            {/* Round name */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 20, opacity: 0.8 }}>ROUND NAME (shown on displays)</span>
                <input value={roundName} onChange={(e) => setRoundName(e.target.value)} placeholder="e.g. GENERAL KNOWLEDGE" style={input} />
              </div>
              <button type="button" onClick={() => saveRoundName.mutate()} disabled={saveRoundName.isPending || roundName === (selectedRound.round_name ?? "")} style={btnGhost}>
                UPDATE
              </button>
            </div>

            {selectedRound.picture_url && (
              <div className="terminal-border" style={{ padding: 12 }}>
                <div style={{ fontSize: 20, marginBottom: 8 }}>PICTURE ROUND IMAGE</div>
                <img src={selectedRound.picture_url} alt="Picture round" style={{ maxWidth: "100%", border: "1px solid var(--terminal-green)" }} />
              </div>
            )}

            {importOpen && (
              <div className="terminal-border" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 20, opacity: 0.8 }}>Paste "Q: …" / "A: …" pairs, then IMPORT into slots:</div>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8} style={{ ...input, fontSize: 18 }} placeholder={"Q: What element is number 6?\nA: Carbon"} />
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={runImport} disabled={!importText.trim()} style={btnPrimary}>IMPORT</button>
                  <button type="button" onClick={() => { setImportOpen(false); setImportText(""); }} style={btnGhost}>CANCEL</button>
                </div>
              </div>
            )}

            {slots.map((s, i) => (
              <div key={i} className="terminal-border" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  QUESTION {i + 1}
                  {isThreeChance && selectedRound.bonus_round_numbers?.[i] != null ? ` (ROUND ${selectedRound.bonus_round_numbers[i]})` : ""}
                </div>
                <textarea value={s.question_text} onChange={(e) => patch(i, "question_text", e.target.value)} rows={2} placeholder="Question" style={{ ...input, fontSize: 20 }} />
                {(!isThreeChance || i === 0) && (
                  <input
                    value={s.answer_text}
                    onChange={(e) => patch(i, "answer_text", e.target.value)}
                    placeholder={isThreeChance ? "Answer (shared for all 3)" : "Answer"}
                    style={input}
                  />
                )}
              </div>
            ))}

            {status && <div className="terminal-border" style={{ padding: 10, fontSize: 20 }}>{status}</div>}
          </div>
        )}

        {!selectedRound && <div style={{ fontSize: 24, opacity: 0.6, marginTop: 16 }}>Select a round to enter questions.</div>}
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function Centered({ text }: { text: string }) {
  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
      {text}
    </div>
  );
}

function roundLabel(r: Round): string {
  if (r.round_type === "bonus") return `BONUS: ${(r.bonus_description || "SPECIAL").toUpperCase()}`;
  if (r.round_type === "final") return "FINAL ROUND";
  return `ROUND ${r.round_number}`;
}

/** Parse pasted "Q:/A:" (or "1. …" / "Answer: …") text into Q/A pairs. Ported. */
function parseQA(text: string): { q: string; a: string }[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: { q: string; a: string }[] = [];
  let q = "";
  let a = "";
  const qMark = /^(Q:?|Question\s+\d+:?|\d+[.)])\s*/i;
  const aMark = /^(A:?|Answer:?)\s*/i;
  for (const line of lines) {
    if (qMark.test(line)) {
      if (q && a) { out.push({ q, a }); q = ""; a = ""; }
      q = line.replace(qMark, "").trim();
    } else if (aMark.test(line)) {
      a = line.replace(aMark, "").trim();
    } else if (q && !a) {
      q += " " + line;
    } else if (q && a) {
      a += " " + line;
    }
  }
  if (q && a) out.push({ q, a });
  return out;
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
  padding: "10px 18px",
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
