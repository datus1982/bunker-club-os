# Runbook — Public website DNS cutover (bunkerokc.com apex)

*Goal: point the public domain **bunkerokc.com** (and **www.bunkerokc.com**) at the new
Bunker Club OS marketing site (Cloudflare Pages project `bunker-club-os`), replacing the
old Toast-hosted single-page site — **without breaking email or the `os.` app subdomain.***

Status: NOT STARTED. This is a deliberate, owner-driven act — do it when you're ready to
retire the old site. The `os.bunkerokc.com` app subdomain is already live and is **not**
affected by anything here *unless* you move nameservers (Step 2, Option A) — that case is
called out explicitly.

> ⚠️ **The one rule that matters: do not touch the email (Resend) DNS records.** Staff and
> player logins are email one-time-codes. If the email records break, nobody can sign in.
> Every step below is built around protecting them. Read Step 1 before changing anything.

---

## Before you start — what exists today

| Thing | Where | Touch it? |
|---|---|---|
| `bunkerokc.com` (apex) | Points at the **old Toast** single-page site | ✅ this is what we're moving |
| `www.bunkerokc.com` | Old Toast site | ✅ moving too |
| `os.bunkerokc.com` | CNAME → `bunker-club-os.pages.dev` (the OS app) | ❌ leave working; recreate only if you move nameservers |
| Email records on the `send` subdomain (Resend: MX + SPF + DKIM) | Namecheap Advanced DNS | ❌ **NEVER delete or edit** |
| `bunkerclubokc.com` (old WordPress blog) | Founders' domain, SSL expired | ❌ not ours — see Step 7 |

Registrar / DNS host: **Namecheap** (holds `bunkerokc.com`). Email provider: **Resend**
(domain verified; records live on Namecheap). See `docs/runbooks/email-smtp-setup.md`.

---

## Step 1 — Inventory current DNS at Namecheap (do this first, change nothing)

1. Log in to Namecheap → **Domain List** → `bunkerokc.com` → **Manage** → **Advanced DNS**.
2. **Take a screenshot of every record** (or copy them into a note). You need a complete
   before-picture in case you have to roll back.
3. **Flag the records you must NOT touch.** These are the email + app records:
   - The **`os`** host record (CNAME → `bunker-club-os.pages.dev`) — the OS app.
   - Everything on the **`send`** subdomain — the Resend email records. Open the **Resend
     dashboard → Domains → bunkerokc.com** to see the authoritative list. They typically are:
     | Type | Host (name) | Value (typical shape — Resend is source of truth) |
     |---|---|---|
     | MX | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) |
     | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
     | TXT | `resend._domainkey` | long `p=…` DKIM key |
     | TXT | `_dmarc` (if present) | `v=DMARC1; …` |
   - Any other MX / TXT (SPF/DKIM/DMARC) records anywhere on the domain.
