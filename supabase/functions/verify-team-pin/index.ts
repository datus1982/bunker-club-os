// verify-team-pin — join a team by its PIN (docs/05, Registration v2).
//
// The PIN is a shared join secret a captain hands teammates. pin_hash is bcrypt and
// is locked out of every anon/authenticated SELECT (0011) — the plaintext compare and
// the membership insert happen ONLY here, via the service-role redeem_team_pin RPC.
// The PIN never travels to any client and pin_hash never leaves the database.
//
// AUTH: deploy with verify_jwt:true. A real user JWT is required (the anon key has no
//   `sub`, so auth.getUser() rejects it). The verified uid is the profile that gets
//   the membership — the client cannot spoof who joins.
// RATE LIMIT: 5 attempts / 15 min per (team_id, IP), logged in public.pin_attempts, so
//   the PIN can't be brute-forced. Both hits and misses count.
//
// Request:  POST { team_id: uuid, pin: string }
// Response: { joined: true } | { joined: false, reason } | { error } with 401/403/429/400.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    // ── AuthN: a valid, non-anon user JWT must be present ────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing bearer token" }, 401);
    }
    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) {
      return json({ error: "Invalid or expired session" }, 401);
    }

    // ── Input ────────────────────────────────────────────────────────────────
    const { team_id, pin } = await req.json().catch(() => ({}));
    if (!team_id || typeof team_id !== "string" || typeof pin !== "string") {
      return json({ error: "team_id and pin are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Rate limit: 5 attempts / 15 min per (team, IP) ───────────────────────
    // First IP in x-forwarded-for is the client (Supabase's edge sets it). Fall
    // back to a stable-ish placeholder so a missing header can't dodge the limit.
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const { count, error: countErr } = await admin
      .from("pin_attempts")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team_id)
      .eq("ip", ip)
      .gte("created_at", since);
    if (countErr) {
      return json({ error: "Rate-limit check failed" }, 500);
    }
    if ((count ?? 0) >= MAX_ATTEMPTS) {
      return json({ joined: false, reason: "too_many_attempts" }, 429);
    }

    // ── Verify + join (service-role RPC; bcrypt compare stays in the DB) ──────
    const { data: joined, error: rpcErr } = await admin.rpc("redeem_team_pin", {
      p_team_id: team_id,
      p_pin: pin,
      p_profile_id: user.id,
    });
    if (rpcErr) {
      return json({ error: "Verification failed" }, 500);
    }

    // Log the attempt (hit or miss) for the rate limiter.
    await admin.from("pin_attempts").insert({ team_id, ip, succeeded: joined === true });

    if (joined === true) {
      return json({ joined: true }, 200);
    }
    return json({ joined: false, reason: "invalid_pin" }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}
