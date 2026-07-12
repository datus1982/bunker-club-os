import { useState } from "react";
import { Routes, Route, useNavigate, useParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/supabaseClient";
import { useSession } from "@/shared/useSession";
import {
  approveJoin, inviteMember, removeMember, setTeamPin, updateProfile,
  useMyTeams, useProfile, useTeamDetail, useTonight,
  type HistoryRow, type MyTeam, type SeasonSummary,
} from "./usePortal";
import "./portal.css";

/**
 * Player Portal (docs/07) — amber ambient base, GREEN = live. Two-tab bottom nav
 * (TEAMS / PROFILE); team detail drills in from a team card. Player-auth (same OTP
 * session as check-in), NOT staff-gated. Mobile-first. Built to portal-mockup.html.
 */
export function Portal() {
  const location = useLocation();
  const navigate = useNavigate();
  const onProfile = location.pathname.startsWith("/portal/profile");

  return (
    <div className="pt">
      <header className="pt-header">
        <span className="pt-brand">BUNKER CLUB</span>
        <span className="pt-sys">PATRON PORTAL<br />SHELTER AUTHORITY</span>
      </header>
      <div className="pt-screen">
        <Routes>
          <Route index element={<Home />} />
          <Route path="team/:id" element={<TeamDossier />} />
          <Route path="profile" element={<Profile />} />
        </Routes>
      </div>
      <nav className="pt-tabs">
        <button className={onProfile ? "" : "on"} onClick={() => navigate("/portal")}>TEAMS</button>
        <button className={onProfile ? "on" : ""} onClick={() => navigate("/portal/profile")}>PROFILE</button>
      </nav>
    </div>
  );
}

// ── Home ────────────────────────────────────────────────────────────────────────
function Home() {
  const navigate = useNavigate();
  const { session } = useSession();
  const uid = session?.user?.id;
  const teamsQ = useMyTeams(uid);
  const teams = teamsQ.data ?? [];
  const tonightQ = useTonight(uid, teams.map((t) => t.id));
  const tonight = tonightQ.data;

  const activeSeason = teams.find((t) => t.summary?.season_id)?.summary ?? null;

  return (
    <>
      <div className="pt-eyebrow">MY OUTFIT</div>
      <h1 className="pt-title">TEAMS</h1>
      <p className="pt-sub">{tonight ? <span className="pt-g">Game in progress — you're checked in.</span> : "Your teams and season standing."}</p>

      {tonight && (
        <div className="pt-live">
          <div className="hd">
            <span style={{ fontFamily: "'VT323',monospace", fontSize: 22 }}>{tonight.teamName.toUpperCase()}</span>
            <span className="pill">● LIVE{tonight.round ? ` — ${tonight.round}` : ""}</span>
          </div>
          <div className="score">{tonight.score} PTS</div>
          <div className="row">
            <span>CURRENT PLACE: {ordinal(tonight.place)}</span>
            <span>{tonight.gapToLead === 0 ? "IN THE LEAD" : `${tonight.gapToLead} PTS BEHIND LEAD`}</span>
          </div>
        </div>
      )}

      {teamsQ.isLoading && <p className="pt-sub">Loading your teams…</p>}
      {!teamsQ.isLoading && teams.length === 0 && (
        <div className="pt-card" style={{ cursor: "default" }}>
          <span className="nm">NO TEAMS YET</span>
          <div className="meta"><span>Check in to a game to start or join a team.</span></div>
        </div>
      )}

      {teams.map((t) => <TeamCard key={t.id} team={t} live={tonight?.teamId === t.id} onOpen={() => navigate(`/portal/team/${t.id}`)} />)}

      <button className="pt-btn ghost" onClick={() => navigate("/checkin")}>+ Start or join another team</button>

      {activeSeason?.season_name && (
        <>
          <hr className="pt-rule" />
          <p className="pt-note">Season: <b style={{ color: "var(--amb)" }}>{activeSeason.season_name}</b>
            {activeSeason.ends_on ? ` · ends ${activeSeason.ends_on}` : ""}
            {activeSeason.scoring_mode === "best_n" && activeSeason.best_n ? ` · best ${activeSeason.best_n} nights count` : ""}.
          </p>
        </>
      )}
    </>
  );
}

function TeamCard({ team, live, onOpen }: { team: MyTeam; live: boolean; onOpen: () => void }) {
  const s = team.summary;
  const rankLabel = s?.rank
    ? (live && s.points_behind_next && s.points_behind_next > 0
        ? `#${s.rank} → could hit #${s.rank - 1} tonight`
        : `#${s.rank}${s.season_name ? ` · ${s.season_name}` : ""}`)
    : (s?.season_name ? "no games yet this season" : "no active season");
  return (
    <button className="pt-card" onClick={onOpen}>
      <span className="nm">{team.name}</span>
      <span className="meta">
        <span>{team.members} member{team.members === 1 ? "" : "s"}</span>
        <span className={live ? "pt-g" : ""}>{rankLabel}</span>
        {team.currentStreak && team.currentStreak > 1 ? <span>{team.currentStreak}-week streak</span> : null}
      </span>
    </button>
  );
}

// ── Team dossier ──────────────────────────────────────────────────────────────
function TeamDossier() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { session } = useSession();
  const uid = session?.user?.id;
  const detailQ = useTeamDetail(id, uid);
  const d = detailQ.data;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["portal", "team", id] });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); refresh(); } catch (e) { setErr(e instanceof Error ? e.message : "Action failed"); } finally { setBusy(false); }
  };

  if (detailQ.isLoading || !d) return <p className="pt-sub">Loading dossier…</p>;
  const s = d.summary;

  return (
    <>
      <button className="pt-linkish" onClick={() => navigate("/portal")}>← my teams</button>
      <div className="pt-eyebrow" style={{ marginTop: 8 }}>TEAM DOSSIER</div>
      <h1 className="pt-title">{d.name}</h1>

      <div className="pt-stat-row">
        <div className="pt-stat"><div className="v">{s?.rank ? `#${s.rank}` : "—"}</div><div className="k">SEASON RANK</div></div>
        <div className="pt-stat"><div className="v">{s?.score != null ? Math.round(s.score) : "—"}</div><div className="k">PTS{s?.scoring_mode === "best_n" && s.best_n ? ` (BEST ${s.best_n})` : ""}</div></div>
        <div className="pt-stat"><div className="v">{s?.wins ?? 0}</div><div className="k">NIGHT WINS</div></div>
      </div>

      {d.currentStreak && d.currentStreak > 1 ? <span className="pt-streak">⚡ {d.currentStreak}-WEEK STREAK</span> : null}
      <p className="pt-note" style={{ marginTop: 8 }}>{strategicLine(s)}</p>

      <Sparkline history={d.history} />

      <hr className="pt-rule" />
      <div className="pt-eyebrow">ROSTER</div>
      {d.roster.map((m) => (
        <div className="pt-member" key={m.profile_id}>
          <span>{m.display_name || m.email || m.profile_id.slice(0, 8)}{m.role === "captain" ? <span className="pt-tag">CAPTAIN</span> : null}</span>
          {m.profile_id === uid ? <span className="pt-note">you</span>
            : d.isCaptain ? <button className="pt-linkish" disabled={busy} onClick={() => run(() => removeMember(id!, m.profile_id))}>remove</button>
            : null}
        </div>
      ))}
      {d.requests.map((r) => (
        <div className="pt-member" key={r.id}>
          <span>{r.display_name || `player ${r.profile_id.slice(0, 6)}`}<span className="pt-tag pend">WANTS TO JOIN</span></span>
          <button className="pt-linkish pt-g-dim" disabled={busy} onClick={() => run(() => approveJoin(r.id))}>approve</button>
        </div>
      ))}

      {d.isCaptain && <AddMember teamId={id!} onDone={refresh} />}
      {d.isCaptain && <PinRow teamId={id!} />}
      {err && <div className="pt-error">⚠ {err}</div>}

      <hr className="pt-rule" />
      <div className="pt-eyebrow">GAME HISTORY</div>
      {d.history.length === 0 ? <p className="pt-note">No games played yet.</p> : (
        <table className="pt-hist">
          <thead><tr><th>DATE</th><th>PTS</th><th>PLACE</th><th>COUNTS?</th></tr></thead>
          <tbody>
            {d.history.map((h) => (
              <tr key={h.game_id}>
                <td>{h.game_date}</td>
                <td>{Math.round(h.points)}</td>
                <td className="pl">{ordinal(h.place)}</td>
                <td className="pt-note">{h.counts_toward ? "✔ counts" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function AddMember({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setMsg(null);
    const r = await inviteMember(teamId, email);
    setBusy(false);
    if (r.ok) { setMsg(`Invited ${email} — they'll join when they sign in.`); setEmail(""); onDone(); }
    else setMsg(r.error ?? "Invite failed");
  };
  if (!open) return <button className="pt-btn ghost" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>+ Add member by email</button>;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="pt-field"><label>TEAMMATE'S EMAIL</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="them@wasteland.net" /></div>
      <button className="pt-btn primary" disabled={busy || !email} onClick={submit}>{busy ? "INVITING…" : "Send invite"}</button>
      {msg && <p className="pt-note">{msg}</p>}
    </div>
  );
}

function PinRow({ teamId }: { teamId: string }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (clear: boolean) => {
    try { await setTeamPin(teamId, clear ? null : pin); setMsg(clear ? "PIN removed." : "PIN set."); setPin(""); setOpen(false); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
  };
  return (
    <div className="pt-toggle-row">
      <span>Team PIN (join fallback){msg ? <span className="pt-note"> · {msg}</span> : null}</span>
      {open ? (
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="pt-field" style={{ width: 90, padding: 6, background: "#0a0602", border: "1px solid var(--amb-dim)", color: "var(--amb)" }} inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="4–6" />
          <button className="pt-linkish" onClick={() => save(false)}>save</button>
        </span>
      ) : <button className="pt-linkish" onClick={() => setOpen(true)}>set / reset PIN</button>}
    </div>
  );
}

function strategicLine(s: SeasonSummary | null): string {
  if (!s || !s.season_id) return "No active season right now.";
  if (s.rank == null) return "No counted games yet this season — play a night to get on the board.";
  const parts: string[] = [];
  if (s.scoring_mode === "best_n" && s.best_n) {
    parts.push(`Best ${s.best_n} nights count — ${s.games_counted}/${s.best_n} counting`);
    if ((s.games_played ?? 0) < s.best_n) parts.push(`${s.best_n - (s.games_played ?? 0)} more scores still add to your total`);
    else parts.push("a bigger night can still swap your lowest");
  }
  if (s.rank > 1 && s.points_behind_next && s.points_behind_next > 0) parts.push(`#${s.rank - 1} is ${Math.round(s.points_behind_next)} pts ahead`);
  else if (s.rank === 1) parts.push("you're leading the campaign");
  return parts.join(". ") + ".";
}

function Sparkline({ history }: { history: HistoryRow[] }) {
  const vals = [...history].reverse().map((h) => h.points); // oldest → newest
  if (vals.length < 2) return null;
  const min = Math.min(...vals) - 5, max = Math.max(...vals) + 5;
  const span = Math.max(1, max - min);
  const W = 350, H = 80, step = vals.length > 1 ? 310 / (vals.length - 1) : 0;
  const pt = (v: number, i: number) => `${20 + i * step},${70 - ((v - min) / span) * 60}`;
  return (
    <svg width="100%" height="80" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ margin: "10px 0 4px" }}>
      <polyline points={vals.map(pt).join(" ")} fill="none" stroke="var(--amb)" strokeWidth={2} />
      {vals.map((v, i) => <circle key={i} cx={20 + i * step} cy={70 - ((v - min) / span) * 60} r={3.5} fill={i === vals.length - 1 ? "var(--live)" : "var(--amb)"} />)}
    </svg>
  );
}

// ── Profile ───────────────────────────────────────────────────────────────────
function Profile() {
  const navigate = useNavigate();
  const { session } = useSession();
  const uid = session?.user?.id;
  const profQ = useProfile(uid);
  const p = profQ.data;
  const qc = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const displayName = name ?? p?.display_name ?? "";
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal", "profile"] });

  const saveName = async () => { if (!uid) return; await updateProfile(uid, { display_name: displayName }); setSaved(true); refresh(); };
  const toggleMarketing = async () => { if (!uid || !p) return; await updateProfile(uid, { marketing_opt_in: !p.marketing_opt_in }); refresh(); };
  const signOut = async () => { await supabase.auth.signOut(); navigate("/checkin"); };

  if (!p) return <p className="pt-sub">Loading…</p>;
  return (
    <>
      <div className="pt-eyebrow">DWELLER RECORD</div>
      <h1 className="pt-title">{(p.display_name || p.email?.split("@")[0] || "DWELLER").toUpperCase()}</h1>
      <p className="pt-sub">{p.created_at ? `Member since ${new Date(p.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}` : "Bunker Club member"}</p>

      <div className="pt-field"><label>DISPLAY NAME</label><input value={displayName} onChange={(e) => { setName(e.target.value); setSaved(false); }} onBlur={saveName} /></div>
      <div className="pt-field"><label>EMAIL</label><input value={p.email ?? ""} disabled style={{ opacity: 0.7 }} /></div>
      <div className="pt-field"><label>PHONE (FOR TEXT CODES — SOON)</label><input placeholder="+1 405 …" disabled style={{ opacity: 0.5 }} /></div>
      {saved && <p className="pt-note">Saved.</p>}

      <div className="pt-toggle-row">
        <span>Email me about trivia nights &amp; events<br /><span className="pt-note">Occasional. From the bar, not a robot farm.</span></span>
        <button className={`pt-sw ${p.marketing_opt_in ? "on" : ""}`} onClick={toggleMarketing} aria-label="marketing opt-in"><i /></button>
      </div>
      <div className="pt-toggle-row">
        <span>Sign out of this device</span>
        <button className="pt-linkish" onClick={signOut}>sign out</button>
      </div>
      <hr className="pt-rule" />
      <p className="pt-note">Your data: name, contact, team memberships, and game history. Nothing else. Ask the bar to delete it anytime.</p>
    </>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
