import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/shared/supabaseClient";
import { useSession } from "@/shared/useSession";
import {
  checkInTeam,
  createTeam,
  joinByPin,
  requestJoin,
  searchTeams,
  sendEmailOtp,
  useMyTeams,
  useTonightGame,
  verifyEmailOtp,
  type MyTeam,
  type TeamHit,
} from "./useCheckin";
import "./checkin.css";

/**
 * Patron check-in terminal (docs/05). State machine + copy + boot-line transitions
 * follow docs/checkin-flow-mockup.html (the validated UX reference). Replaces the old
 * /add-team route. Solo play-along (the amber path) is stubbed until Phase 11 (docs/11).
 */
type Screen =
  | "landing"
  | "identify"
  | "otp"
  | "returning"
  | "new_player"
  | "create_team"
  | "join_search"
  | "join_pin"
  | "confirm"
  | "done"
  | "no_game"
  | "solo_stub";

const DEFAULT_BOOT = ["> ACCESSING SHELTER AUTHORITY NETWORK…", "> AUTH RELAY: OK", "> LOADING MODULE"];

export function Checkin() {
  const [params] = useSearchParams();
  const { session } = useSession();
  const uid = session?.user?.id;
  const playerName = useMemo(() => {
    const meta = session?.user?.user_metadata as { display_name?: string; name?: string } | undefined;
    return (meta?.display_name || meta?.name || session?.user?.email?.split("@")[0] || "PATRON").toString();
  }, [session]);

  const tonight = useTonightGame();
  const teamsQuery = useMyTeams(uid, tonight.data?.id);

  const [screen, setScreen] = useState<Screen>("landing");
  const [boot, setBoot] = useState<{ target: Screen; lines: string[] } | null>(null);
  const [shown, setShown] = useState(0);

  // Form / selection state.
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ teamId: string; teamName: string } | null>(null);
  const [tableName, setTableName] = useState("");
  const [checkedInTeam, setCheckedInTeam] = useState<MyTeam | null>(null);

  const reduced = useMemo(
    () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  // Boot-line transition — the signature moment. Reveal lines, then swap the screen.
  const go = useCallback(
    (target: Screen, lines?: string[]) => {
      setError(null);
      if (reduced) {
        setScreen(target);
        return;
      }
      setShown(0);
      setBoot({ target, lines: lines ?? DEFAULT_BOOT });
    },
    [reduced],
  );

  useEffect(() => {
    if (!boot) return;
    if (shown < boot.lines.length) {
      const t = setTimeout(() => setShown((n) => n + 1), 130);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      setScreen(boot.target);
      setBoot(null);
    }, 180);
    return () => clearTimeout(t);
  }, [boot, shown]);

  // ── actions ─────────────────────────────────────────────────────────────────
  const startTeamCheckin = () => go(uid ? "returning" : "identify");

  const submitEmail = async () => {
    const value = email.trim();
    if (!value) return setError("Enter your email.");
    setBusy(true);
    setError(null);
    try {
      await sendEmailOtp(value);
      go("otp", ["> TRANSMITTING CODE…", "> CHECK YOUR INBOX"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send code.");
    } finally {
      setBusy(false);
    }
  };

  // Resend the 6-digit code without leaving the OTP screen. The Otp component owns
  // the cooldown; this just re-fires the send (iCloud is a known junker — see the hint).
  const resendOtp = useCallback(async () => {
    await sendEmailOtp(email.trim());
  }, [email]);

  const submitOtp = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        await verifyEmailOtp(email.trim(), code);
        // Branch on membership: any team → RETURNING, else NEW_PLAYER.
        const { data: user } = await supabase.auth.getUser();
        const newUid = user.user?.id;
        let hasTeam = false;
        if (newUid) {
          const { count } = await supabase
            .from("team_members")
            .select("id", { count: "exact", head: true })
            .eq("profile_id", newUid);
          hasTeam = (count ?? 0) > 0;
        }
        await teamsQuery.refetch();
        go(hasTeam ? "returning" : "new_player", [
          "> CODE ACCEPTED",
          `> IDENTITY: ${playerName.toUpperCase()}`,
          "> PULLING TEAM REGISTRY",
        ]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Invalid code.");
        setOtp(Array(6).fill(""));
      } finally {
        setBusy(false);
      }
    },
    [email, playerName, go, teamsQuery],
  );

  const pickTeam = (team: { id: string; name: string }) => {
    if (!tonight.data) return go("no_game");
    setSelected({ teamId: team.id, teamName: team.name });
    setTableName(team.name);
    go("confirm", ["> RESERVING SLOT…"]);
  };

  const confirmCheckin = async () => {
    if (!selected || !tonight.data) return go("no_game");
    setBusy(true);
    setError(null);
    try {
      await checkInTeam(tonight.data.id, selected.teamId, tableName);
      const refreshed = await teamsQuery.refetch();
      const t = (refreshed.data ?? []).find((x) => x.id === selected.teamId) ?? null;
      setCheckedInTeam(t);
      go("done", ["> WRITING TO LEDGER…", "> ZERO-FILL: COMPLETED ROUNDS", "> DONE"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check-in failed.");
    } finally {
      setBusy(false);
    }
  };

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="ck">
      <header className="ck-header">
        <span className="ck-brand">BUNKER CLUB</span>
        <span className="ck-sys">
          PATRON TERMINAL v2
          <br />
          SHELTER AUTHORITY CERTIFIED
        </span>
      </header>

      <div className="ck-screen">
        {screen === "landing" && <Landing onTeam={startTeamCheckin} onSolo={() => go("solo_stub", ["> GUEST PROTOCOL", "> LOADING"])} live={!!tonight.data} />}

        {screen === "identify" && (
          <Identify
            email={email}
            setEmail={setEmail}
            busy={busy}
            error={error}
            onSubmit={submitEmail}
          />
        )}

        {screen === "otp" && (
          <Otp email={email} otp={otp} setOtp={setOtp} busy={busy} error={error} onComplete={submitOtp} onResend={resendOtp} onBack={() => go("identify")} />
        )}

        {screen === "returning" && (
          <Returning
            name={playerName}
            game={tonight.data ?? null}
            loading={teamsQuery.isLoading}
            teams={teamsQuery.data ?? []}
            onPick={pickTeam}
            onOther={() => go("new_player")}
          />
        )}

        {screen === "new_player" && (
          <NewPlayer onStart={() => go("create_team")} onJoin={() => go("join_search")} onBack={() => go("returning")} />
        )}

        {screen === "create_team" && (
          <CreateTeam
            onCreated={(id, name) => pickTeam({ id, name })}
            onBack={() => go("new_player")}
          />
        )}

        {screen === "join_search" && (
          <JoinSearch onPin={(hit) => { setSelected({ teamId: hit.id, teamName: hit.name }); go("join_pin"); }} onRequest={requestJoin} onBack={() => go("new_player")} />
        )}

        {screen === "join_pin" && selected && (
          <JoinPin
            team={selected}
            onJoined={() => { teamsQuery.refetch(); pickTeam({ id: selected.teamId, name: selected.teamName }); }}
            onBack={() => go("join_search")}
          />
        )}

        {screen === "confirm" && selected && (
          <Confirm
            game={tonight.data ?? null}
            teamName={selected.teamName}
            setTableName={setTableName}
            playerName={playerName}
            busy={busy}
            error={error}
            onConfirm={confirmCheckin}
            onBack={() => go("returning")}
          />
        )}

        {screen === "done" && <Done team={checkedInTeam} teamName={selected?.teamName ?? "YOUR TEAM"} />}

        {screen === "no_game" && <NoGame onBack={() => go("landing")} />}

        {screen === "solo_stub" && <SoloStub onBack={() => go("landing")} />}
      </div>

      <footer className="ck-footer">
        <span>ATOMIC PUB TRIVIA — WEDNESDAYS</span>
        <span>{params.get("source") === "qr" ? "QR ENTRY" : "TERMINAL"}</span>
      </footer>

      {boot && (
        <div className="ck-boot">
          {boot.lines.slice(0, shown).map((ln, i) => (
            <div className="ln" key={i}>{ln}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── screens ─────────────────────────────────────────────────────────────────────

function Landing({ onTeam, onSolo, live }: { onTeam: () => void; onSolo: () => void; live: boolean }) {
  return (
    <>
      <div className="ck-eyebrow">SHELTER AUTHORITY — TAPROOM</div>
      <h1 className="ck-title ck-cursor">{live ? "TRIVIA NIGHT\nIS LIVE" : "PATRON\nTERMINAL"}</h1>
      <p className="ck-sub" style={{ whiteSpace: "pre-line" }}>
        {live ? "Game is open. Pick your path, patron." : "No game running right now — check in opens on trivia night."}
      </p>
      <button className="ck-btn big primary" onClick={onTeam}>
        CHECK IN MY TEAM
        <small>Play on paper with your crew. Any member can check the team in.</small>
      </button>
      <button className="ck-btn big amber" onClick={onSolo}>
        PLAY ALONG SOLO
        <small>At the bar? Answer on your phone, just for bragging rights.</small>
      </button>
      <hr className="ck-divider" />
      <p className="ck-note">Team check-in remembers this device — next week it's one tap.</p>
    </>
  );
}

function Identify({ email, setEmail, busy, error, onSubmit }: {
  email: string; setEmail: (v: string) => void; busy: boolean; error: string | null; onSubmit: () => void;
}) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <div className="ck-eyebrow">TEAM CHECK-IN — STEP 1 OF 2</div>
      <h1 className="ck-title">WHO GOES{"\n"}THERE?</h1>
      <p className="ck-sub">Enter your email. We'll send a 6-digit code — no passwords, ever.</p>
      <div className="ck-field">
        <label htmlFor="ck-email">EMAIL</label>
        <input id="ck-email" type="email" inputMode="email" autoFocus placeholder="you@wasteland.net"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <div className="ck-error">⚠ {error}</div>}
      <button className="ck-btn primary" type="submit" disabled={busy}>{busy ? "TRANSMITTING…" : "Send my code"}</button>
      <p className="ck-note">Prefer text message? SMS codes are coming soon.</p>
    </form>
  );
}

const RESEND_COOLDOWN = 40; // seconds — protects the email send-rate limit

function Otp({ email, otp, setOtp, busy, error, onComplete, onResend, onBack }: {
  email: string; otp: string[]; setOtp: (v: string[]) => void; busy: boolean; error: string | null;
  onComplete: (code: string) => void; onResend: () => Promise<void>; onBack: () => void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const submittedRef = useRef(false);

  // Resend cooldown: a code was just sent when we landed here, so start the timer
  // full. The button only re-enables at zero.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [resendErr, setResendErr] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    if (cooldown > 0 || resending || busy) return;
    setResending(true);
    setResendErr(null);
    setResent(false);
    try {
      await onResend();
      setResent(true);
      setOtp(Array(6).fill(""));
      submittedRef.current = false;
      setCooldown(RESEND_COOLDOWN);
      refs.current[0]?.focus();
    } catch (e) {
      setResendErr(e instanceof Error ? e.message : "Could not resend the code.");
    } finally {
      setResending(false);
    }
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, "").slice(-1);
    const next = [...otp];
    next[i] = d;
    setOtp(next);
    if (d && i < 5) refs.current[i + 1]?.focus();
    if (next.every((x) => x) && !submittedRef.current) {
      submittedRef.current = true;
      setTimeout(() => onComplete(next.join("")), 150);
    }
  };

  // Allow paste of a full 6-digit code into the first box.
  const onPaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6).split("");
    if (digits.length) {
      e.preventDefault();
      const next = Array(6).fill("").map((_, i) => digits[i] ?? "");
      setOtp(next);
      if (next.every((x) => x) && !submittedRef.current) {
        submittedRef.current = true;
        setTimeout(() => onComplete(next.join("")), 150);
      }
    }
  };

  useEffect(() => { if (!busy) submittedRef.current = false; }, [busy]);

  return (
    <>
      <div className="ck-eyebrow">TEAM CHECK-IN — STEP 2 OF 2</div>
      <h1 className="ck-title">ENTER{"\n"}ACCESS CODE</h1>
      <p className="ck-sub">Sent to <b style={{ color: "var(--phos)" }}>{email || "your inbox"}</b></p>
      <div className="ck-otp-row" onPaste={onPaste}>
        {otp.map((d, i) => (
          <input
            key={i}
            ref={(el) => { refs.current[i] = el; }}
            maxLength={1}
            inputMode="numeric"
            aria-label={`digit ${i + 1}`}
            autoFocus={i === 0}
            value={d}
            disabled={busy}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Backspace" && !otp[i] && i > 0) refs.current[i - 1]?.focus(); }}
          />
        ))}
      </div>
      {busy && <p className="ck-sub">VERIFYING…</p>}
      {error && <div className="ck-error">⚠ {error}</div>}
      {resent && <p className="ck-note" style={{ color: "var(--phos)" }}>✓ New code sent — check your inbox.</p>}
      {resendErr && <div className="ck-error">⚠ {resendErr}</div>}
      <div className="ck-resend">
        <button type="button" className="ck-linkish" onClick={resend} disabled={cooldown > 0 || resending || busy}>
          {resending ? "Sending…" : cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
        </button>
        <button type="button" className="ck-linkish" onClick={onBack}>Wrong email? Go back</button>
      </div>
      <p className="ck-note">Didn't get it? Check your spam/junk folder.</p>
    </>
  );
}

function Returning({ name, game, loading, teams, onPick, onOther }: {
  name: string; game: { game_date: string } | null; loading: boolean; teams: MyTeam[];
  onPick: (t: { id: string; name: string }) => void; onOther: () => void;
}) {
  return (
    <>
      <div className="ck-eyebrow">REGISTRY MATCH</div>
      <h1 className="ck-title">WELCOME BACK,{"\n"}{name.toUpperCase()}</h1>
      <p className="ck-sub">
        {game ? `Tonight: ${game.game_date} — game is open. Tap your team to check in.` : "No game running tonight. Your teams are below for next time."}
      </p>
      {loading && <p className="ck-sub">PULLING TEAM REGISTRY…</p>}
      {!loading && teams.length === 0 && <p className="ck-sub">No teams on file yet.</p>}
      {teams.map((t) => (
        <button key={t.id} className="ck-btn ck-team-row" onClick={() => onPick({ id: t.id, name: t.name })}>
          <span className="nm">{t.name}</span>
          <span className="meta">
            <span>{t.members} member{t.members === 1 ? "" : "s"}</span>
            {t.rank != null && <span className="ck-rankchip">#{t.rank} this season</span>}
            {t.lastPlayed && <span>last played {t.lastPlayed}</span>}
            {t.alreadyCheckedIn && <span className="ck-rankchip">✓ checked in</span>}
          </span>
        </button>
      ))}
      <button className="ck-linkish" onClick={onOther}>Start a different team or join one →</button>
    </>
  );
}

function NewPlayer({ onStart, onJoin, onBack }: { onStart: () => void; onJoin: () => void; onBack: () => void }) {
  return (
    <>
      <div className="ck-eyebrow">NEW RECRUIT</div>
      <h1 className="ck-title">NO TEAM{"\n"}ON FILE</h1>
      <p className="ck-sub">Two ways in:</p>
      <button className="ck-btn big" onClick={onStart}>
        START A NEW TEAM
        <small>Name it, you're the captain, done in one screen.</small>
      </button>
      <button className="ck-btn big" onClick={onJoin}>
        JOIN AN EXISTING TEAM
        <small>Ask a teammate to add you — or enter the team PIN.</small>
      </button>
      <button className="ck-linkish" onClick={onBack}>← Back</button>
    </>
  );
}

function CreateTeam({ onCreated, onBack }: { onCreated: (id: string, name: string) => void; onBack: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const value = name.trim();
    if (!value) return setError("Team name required.");
    setBusy(true);
    setError(null);
    try {
      const id = await createTeam(value);
      onCreated(id, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create team.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="ck-eyebrow">FOUND A TEAM</div>
      <h1 className="ck-title">NAME YOUR{"\n"}CREW</h1>
      <p className="ck-sub">You'll be the captain. You can set a join PIN later from your portal.</p>
      <div className="ck-field">
        <label htmlFor="ck-team">TEAM NAME</label>
        <input id="ck-team" autoFocus maxLength={40} placeholder="The Regulators" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {error && <div className="ck-error">⚠ {error}</div>}
      <button className="ck-btn primary" type="submit" disabled={busy}>{busy ? "FOUNDING…" : "Create & check in"}</button>
      <button className="ck-linkish" onClick={onBack}>← Back</button>
    </form>
  );
}

function JoinSearch({ onPin, onRequest, onBack }: {
  onPin: (hit: TeamHit) => void; onRequest: (teamId: string) => Promise<void>; onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TeamHit[]>([]);
  const [requested, setRequested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await searchTeams(q);
        if (!cancelled) setHits(r);
      } catch { /* ignore */ }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const request = async (hit: TeamHit) => {
    setError(null);
    try {
      await onRequest(hit.id);
      setRequested(hit.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send request.");
    }
  };

  if (requested) {
    return (
      <>
        <div className="ck-eyebrow">REQUEST SENT</div>
        <h1 className="ck-title">HANG TIGHT</h1>
        <p className="ck-sub">We asked <b style={{ color: "var(--phos)" }}>{requested}</b> to add you. A current member can approve it from their portal. Know the PIN? Use it for instant access.</p>
        <button className="ck-linkish" onClick={onBack}>← Back</button>
      </>
    );
  }

  return (
    <>
      <div className="ck-eyebrow">JOIN A TEAM</div>
      <h1 className="ck-title">FIND YOUR{"\n"}CREW</h1>
      <p className="ck-sub">Search by name, then join with the PIN or ask a member to approve you.</p>
      <div className="ck-field">
        <label htmlFor="ck-search">TEAM NAME</label>
        <input id="ck-search" autoFocus placeholder="Start typing…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <div className="ck-error">⚠ {error}</div>}
      {hits.map((h) => (
        <div key={h.id} className="ck-btn ck-team-row" style={{ cursor: "default" }}>
          <span className="nm">{h.name}</span>
          <span className="meta" style={{ marginTop: 8, gap: 10 }}>
            <button className="ck-linkish" style={{ color: "var(--phos)" }} onClick={() => onPin(h)}>Enter PIN →</button>
            <button className="ck-linkish" onClick={() => request(h)}>Ask to join</button>
          </span>
        </div>
      ))}
      {q.trim().length >= 2 && hits.length === 0 && <p className="ck-note">No teams match “{q}”.</p>}
      <button className="ck-linkish" onClick={onBack}>← Back</button>
    </>
  );
}

function JoinPin({ team, onJoined, onBack }: {
  team: { teamId: string; teamName: string }; onJoined: () => void; onBack: () => void;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!/^\d{4,6}$/.test(pin)) return setError("PIN is 4–6 digits.");
    setBusy(true);
    setError(null);
    const result = await joinByPin(team.teamId, pin);
    setBusy(false);
    if (result === "joined") return onJoined();
    if (result === "too_many_attempts") return setError("Too many tries. Wait 15 minutes and try again.");
    if (result === "invalid_pin") return setError("That PIN didn't match. Ask a teammate.");
    setError("Something went wrong. Try again.");
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="ck-eyebrow">JOIN — {team.teamName.toUpperCase()}</div>
      <h1 className="ck-title">TEAM PIN</h1>
      <p className="ck-sub">Any current member has it. 4–6 digits.</p>
      <div className="ck-field">
        <label htmlFor="ck-pin">PIN</label>
        <input id="ck-pin" autoFocus inputMode="numeric" maxLength={6} placeholder="••••" value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
      </div>
      {error && <div className="ck-error">⚠ {error}</div>}
      <button className="ck-btn primary" type="submit" disabled={busy}>{busy ? "VERIFYING…" : "Join team"}</button>
      <button className="ck-linkish" onClick={onBack}>← Back</button>
    </form>
  );
}

function Confirm({ game, teamName, setTableName, playerName, busy, error, onConfirm, onBack }: {
  game: { game_date: string } | null; teamName: string; setTableName: (v: string) => void;
  playerName: string; busy: boolean; error: string | null; onConfirm: () => void; onBack: () => void;
}) {
  return (
    <>
      <div className="ck-eyebrow">CONFIRM CHECK-IN</div>
      <h1 className="ck-title">LOCK IT IN?</h1>
      <div className="ck-ticket">
        <div className="ck-tk-head"><span>SHELTER ACCESS PASS</span><span>№ {game?.game_date?.replace(/-/g, "") ?? "----"}</span></div>
        <div className="ck-tk-team">{teamName}</div>
        <div className="ck-tk-line">GAME: <b>{game ? `${game.game_date} — Atomic Pub Trivia` : "—"}</b></div>
        <div className="ck-tk-line">CHECKED IN BY: <b>{playerName}</b></div>
        <div className="ck-tk-line">
          TABLE NAME (TONIGHT ONLY):{" "}
          <b
            className="ck-tk-edit"
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => setTableName((e.target as HTMLElement).textContent ?? "")}
          >
            {teamName}
          </b>{" "}
          <span style={{ fontSize: 13 }}>(tap to edit)</span>
        </div>
      </div>
      <p className="ck-note" style={{ marginBottom: 12 }}>Your team stays <b style={{ color: "var(--phos)" }}>{teamName}</b> — this is just what tonight's board shows.</p>
      {error && <div className="ck-error">⚠ {error}</div>}
      <button className="ck-btn primary" disabled={busy} onClick={onConfirm}>{busy ? "WRITING…" : "Check us in"}</button>
      <button className="ck-linkish" onClick={onBack}>← Back to my teams</button>
      <p className="ck-note">Joining late? Completed rounds score zero automatically — you're in from here forward.</p>
    </>
  );
}

function Done({ team, teamName }: { team: MyTeam | null; teamName: string }) {
  return (
    <>
      <div className="ck-eyebrow">CONFIRMED</div>
      <h1 className="ck-title">YOU'RE IN.{"\n"}GOOD LUCK.</h1>
      <div className="ck-ticket">
        <div className="ck-tk-head"><span>STATUS</span><span>ACTIVE</span></div>
        <div className="ck-tk-team">{team?.name ?? teamName}</div>
        {team?.rank != null && team.seasonName ? (
          <>
            <div className="ck-tk-line">SEASON RANK: <b className="ck-rankchip">#{team.rank} — {team.seasonName}</b></div>
            <div className="ck-tk-line">{team.rank > 1 ? <>A win tonight could move you to <b className="ck-rankchip">#{team.rank - 1}</b>.</> : "You're leading the campaign — defend it."}</div>
          </>
        ) : (
          <div className="ck-tk-line">Play tonight to climb the season board.</div>
        )}
      </div>
      <p className="ck-sub">Grab your answer sheets from the host stand. Phones down, glasses up.</p>
      <a className="ck-btn" href="/portal" style={{ textDecoration: "none" }}>View team portal →</a>
      <p className="ck-note">(Portal opens team history, members, and season standings.)</p>
    </>
  );
}

function NoGame({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="ck-eyebrow">STANDBY</div>
      <h1 className="ck-title">NO GAME{"\n"}RUNNING</h1>
      <p className="ck-sub">There's no trivia game open right now. Check-in opens when the host starts the night — see you Wednesday.</p>
      <button className="ck-linkish" onClick={onBack}>← Back</button>
    </>
  );
}

function SoloStub({ onBack }: { onBack: () => void }) {
  return (
    <>
      <div className="ck-eyebrow">LONE OPERATIVE MODE</div>
      <h1 className="ck-title">SOLO PLAY{"\n"}INCOMING</h1>
      <p className="ck-sub">Play-along-solo lets you answer on your phone for bragging rights. It's coming in a later drop — for now, grab a crew and check in as a team.</p>
      <button className="ck-btn primary" onClick={onBack}>← Back to check-in</button>
    </>
  );
}
