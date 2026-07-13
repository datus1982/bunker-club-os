import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";

/**
 * /admin/drinks — drinks board config (docs/08, staff role). Collects NO secrets:
 * Toast credentials live only in edge-fn secrets (SEC-3). This page picks which menu
 * groups the board rotates (from the sync-discovered list + the MAIN_MENU_ALL overall)
 * and edits header/footer/rotation prefs. Sales data comes from the scheduled sync.
 */

interface AvailableGroup { toast_menu_guid: string; name: string; menu_name: string | null; }
interface ConfiguredGroup { id: string; toast_menu_guid: string; name: string; enabled: boolean; display_order: number; }
interface Config { header_text: string; footer_text: string; display_mode: string; auto_rotate_seconds: number; refresh_interval: number; }

const OVERALL = { toast_menu_guid: "MAIN_MENU_ALL", name: "Overall Top 5" };

export function DrinksAdmin() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  const available = useQuery({
    queryKey: ["drinks-admin", "available"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drinks_available_groups")
        .select("toast_menu_guid, name, menu_name").eq("venue_id", VENUE_ID).order("name");
      if (error) throw error;
      return (data ?? []) as AvailableGroup[];
    },
  });

  const configured = useQuery({
    queryKey: ["drinks-admin", "configured"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drinks_menu_groups")
        .select("id, toast_menu_guid, name, enabled, display_order").eq("venue_id", VENUE_ID).order("display_order");
      if (error) throw error;
      return (data ?? []) as ConfiguredGroup[];
    },
  });

  const config = useQuery({
    queryKey: ["drinks-admin", "config"],
    queryFn: async () => {
      const { data, error } = await supabase.from("drinks_display_config")
        .select("header_text, footer_text, display_mode, auto_rotate_seconds, refresh_interval")
        .eq("venue_id", VENUE_ID).maybeSingle();
      if (error) throw error;
      return (data as Config | null);
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["drinks-admin"] });

  const addGroup = useMutation({
    mutationFn: async (g: { toast_menu_guid: string; name: string }) => {
      const order = (configured.data ?? []).length;
      const { error } = await supabase.from("drinks_menu_groups").insert({
        venue_id: VENUE_ID, toast_menu_guid: g.toast_menu_guid, name: g.name, enabled: true, display_order: order,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => setMsg(e instanceof Error ? e.message : "add failed"),
  });

  const toggleGroup = useMutation({
    mutationFn: async (g: ConfiguredGroup) => {
      const { error } = await supabase.from("drinks_menu_groups").update({ enabled: !g.enabled }).eq("id", g.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const removeGroup = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("drinks_menu_groups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const move = useMutation({
    mutationFn: async ({ g, dir }: { g: ConfiguredGroup; dir: -1 | 1 }) => {
      const list = [...(configured.data ?? [])];
      const i = list.findIndex((x) => x.id === g.id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      // swap display_order
      const a = list[i], b = list[j];
      await supabase.from("drinks_menu_groups").update({ display_order: b.display_order }).eq("id", a.id);
      await supabase.from("drinks_menu_groups").update({ display_order: a.display_order }).eq("id", b.id);
    },
    onSuccess: invalidate,
  });

  const saveConfig = useMutation({
    mutationFn: async (c: Config) => {
      const { error } = await supabase.from("drinks_display_config")
        .upsert({ venue_id: VENUE_ID, ...c, updated_at: new Date().toISOString() }, { onConflict: "venue_id" });
      if (error) throw error;
    },
    onSuccess: () => { setMsg("Saved."); invalidate(); },
    onError: (e) => setMsg(e instanceof Error ? e.message : "save failed"),
  });

  const cfg = config.data ?? { header_text: "TODAY'S TOP DRINKS", footer_text: "■ ONLINE", display_mode: "rotate", auto_rotate_seconds: 10, refresh_interval: 60 };
  const configuredGuids = new Set((configured.data ?? []).map((g) => g.toast_menu_guid));
  const addable = [OVERALL, ...(available.data ?? [])].filter((g) => !configuredGuids.has(g.toast_menu_guid));

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 32px)", fontFamily: "'VT323','Share Tech Mono',monospace", color: "var(--terminal-green)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <h1 style={{ fontSize: "clamp(24px, 6vw, 40px)", fontWeight: 700, letterSpacing: 2 }}>TOP SELLERS BOARD — CONFIG</h1>
          <div style={{ display: "flex", gap: 12 }}>
            <Link to="/drinks" style={linkBtn}>OPEN BOARD</Link>
            <Link to="/dashboard" style={linkBtn}>DASHBOARD</Link>
          </div>
        </div>
        <p style={{ opacity: 0.6, fontSize: 18 }}>Toast credentials are server-side only — nothing sensitive is entered here. Sales refresh automatically from the scheduled sync.</p>
        <div className="terminal-separator" style={{ margin: "16px 0" }} />

        {/* Menu groups */}
        <h2 style={{ fontSize: 26 }}>ROTATION GROUPS</h2>
        {(configured.data ?? []).length === 0 && <p style={{ opacity: 0.6 }}>No groups yet — add one below. The board shows a group once the sync has sales for it.</p>}
        {(configured.data ?? []).map((g, i, arr) => (
          <div key={g.id} className="terminal-border" style={{ padding: "10px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 22, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name} {g.toast_menu_guid === "MAIN_MENU_ALL" ? "★" : ""}</span>
            <button style={btn} onClick={() => move.mutate({ g, dir: -1 })} disabled={i === 0}>▲</button>
            <button style={btn} onClick={() => move.mutate({ g, dir: 1 })} disabled={i === arr.length - 1}>▼</button>
            <button style={btn} onClick={() => toggleGroup.mutate(g)}>{g.enabled ? "● ON" : "○ OFF"}</button>
            <button style={btnDanger} onClick={() => removeGroup.mutate(g.id)}>REMOVE</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 18, opacity: 0.7 }}>ADD:</span>
          {addable.length === 0 && <span style={{ opacity: 0.5 }}>All discovered groups added. (Run the sync to discover more.)</span>}
          {addable.map((g) => (
            <button key={g.toast_menu_guid} style={btn} onClick={() => addGroup.mutate({ toast_menu_guid: g.toast_menu_guid, name: g.name })}>+ {g.name}</button>
          ))}
        </div>

        <div className="terminal-separator" style={{ margin: "24px 0" }} />

        {/* Display config */}
        <h2 style={{ fontSize: 26 }}>DISPLAY</h2>
        <ConfigForm initial={cfg} onSave={(c) => saveConfig.mutate(c)} busy={saveConfig.isPending} />
        {msg && <div style={{ marginTop: 12, fontSize: 20 }}>{msg}</div>}
      </div>
    </div>
  );
}

function ConfigForm({ initial, onSave, busy }: { initial: Config; onSave: (c: Config) => void; busy: boolean }) {
  const [c, setC] = useState<Config>(initial);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(c); }} style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 560 }}>
      <Field label="HEADER TEXT"><input style={input} value={c.header_text} onChange={(e) => setC({ ...c, header_text: e.target.value })} /></Field>
      <Field label="FOOTER TEXT"><input style={input} value={c.footer_text} onChange={(e) => setC({ ...c, footer_text: e.target.value })} /></Field>
      <Field label="MODE">
        <select style={input} value={c.display_mode} onChange={(e) => setC({ ...c, display_mode: e.target.value })}>
          <option value="rotate" style={{ background: "#000" }}>rotate</option>
          <option value="single" style={{ background: "#000" }}>single (first group)</option>
        </select>
      </Field>
      <Field label="ROTATE EVERY (SECONDS)"><input type="number" min={3} style={input} value={c.auto_rotate_seconds} onChange={(e) => setC({ ...c, auto_rotate_seconds: parseInt(e.target.value) || 10 })} /></Field>
      <Field label="SYNC CADENCE HINT (SECONDS)"><input type="number" min={30} style={input} value={c.refresh_interval} onChange={(e) => setC({ ...c, refresh_interval: parseInt(e.target.value) || 60 })} /></Field>
      <button type="submit" disabled={busy} style={btnPrimary}>{busy ? "SAVING…" : "SAVE DISPLAY CONFIG"}</button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 16, opacity: 0.7, letterSpacing: 1 }}>{label}</span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = { background: "#000", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "8px 10px", fontSize: 20, fontFamily: "'VT323','Share Tech Mono',monospace" };
const btn: React.CSSProperties = { background: "transparent", color: "var(--terminal-green)", border: "1px solid var(--terminal-green)", padding: "6px 12px", fontSize: 18, cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace" };
const btnDanger: React.CSSProperties = { ...btn, borderColor: "#ff4136", color: "#ff4136" };
const btnPrimary: React.CSSProperties = { background: "var(--terminal-green)", color: "#000", border: "1px solid var(--terminal-green)", padding: "10px 18px", fontSize: 22, fontWeight: 700, cursor: "pointer", fontFamily: "'VT323','Share Tech Mono',monospace" };
const linkBtn: React.CSSProperties = { ...btn, textDecoration: "none" };
