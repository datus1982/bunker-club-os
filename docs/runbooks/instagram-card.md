# Instagram rotation card — operations runbook

The `instagram` signage template shows the venue's recent @bunkerclubokc posts (and active
stories) as one rotation slide: a mirrored photo, the caption, `@handle` + relative time, and
a QR that opens the post. It feeds itself — a staff member just adds the card (slot, seconds,
how many recent posts, include-stories toggle) and the sync keeps it current.

## Pieces (as built — migration 0042)

- **Table `public.instagram_cache`** — the cache the TVs read (anon SELECT; writes are
  service-role only, no staff write policy). One row per media (`media_id` unique).
- **Edge fn `instagram-sync`** — CRON_SECRET-gated (verify_jwt off), scheduled by pg_cron
  **every 15 min** (`instagram-sync-15m`). Pulls `me/media` (12) + `me/stories`, mirrors each
  image into the `signage` bucket at `instagram/{venue}/{media_id}.jpg`, prunes expired
  stories + posts beyond the newest 24, and rotates the token (see below).
- **Template `instagram`** (`SignageTemplates.tsx` `InstagramCard`) + the INSTAGRAM tile in
  `ItemEditor.tsx` (post_count 1–10 default 5; include_stories default on). The item is a
  normal `signage_items` row — EDIT ROTATION shows it automatically.
- **Display hook** `useInstagram.ts` (`useInstagramFeed`) — anon reader, 60s poll.

## Config NOT in git (re-apply if the project is rebuilt)

- **Vault secret `instagram_token`** — the long-lived Instagram Graph API access token. The
  edge fn reads AND writes it via the SECURITY DEFINER RPCs `instagram_token_get()` /
  `instagram_token_set()` (service_role only; anon + authenticated are denied — the token is
  never exposable through PostgREST). DECISION: the token lives in Vault, not an edge-fn
  secret, because the refresh cron must write the rotated token back and a fn can't update
  its own secrets. Seed it (value from root `.env` `INSTAGRAM_ACCESS_TOKEN`, never committed):

  ```sql
  do $$
  declare v_id uuid;
  begin
    select id into v_id from vault.secrets where name='instagram_token' limit 1;
    if v_id is null then perform vault.create_secret('<TOKEN>', 'instagram_token');
    else perform vault.update_secret(v_id, '<TOKEN>'); end if;
  end $$;
  ```

- **Vault secret `cron_secret`** — already seeded for toast-sync; the instagram-sync cron
  command reads it by name (same value as the `CRON_SECRET` edge-fn secret).
- **Edge-fn secrets** — instagram-sync reuses the existing `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `VENUE_ID`. No new edge-fn secret is needed
  (the Instagram token is in Vault, not here).
- **pg_cron job `instagram-sync-15m`** — created by migration 0042's `do` block (Vault-read
  pattern). If pg_cron/pg_net weren't ready at apply time, re-run that block.

## Token lifecycle

The token is a 60-day long-lived Instagram Login token. The sync refreshes it once it is
≥30 days old (via `GET /refresh_access_token?grant_type=ig_refresh_token`) and writes the
fresh 60-day token back to Vault, stamping `venue_settings.instagram_token_refreshed_at`
(status only — never the token). A "token too new to refresh" (<24h) response is tolerated.

> Note (as-built): on the very FIRST run after a fresh seed, `instagram_token_refreshed_at`
> is absent, so the sync attempts a refresh immediately. If the seeded token is already ≥24h
> old, it rotates cleanly to a fresh 60-day window (this is what happened at build time —
> `refreshed:true` on run 1). Harmless either way; it self-corrects.

### Re-authorization if the token ever fully lapses (>60 days idle)

A token can only be refreshed while still valid. If it lapses, the sync writes
`venue_settings.instagram_sync_status = {ok:false, error:"auth: …"}` and shows nothing new.
Recovery is owner-driven:

1. Owner regenerates a long-lived token on the Meta / Instagram API setup page (Graph API
   Explorer → generate → exchange for long-lived, per the one-time checklist).
2. Paste it into root `.env` as `INSTAGRAM_ACCESS_TOKEN`.
3. Re-run the Vault seed statement above (with the new token).
4. Invoke the fn once to confirm (see below); status flips back to `ok:true`.

## Manual invoke / health check

```
POST https://ysrqvdutayirpoibdlbf.supabase.co/functions/v1/instagram-sync
  header x-cron-secret: <CRON_SECRET>
  body   {}
```

Returns `{ ok, postsUpserted, storiesUpserted, activeStories, refreshed }`. Health is also in
`venue_settings.instagram_sync_status` = `{ok, at, posts, stories, refreshed}` (or `{ok:false,
error}` on any auth/media failure — status only, never the token).

## Notes / accepted for the reviewer

- CAROUSEL_ALBUM: only the parent image is mirrored (children skipped in v1). VIDEO uses the
  thumbnail. IMAGE uses media_url.
- Stories are pruned when `expires_at` passes (≤24h after posting); a story pulled early stays
  until its expiry prune. Acceptable for v1.
- One post per rotation pass, chosen by a stable time bucket keyed off the item's dwell
  (`duration_seconds`) — consecutive passes show consecutive posts, and a preview at the same
  minute matches the TV. No internal sub-rotation, no infinite animation (display rules).
