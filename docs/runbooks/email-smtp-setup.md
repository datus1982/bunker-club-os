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

---

## Themed email templates + cold-email staff invite (branch `phase-staff-invites`, 2026-07-14)

All five auth emails now carry the BUNKER UNIFIED OS look (near-black `#0d0f12`, amber
`#ffb000` headers, green `#33ff33` accents, monospace, in-world SHELTER AUTHORITY voice,
no external images/webfonts). Plus a new `invite-staff` edge fn lets an admin cold-invite
staff by email — it creates the account, grants role+modules, and emails a themed sign-in
link.

### What changed on the live project (`ysrqvdutayirpoibdlbf`) — NOT in git, re-apply on rebuild

| change | how | notes |
|---|---|---|
| Edge fn `invite-staff` deployed | Management API `POST /functions/deploy?slug=invite-staff` (multipart; bundles `invite-staff/index.ts` + `_shared/emailTheme.ts`) | `verify_jwt:true`; admin-only (explicit venue_staff admin check) |
| Secret `RESEND_API_KEY` set | Management API `POST /secrets` (value from root `.env`) | the fn sends the invite email via the Resend REST API |
| Auth email templates + subjects restyled | `pnpm apply:email-templates` (`scripts/apply-email-templates.ts`) reads `supabase/email-templates/*.html`, PATCHes `/config/auth` | idempotent; re-run any time to redeploy the templates |

Template + subject SOURCE OF TRUTH is now in git: `supabase/email-templates/*.html`
(bodies) and the `TEMPLATES` manifest in `scripts/apply-email-templates.ts` (subjects).
To change an email, edit the file/manifest and re-run `pnpm apply:email-templates`.

### Rollback record — the ORIGINAL templates + subjects (before this branch)

If you ever need to revert to the pre-themed emails, restore these via PATCH
`/config/auth` (the functional variables are unchanged — only styling differs, so a
revert is cosmetic):

**magic_link** — subject `{{ .Token }} is your Bunker Club check-in code`
```html
<h2>SHELTER AUTHORITY — ACCESS CODE</h2>
<p>Your Bunker Club trivia check-in code:</p>
<p style="font-size:28px;letter-spacing:6px;font-family:monospace"><b>{{ .Token }}</b></p>
<p>Enter it on the check-in terminal. It expires shortly and can only be used once. No passwords, ever.</p>
<p style="font-size:12px;color:#888">Didn't request this? You can ignore this email.</p>
```
**recovery** — subject `Reset your password`
```html
<h2>Reset your password</h2>
<p>We received a request to reset your password. Follow the link below to choose a new one.</p>
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>
```
**invite** — subject `You've been invited`
```html
<h2>You've been invited</h2>
<p>You've been invited to create an account. Follow the link below to accept.</p>
<p><a href="{{ .ConfirmationURL }}">Accept invitation</a></p>
```
**confirmation** — subject `Confirm your email address`
```html
<h2>Confirm your email address</h2>
<p>Follow the link below to confirm this email address and finish signing up.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>
```
**email_change** — subject `Confirm your new email address`
```html
<h2>Confirm your new email address</h2>
<p>Follow the link below to confirm {{ .NewEmail }} as your new email address.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm new email address</a></p>
<p>If you didn't request this change, you can safely ignore this email.</p>
```

### Load-bearing variables (never strip these when editing templates)
- `magic_link` MUST keep the visible `{{ .Token }}` — it's the 6-digit code staff type
  on the EMAIL CODE login and players type at `/checkin`. It's also in the subject.
- `recovery` / `invite` / `confirmation` keep `{{ .ConfirmationURL }}` (the link).
- `email_change` keeps `{{ .ConfirmationURL }}` and `{{ .NewEmail }}`.

### Note on `invite-team-member`
That edge fn sends NO email (it only creates a claimable auth user; the invitee gets in
via their own OTP later), so there was nothing to restyle there. If it ever grows an
email send, reuse `supabase/functions/_shared/emailTheme.ts`.
