/**
 * import-legacy-contacts.ts — map legacy team captains into claimable identities
 * (docs/03 + docs/05, Phase 2).
 *
 * Phase 0's import kept 23 team contacts out of the schema (docs/02 is greenfield —
 * no teams.contact_* columns) and parked them in legacy-export/unmapped-contacts.json.
 * Registration v2 finally has a home for them: each contact with an email becomes an
 * "invited/claimable" identity —
 *   1. an auth user (email_confirm=true, NO password, no email sent),
 *   2. its profile row (auto-created by the on_auth_user_created trigger),
 *   3. a team_members(captain) row on their legacy team.
 * When the real person later signs in via email OTP, Supabase matches the existing
 * user by email → same uid → they instantly own their profile + captaincy. Nothing
 * to claim manually; the first OTP login IS the claim.
 *
 * Idempotent: re-running reuses existing users and skips existing memberships.
 * Contacts without an email can't be made claimable (no OTP identity) and are logged.
 *
 * Service role (bypasses RLS). Pre-cutover only. Run: pnpm import:contacts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newServiceClient, requireEnv } from "./_shared";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const VENUE_ID = requireEnv("VENUE_ID");
const CONTACTS_PATH = resolve(process.cwd(), "legacy-export/unmapped-contacts.json");

interface Contact {
  team_id: string;
  team_name: string;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  notes: string | null;
}

async function findUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function ensureUser(client: SupabaseClient, email: string, displayName: string): Promise<User> {
  const { data, error } = await client.auth.admin.createUser({
    email,
    email_confirm: true, // no confirmation email; identity is claimable via OTP later
    user_metadata: { display_name: displayName },
  });
  if (!error && data.user) return data.user;
  // Already registered → reuse the existing user.
  const existing = await findUserByEmail(client, email);
  if (existing) return existing;
  throw new Error(`createUser(${email}): ${error?.message ?? "unknown"}`);
}

async function main() {
  const client = newServiceClient();
  const contacts: Contact[] = JSON.parse(readFileSync(CONTACTS_PATH, "utf8"));
  console.log(`Loaded ${contacts.length} legacy contacts from ${CONTACTS_PATH}\n`);

  // Live team ids (skip contacts whose team was archived/removed since export).
  const { data: teams, error: tErr } = await client.from("teams").select("id");
  if (tErr) throw new Error(`load teams: ${tErr.message}`);
  const liveTeams = new Set((teams ?? []).map((t) => t.id as string));

  let mapped = 0;
  let membershipsAdded = 0;
  const skipped: string[] = [];

  for (const c of contacts) {
    const displayName = [c.contact_first_name, c.contact_last_name].filter(Boolean).join(" ").trim() || c.team_name.trim();
    const email = c.contact_email?.trim();

    if (!email) { skipped.push(`${c.team_name} (no email)`); continue; }
    if (!liveTeams.has(c.team_id)) { skipped.push(`${c.team_name} (team not in live registry)`); continue; }

    const user = await ensureUser(client, email, displayName);

    // Keep the profile display_name/email fresh (trigger seeds it, but re-runs & older
    // rows may lack it).
    await client.from("profiles").update({ display_name: displayName, email }).eq("id", user.id);

    // Captain membership (idempotent via the unique(team_id, profile_id) constraint).
    const { data: existing } = await client
      .from("team_members")
      .select("id")
      .eq("team_id", c.team_id)
      .eq("profile_id", user.id)
      .maybeSingle();
    if (!existing) {
      const { error: insErr } = await client
        .from("team_members")
        .insert({ team_id: c.team_id, profile_id: user.id, role: "captain", added_by: user.id });
      if (insErr) throw new Error(`team_members insert (${c.team_name}): ${insErr.message}`);
      membershipsAdded++;
    }
    mapped++;
    console.log(`✓ ${displayName} <${email}> → captain of "${c.team_name.trim()}"`);
  }

  console.log(`\n── Summary ─────────────────────────────`);
  console.log(`Contacts mapped:       ${mapped}/${contacts.length}`);
  console.log(`New captain rows:      ${membershipsAdded}`);
  console.log(`Skipped:               ${skipped.length}`);
  for (const s of skipped) console.log(`   · ${s}`);
  console.log(`\nMapped captains are claimable — the person owns the team on their first email OTP login.`);
}

main().catch((e) => { console.error("\n✗", e.message); process.exit(1); });
