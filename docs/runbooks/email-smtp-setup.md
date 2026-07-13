# Email / SMTP Setup — RESOLVED (was a production blocker)

*Status (2026-07-12, evening): **CONFIGURED and verified.** Custom SMTP via **Resend**
(domain `bunkerokc.com` verified — DKIM + SPF + MX on the `send` subdomain at Namecheap),
Supabase sender `no-reply@bunkerokc.com` / "Bunker Club", host `smtp.resend.com:465`,
`rate_limit_email_sent` raised to **100/hour**. Proven end-to-end: a real OTP email was
sent through Supabase → Resend → delivered to stephentyler@mac.com. The `RESEND_API_KEY`
lives in root `.env` (gitignored) and doubles as the SMTP password; the Resend domain id
is `76924dda-0c60-4191-aa3b-8fb436ea4e7a`. If the project is ever rebuilt, re-apply the
SMTP config per the steps below (the DNS records at Namecheap persist).*

*Everything below is kept as the original setup/reference procedure.*

## Why this matters now

Phase 4b made **email-OTP ("EMAIL CODE") the primary staff login**, and players
already use email-OTP at `/checkin`. Password reset (`/reset-password`) also emails.
**Every one of these draws on the same email quota.** On the built-in mailer that
quota is 2/hour and **cannot be raised** — the Management API refuses:

> `Custom SMTP required to configure RATE_LIMIT_EMAIL_SENT.`

So on a real trivia night, staff sign-ins + player check-ins will start bouncing off
"email rate limit exceeded" almost immediately. The built-in mailer is a demo tool,
not for production.

## Current auth-email config (project `ysrqvdutayirpoibdlbf`)

| setting | value |
|---|---|
| custom SMTP | **none** (built-in shared mailer) |
| `rate_limit_email_sent` | **2/hour** (frozen until custom SMTP is set) |
| `mailer_otp_length` | 6 |
| `mailer_otp_exp` | 3600s (1h) |
| Site URL | `https://os.bunkerokc.com` |
| redirect allow list | `https://os.bunkerokc.com/**` + `https://*.bunker-club-os.pages.dev/**` (previews, owner-approved 2026-07-12) |
| DNS registrar | Namecheap (holds `bunkerokc.com`) |

## The fix — configure custom SMTP (~10 min, one-time)

Recommended provider: **Resend** (easiest, generous free tier). Postmark / SendGrid /
AWS SES work identically — only the host/credentials differ.

1. **Create a provider account** and get SMTP credentials.
   - Resend: sign up → **Domains** → add `bunkerokc.com` → add the shown SPF + DKIM
     records at **Namecheap** (Advanced DNS) → wait for "Verified" → **API Keys** →
     create one (this key is the SMTP password). *(Or, to start fast, verify a single
     sender address instead of the whole domain.)*
   - SMTP values for Resend: host `smtp.resend.com`, port `465` (SSL) or `587` (TLS),
     username `resend`, password = the API key.
2. **Enable Custom SMTP in Supabase:** Dashboard → **Authentication → Emails → SMTP
   Settings** (a.k.a. Project Settings → Auth → SMTP) → toggle **Enable Custom SMTP** →
   fill:
   - Sender email: `no-reply@bunkerokc.com` (must be on the verified domain)
   - Sender name: `Bunker Club`
   - Host / Port / Username / Password: from step 1.
3. **Raise the send limit** now that custom SMTP unlocks it — Dashboard → Auth → Rate
   Limits → **Emails sent per hour** → e.g. `100`. (Or via Management API PATCH
   `/config/auth` `{"rate_limit_email_sent":100}` — this 400s until custom SMTP exists.)
4. **Verify:** on `os.bunkerokc.com/login` → EMAIL CODE → send a code to a real
   address → confirm it arrives and signs in. Then do a `/checkin` OTP as a player.

## Emergency admin unblock (no email, not rate-limited)

If email is jammed and an admin must get in *now*, mint a login artifact server-side
with the **service-role key** (`admin.generateLink` sends nothing and is not
rate-limited):

```js
// node, service-role client `a`
const { data } = await a.auth.admin.generateLink({
  type: "magiclink",
  email: "stephentyler@mac.com",
  options: { redirectTo: "https://os.bunkerokc.com/dashboard" },
});
data.properties.action_link;  // one-click login URL (single-use, ~1h)
data.properties.email_otp;     // ...or the 6-digit code for the EMAIL CODE tab
```

⚠ The **EMAIL CODE tab can't consume a pre-minted `email_otp`** — its code field only
appears *after* a successful SEND CODE (which emails a fresh, superseding code and is
rate-limited). So when email is down, use the **`action_link`** (one click), not the
6-digit code. Only hand these to the verified account owner for their own account.

## Related

- Auth URL config is already correct (Site URL + allow list) — see CLAUDE.md Phase 4b.
- Host-night runbook step 1 covers the normal EMAIL CODE / password sign-in.
