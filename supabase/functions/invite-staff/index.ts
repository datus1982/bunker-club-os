// invite-staff — an admin cold-invites new staff by email (the parked "cold-email
// staff invite", CLAUDE.md). Adds them to venue_staff with a role title + module
// grants and emails a themed one-click sign-in link.
//
// DECISION: DIRECT-CREATE model, no staff_invites table, no migration. Unlike a
// claimable-invite table, this creates the auth user immediately (email_confirm:true —
// the on_auth_user_created trigger makes the profile, satisfying venue_staff.profile_id
// FK), upserts the venue_staff grant, and emails a magic link. The invitee appears in
// USERS right away; "never signed in" is visible via last_sign_in_at. This mirrors the
// existing admin_upsert_staff model (which required a prior sign-in) but removes that
// prerequisite, and is simpler than a second claim/redeem flow.
//
// AuthZ: verify_jwt:true (Supabase checks the JWT is valid) PLUS an explicit check that
// the caller is a venue ADMIN for VENUE_ID. Modeled on invite-team-member's JWT handling.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderEmail } from "../_shared/emailTheme.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VENUE_ID = Deno.env.get("VENUE_ID")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const FROM = "Bunker Club <no-reply@bunkerokc.com>";
const REDIRECT_TO = "https://os.bunkerokc.com/dashboard";
const KNOWN_MODULES = ["trivia", "seasons", "drinks", "signage", "website", "events"];
const ROLE_TITLES = ["staff", "host"]; // never mint an admin via invite

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Status = "invited" | "already-staff" | "already-admin" | "error";
interface Result { email: string; status: Status; detail?: string }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing bearer token" }, 401);

    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await authed.auth.getUser();
    const caller = userData?.user;
    if (userErr || !caller) return json({ error: "Invalid or expired session" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // AuthZ: caller must be a venue ADMIN for this venue.
    const { data: callerStaff } = await admin
      .from("venue_staff")
      .select("role")
      .eq("venue_id", VENUE_ID)
      .eq("profile_id", caller.id)
      .maybeSingle();
    if (callerStaff?.role !== "admin") return json({ error: "Admins only" }, 403);

    // Validate body.
    const body = await req.json().catch(() => ({}));
    const role = body?.role;
    const modules = body?.modules;
    const rawEmails = body?.emails;
    if (!ROLE_TITLES.includes(role)) return json({ error: "role must be 'staff' or 'host'" }, 400);
    if (!Array.isArray(modules) || modules.some((m) => !KNOWN_MODULES.includes(m))) {
      return json({ error: "modules must be a subset of the known module keys" }, 400);
    }
    const cleanModules = [...new Set(modules as string[])];
    if (!Array.isArray(rawEmails) || rawEmails.length === 0) return json({ error: "emails must be a non-empty array" }, 400);
    if (rawEmails.length > 20) return json({ error: "Max 20 emails per call" }, 400);

    const emails = [...new Set(
      rawEmails
        .filter((e) => typeof e === "string")
        .map((e) => (e as string).trim().toLowerCase())
        .filter((e) => e.length > 0),
    )];

    const results: Result[] = [];
    for (const email of emails) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        results.push({ email, status: "error", detail: "invalid email format" });
        continue;
      }
      try {
        results.push(await inviteOne(admin, email, role, cleanModules));
      } catch (e) {
        results.push({ email, status: "error", detail: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ results }, 200);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

async function inviteOne(
  admin: ReturnType<typeof createClient>,
  email: string,
  role: string,
  modules: string[],
): Promise<Result> {
  // Create-or-find the auth user. email_confirm so the profile trigger fires and no
  // separate confirmation email is sent (we send our own themed magic link).
  let userId: string | undefined;
  const { data: created } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created?.user) userId = created.user.id;
  else {
    for (let p = 1; p <= 50 && !userId; p++) {
      const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (data.users.length < 1000) break;
    }
  }
  if (!userId) return { email, status: "error", detail: "could not create or find the account" };

  // Never downgrade an existing admin. Report their status but still send the sign-in link.
  const { data: existing } = await admin
    .from("venue_staff")
    .select("role")
    .eq("venue_id", VENUE_ID)
    .eq("profile_id", userId)
    .maybeSingle();

  let status: Status;
  if (existing?.role === "admin") {
    status = "already-admin";
  } else {
    const alreadyStaff = !!existing;
    // Matches venue_staff (0003) + admin_upsert_staff (0025): (venue_id, profile_id, role, modules).
    const { error: upErr } = await admin
      .from("venue_staff")
      .upsert({ venue_id: VENUE_ID, profile_id: userId, role, modules }, { onConflict: "venue_id,profile_id" });
    if (upErr) return { email, status: "error", detail: upErr.message };
    status = alreadyStaff ? "already-staff" : "invited";
  }

  // Mint a one-click sign-in link (sends nothing itself) and email it via Resend.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: REDIRECT_TO },
  });
  const actionLink = link?.properties?.action_link;
  if (linkErr || !actionLink) return { email, status: "error", detail: "granted, but could not mint the sign-in link" };

  await sendInviteEmail(email, actionLink);
  return { email, status };
}

async function sendInviteEmail(email: string, actionLink: string): Promise<void> {
  const html = renderEmail({
    heading: "STAFF ACCESS GRANTED",
    intro: [
      "You've been cleared for the Bunker Club operations console.",
      "Tap the button below to sign in. No password — the link signs you in directly.",
    ],
    button: { label: "ENTER THE BUNKER →", url: actionLink },
    fallbackUrl: actionLink,
    footerNote: "Wasn't expecting access? You can safely ignore this — the link does nothing until used.",
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: "BUNKER OS — your staff access is live",
      html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`email send failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}
