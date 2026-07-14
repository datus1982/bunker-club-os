/**
 * apply-email-templates.ts — push the themed auth email templates to Supabase.
 *
 * Reads the static HTML in supabase/email-templates/*.html and PATCHes the project's
 * auth config (mailer_templates_*_content + mailer_subjects_*) via the Management API.
 * These live in Supabase config, NOT in git-applied migrations, so re-run this if the
 * project is ever rebuilt (see docs/runbooks/email-smtp-setup.md for the rollback record).
 *
 * The template bodies keep every functional Go-template variable exactly as Supabase
 * injects it: magic_link's visible {{ .Token }} (primary staff login + player check-in),
 * recovery/invite/confirmation's {{ .ConfirmationURL }}, email_change's {{ .NewEmail }}.
 * Only the styling around those variables changes.
 *
 * Run:  pnpm apply:email-templates   (or: npx tsx scripts/apply-email-templates.ts)
 * Env:  SUPABASE_ACCESS_TOKEN (Management API PAT), optional SUPABASE_PROJECT_REF.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(HERE, "..", "supabase", "email-templates");

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF?.trim() || "ysrqvdutayirpoibdlbf";
if (!PAT) {
  console.error("\n✗ Missing SUPABASE_ACCESS_TOKEN (Management API PAT). See .env.\n");
  process.exit(1);
}

// key = Supabase template key; file = the HTML in email-templates/; subject carries the
// functional variable where the current config already does (magic_link's token).
const TEMPLATES: { key: string; file: string; subject: string }[] = [
  { key: "magic_link", file: "magic_link.html", subject: "BUNKER OS ACCESS CODE: {{ .Token }}" },
  { key: "recovery", file: "recovery.html", subject: "Reset your Bunker Club password" },
  { key: "invite", file: "invite.html", subject: "You're cleared for Bunker Club" },
  { key: "confirmation", file: "confirmation.html", subject: "Confirm your Bunker Club email" },
  { key: "email_change", file: "email_change.html", subject: "Confirm your new Bunker Club email" },
];

async function main() {
  const payload: Record<string, string> = {};
  for (const t of TEMPLATES) {
    const html = readFileSync(join(TEMPLATES_DIR, t.file), "utf8");
    payload[`mailer_templates_${t.key}_content`] = html;
    payload[`mailer_subjects_${t.key}`] = t.subject;
  }

  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`\n✗ PATCH failed (${res.status}): ${await res.text()}\n`);
    process.exit(1);
  }

  // Read back and confirm each template took (retry — the Management API edge
  // occasionally answers a rapid follow-up GET with a non-JSON interstitial).
  let after: Record<string, unknown> | undefined;
  for (let attempt = 1; attempt <= 3 && !after; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/config/auth`, {
      headers: { Authorization: `Bearer ${PAT}` },
    });
    const text = await r.text();
    try {
      after = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (attempt === 3) {
        console.error(`\n✗ Read-back did not return JSON (status ${r.status}). PATCH may still have applied — verify manually.\n`);
        process.exit(1);
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  after = after!;

  let ok = true;
  for (const t of TEMPLATES) {
    const gotBody = after[`mailer_templates_${t.key}_content`];
    const gotSubj = after[`mailer_subjects_${t.key}`];
    const bodyOk = typeof gotBody === "string" && gotBody.includes("BUNKER UNIFIED OS");
    const subjOk = gotSubj === t.subject;
    console.log(`${bodyOk && subjOk ? "✓" : "✗"} ${t.key.padEnd(14)} body:${bodyOk ? "ok" : "MISMATCH"} subject:${subjOk ? "ok" : "MISMATCH"}`);
    if (!bodyOk || !subjOk) ok = false;
  }
  // Spot-check the load-bearing variables survived.
  const ml = String(after["mailer_templates_magic_link_content"] ?? "");
  const rc = String(after["mailer_templates_recovery_content"] ?? "");
  const ec = String(after["mailer_templates_email_change_content"] ?? "");
  const varsOk =
    ml.includes("{{ .Token }}") && rc.includes("{{ .ConfirmationURL }}") &&
    ec.includes("{{ .NewEmail }}") && ec.includes("{{ .ConfirmationURL }}");
  console.log(`${varsOk ? "✓" : "✗"} functional variables preserved (Token / ConfirmationURL / NewEmail)`);

  if (!ok || !varsOk) {
    console.error("\n✗ Verification failed — check the config.\n");
    process.exit(1);
  }
  console.log(`\n✓ Applied ${TEMPLATES.length} themed templates to project ${REF}.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