4. The records you WILL change are only the ones that currently send the **apex `@`** and
   **`www`** to the old Toast site (usually an ALIAS/URL-redirect on `@` and a CNAME on
   `www`, or A records pointing at Toast's IPs).

---

## Step 2 — Add the domains to Cloudflare Pages and point Namecheap at them

First, in Cloudflare: **Pages → `bunker-club-os` → Custom domains → Set up a custom domain**
→ add **`bunkerokc.com`**, then add **`www.bunkerokc.com`**. Cloudflare will tell you what
DNS record it wants for each. Then wire Namecheap to satisfy it. Pick ONE option:

### Option A — Move nameservers to Cloudflare (recommended; gives clean apex + www)

Cloudflare Pages can serve the **apex** directly (CNAME-flattening) only when Cloudflare is
your DNS. This is the tidiest end state, but it moves **all** DNS off Namecheap — so you
must re-create the email + `os` records in Cloudflare or email/app break.

1. In Cloudflare → **Add a site** → `bunkerokc.com` (Free plan) → Cloudflare scans and
   **imports** your existing Namecheap records. **Carefully verify every record imported**,
   especially the `send` email records, `_domainkey`, `_dmarc`, and `os` — re-create by hand
   any it missed. Do not proceed until the email + `os` records are present in Cloudflare
   exactly as they were on Namecheap.
2. Cloudflare gives you two nameservers. At **Namecheap → Domain → Nameservers** → choose
   **Custom DNS** → paste Cloudflare's two nameservers → save. (Propagation: up to a few hrs.)
3. Back in **Pages → Custom domains**, `bunkerokc.com` and `www` will validate automatically
   and issue SSL. Set `www` to redirect to the apex (or vice-versa) via a Cloudflare
   **Redirect Rule** if you want a single canonical host.

### Option B — Stay on Namecheap DNS (no nameserver move; email records never move)

Lowest-risk for email because you don't touch the email records at all — but Namecheap's
BasicDNS can't CNAME the apex, so the apex is handled by redirect.

1. **`www`**: Namecheap → Advanced DNS → add/replace a **CNAME** record: Host `www` →
   Value `bunker-club-os.pages.dev`. (Delete the old `www`→Toast record.)
2. **apex `@`**: if your Namecheap DNS plan offers an **ALIAS** record, add Host `@` →
   `bunker-club-os.pages.dev`. If ALIAS is not available, instead add a **URL Redirect
   Record**: Host `@` → `https://www.bunkerokc.com` (Permanent 301), and serve the site
   from `www`. Remove the old apex→Toast A/ALIAS record.
3. In **Pages → Custom domains**, add `www.bunkerokc.com` (and `bunkerokc.com` if ALIAS was
   used) and let Cloudflare validate + issue SSL.

Either way: leave the **`os`** and **`send`/email** records exactly as they are (Option B),
or re-create them exactly (Option A).

> The site's `apps/web/public/_redirects` already 301s the old site's real paths
> (`/home` → `/`, and the old blog post paths → `/about` / `/menu`). The Toast anchors
> (`#AboutUs`, `#OurProducts`, …) are client-side fragments that never reach the server and
> need no rule — `/` is the section they lived on.

---

## Step 3 — Parallel-verify the OLD site stays reachable during the move

Before and during propagation, confirm the old Toast site is still viewable via **Toast's
own direct/preview URL** (from the Toast dashboard) — not via `bunkerokc.com`. This is your
fallback: if the new site has a problem, you can revert the Namecheap records (Step 1's
screenshot) and the old site is still alive at its Toast URL. Do **not** cancel Toast hosting
yet (Step 6).

---

## Step 4 — Re-verify the email flow (critical)

DNS changes are the #1 way to accidentally break email. Right after cutover:

1. Go to `https://os.bunkerokc.com/login` → **EMAIL CODE** tab → send a code to a real
   inbox → confirm it **arrives and signs in**.
2. Do a `/checkin` email code as a player too.
3. If email fails: compare the live `send`/`_domainkey`/`_dmarc` records against the Resend
   dashboard and against your Step 1 screenshot; restore any that changed. Emergency admin
   access while you fix it: the `admin.generateLink` `action_link` path in
   `docs/runbooks/email-smtp-setup.md` (sends no email, not rate-limited).

---

## Step 5 — Update Google Business Profile (post-launch)

In the **Google Business Profile** for Bunker Club:
- **Website** link → `https://bunkerokc.com`
- **Menu** link → `https://bunkerokc.com/menu`

(Also worth updating: the link in the Instagram / Facebook / TikTok bios if they point at
the old site.)

---

## Step 6 — Cancel the old webhost only after 2 clean weeks

Watch the new site for **two full weeks** — including at least two Wednesday trivia nights
and a couple of Toast menu-sync cycles — with email verified working. Only then cancel the
old Toast website hosting. Canceling early removes your Step 3 fallback.

---

## Step 7 — bunkerclubokc.com (the founders' old blog) — archive, don't move

`bunkerclubokc.com` is the **McDermids' original WordPress site** (three 2021 blog posts;
richest founder-voice history — it's the source for the new `/about` copy). Its SSL is
expired and it is **NOT ours to move or cut over** — the domain is controlled by the founders.

Before it lapses entirely:
1. **Archive it** — submit each page to the Wayback Machine at
   `https://web.archive.org/save/http://www.bunkerclubokc.com/` (and the two post URLs) so the
   history is preserved.
2. Do **not** point it at this Pages project. The 301 rules for its blog paths in
   `_redirects` are dormant and only fire *if* it is ever pointed here — harmless either way.

---

## Rollback

Revert the Namecheap apex/`www` records to the values in your Step 1 screenshot. The old
Toast site returns within propagation time. Email and `os.` were never touched (Option B) or
are already re-created in Cloudflare (Option A), so neither is affected by the rollback.
