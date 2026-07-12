/**
 * seed-staff.ts — seed venue_staff rows (docs/10 Phase 0).
 *
 * venue_staff can't ship in a migration: it references profiles → auth.users,
 * which don't exist until Stephen (admin) and Ronnie (host) sign in once via
 * email OTP. Run this AFTER they've each signed in.
 *
 * Reads STAFF_ADMIN_EMAIL / STAFF_HOST_EMAIL from env, finds the auth user by
 * email, ensures the profile row, and upserts the venue_staff role.
 *
 * Run:  pnpm seed:staff
 */
import { newServiceClient, requireEnv, optionalEnv } from "./_shared";
import type { SupabaseClient, User } from "@supabase/supabase-js";

const VENUE_ID = requireEnv("VENUE_ID");

async function findUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  const target = email.toLowerCase();
  // supabase-js has no direct email lookup; paginate the admin user list.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) break;
  }
  return null;
}

async function seedOne(client: SupabaseClient, email: string, role: "admin" | "host" | "staff") {
  if (!email) return;
  let user = await findUserByEmail(client, email);
  if (!user) {
    // No login UI yet (Phase 2), so provision the auth user directly. email_confirm
    // avoids sending any email; the person just signs in via OTP later with the same
    // address and lands on this same user (and thus these roles).
    const { data, error } = await client.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw new Error(`createUser ${email}: ${error.message}`);
    user = data.user;
    console.log(`  + provisioned auth user ${email} (confirmed; no email sent)`);
  }
  // Ensure the profile exists (the trigger normally creates it).
  await client.from("profiles").upsert({ id: user.id, email: user.email }, { onConflict: "id" });
  const { error } = await client
    .from("venue_staff")
    .upsert({ venue_id: VENUE_ID, profile_id: user.id, role }, { onConflict: "venue_id,profile_id" });
  if (error) throw new Error(`venue_staff ${email}: ${error.message}`);
  console.log(`  ✓ ${role.padEnd(5)} ${email}`);
}

async function main() {
  console.log("\n▶ Seed venue_staff\n");
  const client = newServiceClient();
  await seedOne(client, optionalEnv("STAFF_ADMIN_EMAIL"), "admin");
  await seedOne(client, optionalEnv("STAFF_HOST_EMAIL"), "host");
  console.log("\n✓ Done. (Add more staff by extending this script or inserting venue_staff rows.)\n");
}

main().catch((err) => {
  console.error("\n✗ seed-staff failed:", err);
  process.exit(1);
});
