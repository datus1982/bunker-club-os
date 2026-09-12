import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useIsMobile } from "@/shared/useIsMobile";
import { StaffPageHeader } from "@/shared/ui";
import { cx, useTriviaV2 } from "../trivia/triviaV2";
import {
  completeSeason, createFinalsNight, createSeason, useSeasonDetail, useSeasons,
  type Season, type StandingRow,
} from "./useSeasons";

/**
 * /admin/seasons (docs/06, admin role). Create seasons (overlap prevented by DB
 * constraint), view live standings via season_leaderboard, create a finals night
 * (pre-checks-in top N), complete a season. All ranking reads season_leaderboard.
 *
 * POLISH ARC 2 (PR 3): one of the five trivia staff pages the `bunker.trivia_ui_version`
 * switch governs. The v2 branch is a VARIANT applied at the leaves — same component,
 * same data layer, same DOM shape — so classic stays byte-identical by construction
 * (every `v2 ?` reads false without the provider). Per spec §A2 this page carries no
 * Scoring-style carve-out: it is between-game admin, so it takes the full system
 * including sentence-case body copy.
 */
export function SeasonsAdmin() {
  const qc = useQueryClient();
  const seasonsQ = useSeasons();
  const v2 = useTriviaV2();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["seasons"] });

  return (
    <div
      // v2 drops the nested `.terminal-theme` (the shell root already carries it, and a
      // second one paints its own CRT overlay) and the inline VT323/green, which the
      // token scope would have to fight. `data-st-page` is the whole opt-in.
      {...(v2 ? { "data-st-page": "" } : { className: "terminal-theme" })}
      style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 32px)", ...(v2 ? null : { fontFamily: "'VT323','Share Tech Mono',monospace", color: "var(--terminal-green)" }) }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {v2 ? (
          <StaffPageHeader
            eyebrow="GAMES ▸ SEASONS"
            title="Seasons"
            tag={seasonsQ.data ? `${seasonsQ.data.length} TOTAL` : undefined}
            right={<Link to="/dashboard" className="st-body" style={linkBtn}>Dashboard</Link>}
          />
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <h1 style={{ fontSize: "clamp(26px, 6vw, 40px)", fontWeight: 700, letterSpacing: 2 }}>SEASONS / CAMPAIGNS</h1>
              <Link to="/dashboard" style={linkBtn}>DASHBOARD</Link>
            </div>
            <div className="terminal-separator" style={{ margin: "16px 0" }} />
          </>
        )}

        {!selected && (
          <>
            <button className={cx(v2 && "st-btn-primary", v2 && "st-body")} style={btnPrimary} onClick={() => setCreating(!creating)}>
              {v2 ? (creating ? "Cancel" : "+ New season") : (creating ? "CANCEL" : "+ NEW SEASON")}
            </button>
            {creating && <CreateForm onDone={() => { setCreating(false); refresh(); }} />}
            <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
              {(seasonsQ.data ?? []).length === 0 && <p className={cx(v2 && "st-body st-t2")} style={{ opacity: v2 ? 1 : 0.6 }}>No seasons yet.</p>}
              {(seasonsQ.data ?? []).map((s) => (
                <button key={s.id} className={cx("terminal-border", v2 && "st-row")} style={{ ...rowBtn }} onClick={() => setSelected(s.id)}>
                  <span className={cx(v2 && "st-heading st-t1")} style={{ fontSize: 24 }}>{s.name}</span>
                  <span className={cx(v2 && "st-body st-t2")} style={{ fontSize: 18, opacity: v2 ? 1 : 0.7 }}>{s.starts_on} → {s.ends_on} · {s.scoring_mode}{s.best_n ? `(${s.best_n})` : ""} · {s.status.toUpperCase()}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {selected && <SeasonDetail seasonId={selected} onBack={() => { setSelected(null); refresh(); }} />}
      </div>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", starts_on: "", ends_on: "", scoring_mode: "best_n", best_n: "8", placement_points: "10,7,5,3,2,1", playoff_size: "4" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const narrow = useIsMobile();
  const v2 = useTriviaV2();
  const submit = async () => {
    if (!f.name || !f.starts_on || !f.ends_on) return setErr("Name and dates are required.");
    setBusy(true); setErr(null);
    const r = await createSeason({
      name: f.name.trim(), starts_on: f.starts_on, ends_on: f.ends_on, scoring_mode: f.scoring_mode,
      best_n: f.scoring_mode === "best_n" ? parseInt(f.best_n) || null : null,
      placement_points: f.scoring_mode === "placement" ? f.placement_points.split(",").map((x) => parseInt(x.trim())).filter((x) => !isNaN(x)) : null,
      playoff_size: f.playoff_size ? parseInt(f.playoff_size) : null,
    });
    setBusy(false);
    if (r.ok) onDone(); else setErr(r.error ?? "Failed");
  };
  return (
    <div className={cx("terminal-border", v2 && "st-panel")} style={{ padding: 16, marginTop: 14, display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
      <Field label="NAME"><input style={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Summer Wasteland Circuit" /></Field>
      <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", gap: 12 }}>
        <Field label="STARTS"><input type="date" style={input} value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></Field>
        <Field label="ENDS"><input type="date" style={input} value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></Field>
      </div>
      <Field label="SCORING MODE">
        <select style={input} value={f.scoring_mode} onChange={(e) => setF({ ...f, scoring_mode: e.target.value })}>
          <option value="best_n" style={{ background: "#000" }}>best_n (best N nights)</option>
          <option value="cumulative" style={{ background: "#000" }}>cumulative (sum all)</option>
          <option value="placement" style={{ background: "#000" }}>placement (points per finish)</option>
        </select>
      </Field>
      {f.scoring_mode === "best_n" && <Field label="BEST N (nights counted)"><input type="number" style={input} value={f.best_n} onChange={(e) => setF({ ...f, best_n: e.target.value })} /></Field>}
      {f.scoring_mode === "placement" && <Field label="PLACEMENT POINTS (comma list, 1st→last)"><input style={input} value={f.placement_points} onChange={(e) => setF({ ...f, placement_points: e.target.value })} /></Field>}
      <Field label="PLAYOFF SIZE (top N to finals; blank = none)"><input type="number" style={input} value={f.playoff_size} onChange={(e) => setF({ ...f, playoff_size: e.target.value })} /></Field>
      {err && <div className={cx(v2 && "st-body st-danger")} style={{ fontSize: 20 }}>⚠ {err}</div>}
      <button className={cx(v2 && "st-btn-primary st-body")} style={btnPrimary} disabled={busy} onClick={submit}>
        {v2 ? (busy ? "Creating…" : "Create season") : (busy ? "CREATING…" : "CREATE SEASON")}
      </button>
    </div>
  );
}

function SeasonDetail({ seasonId, onBack }: { seasonId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const detailQ = useSeasonDetail(seasonId);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const v2 = useTriviaV2();
  const d = detailQ.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["seasons"] });

  if (detailQ.isLoading || !d?.season) return <p className={cx(v2 && "st-body st-t2")} style={{ opacity: v2 ? 1 : 0.6 }}>Loading…</p>;
  const s: Season = d.season;

  const doFinals = async () => {
    setBusy(true); setMsg(null);
    const r = await createFinalsNight(s, d.standings as StandingRow[]);
    setBusy(false);
    setMsg(r.ok ? `Finals night created — top ${s.playoff_size} pre-checked-in.` : `⚠ ${r.error}`);
    refresh();
  };
  const doComplete = async () => { setBusy(true); await completeSeason(seasonId); setBusy(false); setMsg("Season completed."); refresh(); };

  return (
    <>
      <button className={cx(v2 && "st-body")} style={linkBtn} onClick={onBack}>← all seasons</button>
      <h2 className={cx(v2 && "st-display st-t1")} style={{ fontSize: 32, marginTop: 12 }}>{s.name}</h2>
      <p className={cx(v2 && "st-body st-t2")} style={{ opacity: v2 ? 1 : 0.7, fontSize: 20 }}>{s.starts_on} → {s.ends_on} · {s.scoring_mode}{s.best_n ? ` (best ${s.best_n})` : ""} · {s.status.toUpperCase()}{s.finals_game_id ? " · FINALS SET" : ""}</p>

      <div style={{ display: "flex", gap: 10, margin: "14px 0", flexWrap: "wrap" }}>
        {s.playoff_size && s.status !== "completed" && (
          <button className={cx(v2 && "st-btn-primary st-body")} style={btnPrimary} disabled={busy || !!s.finals_game_id} onClick={doFinals}>
            {v2
              ? (s.finals_game_id ? "Finals created" : `▶ Create finals (top ${s.playoff_size})`)
              : (s.finals_game_id ? "FINALS CREATED" : `▶ CREATE FINALS (TOP ${s.playoff_size})`)}
          </button>
        )}
        {s.status !== "completed" && <button className={cx(v2 && "st-body")} style={btnGhost} disabled={busy} onClick={doComplete}>{v2 ? "■ Complete season" : "■ COMPLETE SEASON"}</button>}
        {s.finals_game_id && <Link to="/scoring" className={cx(v2 && "st-body")} style={linkBtn}>{v2 ? "Open scoring →" : "OPEN SCORING →"}</Link>}
      </div>
      {msg && <div className={cx(v2 && "st-body st-t1")} style={{ fontSize: 20, margin: "8px 0" }}>{msg}</div>}

      <div className="terminal-separator" style={{ margin: "16px 0" }} />
      <h3 className={cx(v2 && "st-heading st-t1")} style={{ fontSize: 24 }}>STANDINGS <span className={cx(v2 && "st-label st-t3")} style={{ opacity: v2 ? 1 : 0.5, fontSize: 16 }}>(via season_leaderboard)</span></h3>
      {d.standings.length === 0 ? <p className={cx(v2 && "st-body st-t2")} style={{ opacity: v2 ? 1 : 0.6 }}>No completed games in this season yet.</p> : (
        <table className={cx(v2 && "st-mono")} style={{ width: "100%", borderCollapse: "collapse", fontSize: 20, marginTop: 8 }}>
          <thead><tr>{["#", "TEAM", "SCORE", "WINS", "GP"].map((h) => <th key={h} className={cx(v2 && "st-label st-t2")} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {/* A playoff-berth row is emphasis, not a live state: in v2 it takes the calm
                accent (`st-accent`), never the reserved full-saturation green. */}
            {d.standings.map((r) => {
              const inPlayoff = !!s.playoff_size && r.rank <= s.playoff_size;
              // `.terminal-theme *` sizes EVERY element, so a class on the <table> never
              // reaches a <td> (nothing inherits font-size here — PR #89). The Mono role
              // therefore goes on each cell; `font-variant-numeric` alone would have
              // inherited, the 15px would not.
              const cellCls = cx(v2 && "st-mono", v2 && inPlayoff && "st-accent");
              return (
                <tr key={r.team_id} className={cx(v2 && inPlayoff && "st-accent")} style={inPlayoff ? (v2 ? { fontWeight: 700 } : { color: "var(--terminal-green)", fontWeight: 700 }) : {}}>
                  <td className={cellCls} style={td}>{r.rank}{inPlayoff ? " ★" : ""}</td>
                  <td className={cellCls} style={td}>{r.team_name}</td>
                  <td className={cellCls} style={td}>{Math.round(r.score)}</td>
                  <td className={cellCls} style={td}>{r.wins}</td>
                  <td className={cellCls} style={td}>{r.games_played}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="terminal-separator" style={{ margin: "16px 0" }} />
      <h3 className={cx(v2 && "st-heading st-t1")} style={{ fontSize: 24 }}>GAMES ({d.games.length})</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {d.games.map((g) => (
          <div key={g.id} className={cx(v2 && "st-body st-t2")} style={{ display: "flex", justifyContent: "space-between", fontSize: 18, opacity: v2 ? 1 : 0.85 }}>
            <span>{g.game_date}{g.is_playoff ? " · ★ FINALS" : ""}</span><span className={cx(v2 && "st-t3")} style={{ opacity: v2 ? 1 : 0.6 }}>{g.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const v2 = useTriviaV2();
  return <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}><span className={cx(v2 && "st-label st-t2")} style={{ fontSize: 15, opacity: v2 ? 1 : 0.7, letterSpacing: 1 }}>{label}</span>{children}</label>;
}

const input: React.CSSProperties = { background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 10px", fontSize: 20, fontFamily: "'VT323','Share Tech Mono',monospace", width: "100%" };
// Canonical staff-button geometry (2026-07-13 consistency pass): minHeight 44 + matching
// padding; size/family governed by the staff-ui theme rules.
const btnPrimary: React.CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "10px 20px", minHeight: 44, fontWeight: 700, cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace" };
const btnGhost: React.CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "10px 18px", minHeight: 44, cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace" };
const linkBtn: React.CSSProperties = { ...btnGhost, textDecoration: "none", display: "inline-block" };
const rowBtn: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, padding: "12px 16px", background: "transparent", color: "var(--terminal-green)", cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace", textAlign: "left" };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--terminal-green)", fontSize: 16, opacity: 0.7 };
const td: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid rgba(0,255,65,0.2)" };
