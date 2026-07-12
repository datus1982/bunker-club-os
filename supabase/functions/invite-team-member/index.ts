// invite-team-member — captain adds a teammate by email as a claimable invite (docs/07).
//
// A captain can't create auth users or arbitrary profiles from the client (RLS + no admin
// key), so this runs the same claimable-identity pattern as the legacy-contact import: verify
// the caller is the team's captain (their JWT), create-or-find an auth user for the email
// (email_confirm, NO password, no email sent), and insert team_members(member). When that
// person later signs in via email OTP, Supabase matches the existing user → they own the
// membership. verify_jwt:true; captain-only.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);

    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid or expired session" }, 401);

    const { team_id, email } = await req.json().catch(() => ({}));
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!team_id || !cleanEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
      return json({ error: "team_id and a valid email are required" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // AuthZ: caller must be a CAPTAIN of this team (staff also allowed as an escape hatch).
    const { data: cap } = await admin
      .from("team_members")
      .select("role")
      .eq("team_id", team_id)
      .eq("profile_id", caller.id)
      .maybeSingle();
    let allowed = cap?.role === "captain";
    if (!allowed) {
      const { data: team } = await admin.from("teams").select("venue_id").eq("id", team_id).maybeSingle();
      if (team) {
        const { data: staff } = await admin.from("venue_staff").select("role").eq("profile_id", caller.id).eq("venue_id", team.venue_id).maybeSingle();
        allowed = !!staff;
      }
    }
    if (!allowed) return json({ error: "Only the team captain can add members" }, 403);

    // Create-or-find the invitee's claimable auth user.
    let inviteeId: string | undefined;
    const { data: created } = await admin.auth.admin.createUser({ email: cleanEmail, email_confirm: true });
    if (created?.user) inviteeId = created.user.id;
    else {
      for (let p = 1; p <= 50 && !inviteeId; p++) {
        const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
        inviteeId = data.users.find((u) => u.email?.toLowerCase() === cleanEmail)?.id;
        if (data.users.length < 1000) break;
      }
    }
    if (!inviteeId) return json({ error: "Could not create the invite" }, 500);

    // Idempotent membership insert.
    const { error: insErr } = await admin
      .from("team_members")
      .upsert({ team_id, profile_id: inviteeId, role: "member", added_by: caller.id }, { onConflict: "team_id,profile_id" });
    if (insErr) return json({ error: insErr.message }, 500);

    return json({ invited: true, claimable: true }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}
