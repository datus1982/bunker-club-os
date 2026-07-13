import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, VENUE_ID } from "@/shared/supabaseClient";
import { TeamEditorDialog, type EditableTeam } from "./TeamEditorDialog";
import { Modal, btnGhost, btnPrimary, btnDanger } from "./ui";

/**
 * Team roster — host tool (docs/01 /teams, host+). Manages the venue's regular teams
 * using the SAME TeamEditorDialog the Scoring console uses (docs/04 ARCH-2 — no
 * duplicated team-edit UI). One-off walk-up teams are added inside a game (Scoring);
 * this page is the persistent regulars roster.
 *
 * DECISIONS: no contact/PIN columns in our schema (SEC-1 — Registration v2 owns player
 * data), so cards show name + logo only. "Delete" archives (teams.archived = true)
 * rather than hard-deleting, because scores/game_teams reference the row (legacy
 * hard-deleted; ours preserves history and satisfies the FKs).
 */

interface RegularTeam {
  id: string;
  name: string;
  is_regular: boolean;
  logo_url: string | null;
}

export function Teams() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditableTeam | null>(null);
  const [archiving, setArchiving] = useState<RegularTeam | null>(null);

  const teams = useQuery({
    queryKey: ["teams", "roster"],
    queryFn: async (): Promise<RegularTeam[]> => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, is_regular, logo_url")
        .eq("venue_id", VENUE_ID)
        .eq("is_regular", true)
        .eq("archived", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as RegularTeam[];
    },
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("teams").update({ archived: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["teams", "roster"] });
      setArchiving(null);
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["teams", "roster"] });
  const rows = teams.data ?? [];

  return (
    <div className="terminal-theme" style={{ minHeight: "100vh", padding: "clamp(16px, 4vw, 40px)", fontFamily: "'VT323','Share Tech Mono',monospace" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          <h1 style={{ fontSize: "clamp(28px, 7vw, 48px)", fontWeight: 700, letterSpacing: 2 }}>TEAM ROSTER</h1>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button type="button" onClick={() => setAdding(true)} style={btnPrimary}>+ ADD TEAM</button>
            <Link to="/dashboard" style={{ fontSize: 24, opacity: 0.8 }}>← DASHBOARD</Link>
          </div>
        </div>
        <div style={{ fontSize: 20, opacity: 0.6, marginBottom: 16 }}>Regular teams kept across weeks. Walk-ups are added inside a game.</div>
        <div className="terminal-separator" style={{ marginBottom: 24 }} />

        {teams.isPending ? (
          <p style={{ fontSize: 28, opacity: 0.7 }}>LOADING TEAMS…</p>
        ) : rows.length === 0 ? (
          <p style={{ fontSize: 28, opacity: 0.7 }}>NO REGULAR TEAMS YET.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {rows.map((t) => (
              <div key={t.id} className="terminal-border" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {t.logo_url ? (
                    <img src={t.logo_url} alt="" style={{ width: 48, height: 48, objectFit: "cover", border: "1px solid var(--terminal-green)" }} />
                  ) : (
                    <div style={{ width: 48, height: 48, border: "1px solid var(--terminal-green)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>★</div>
                  )}
                  <div style={{ fontSize: 28, fontWeight: 700 }}>{t.name}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => setEditing(t)} style={{ ...btnGhost, flex: 1 }}>✎ EDIT</button>
                  <button type="button" onClick={() => setArchiving(t)} style={btnDanger}>ARCHIVE</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && <TeamEditorDialog mode="add" onClose={() => setAdding(false)} onSaved={() => { refresh(); setAdding(false); }} />}
      {editing && <TeamEditorDialog mode="edit" initial={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />}

      {archiving && (
        <Modal
          title="ARCHIVE TEAM"
          onClose={() => setArchiving(null)}
          footer={
            <>
              <button type="button" onClick={() => setArchiving(null)} style={btnGhost}>CANCEL</button>
              <button type="button" onClick={() => archive.mutate(archiving.id)} style={btnDanger}>ARCHIVE</button>
            </>
          }
        >
          <p style={{ fontSize: 22 }}>Archive <strong>{archiving.name}</strong>? They'll be hidden from the roster but their game history is preserved.</p>
        </Modal>
      )}
    </div>
  );
}
