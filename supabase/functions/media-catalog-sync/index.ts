// media-catalog-sync — media PC folder catalog → media_files / media_playlists (docs/15, M1).
//
// The media PC (Electron shell, apps/media-shell/) watches a local folder, probes each file's
// duration/dimensions, generates a thumbnail, and POSTs the whole catalog here. This fn is the
// ONLY authenticated actor for the device: it upserts media_files, maintains folder
// auto-playlists, mirrors thumbnails into the `signage` bucket, and marks vanished files
// `status='missing'` (NEVER deletes rows). The web app is a pure realtime READER of these
// tables (TVs read anon) — a public screen never triggers this fn.
//
// Auth model (docs/15): NO auth user on the device — the web page stays anon like every TV;
// only this catalog sync authenticates, via a DEVICE TOKEN (secret MEDIA_DEVICE_TOKEN) in the
// x-device-token header. verify_jwt is off; the token is the gate. Same shape as the
// CRON_SECRET-gated sync fns (toast-sync / instagram-sync), just a different secret because a
// physical device — not pg_cron — is the caller.
//
// Service role for all writes: media_files/playlists RLS gates writes on has_module('signage')
// for a real user; this device has no user, so it uses the service role (bypasses RLS) after
// the device-token gate has authenticated it. Thumbnails are uploaded with the service role too
// (bypasses storage RLS) into the PUBLIC `signage` bucket at media-thumbs/{venue}/{hash}.jpg.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEVICE_TOKEN = Deno.env.get("MEDIA_DEVICE_TOKEN") ?? "";
const VENUE_ID = Deno.env.get("VENUE_ID") ?? "11111111-1111-1111-1111-111111111111";
const BUCKET = "signage";
// A generated jpeg thumbnail is small; guard against a device sending something huge that
// isn't really a thumbnail. Reject oversized thumb_b64 (decoded) rather than storing it.
const MAX_THUMB_BYTES = 200 * 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Admin = ReturnType<typeof createClient>;

interface InFile {
  filename: string; // path relative to the watched folder
  hash: string; // content hash — the (venue_id, hash) key and playback URL key
  duration_seconds?: number;
  width?: number;
  height?: number;
  size_bytes?: number;
  status?: string; // 'present' | 'missing' | 'unsupported' (default present)
  thumb_b64?: string; // jpeg, optionally data-URI prefixed; ≤200KB decoded
}
interface InFolder {
  path: string; // subfolder path (relative) — the media_playlists.folder_path key
  name: string; // display name (folder name)
  hashes: string[]; // ordered file hashes belonging to this folder
}

const VALID_STATUS = new Set(["present", "missing", "unsupported"]);

// PostgREST caps an unranged select at 1000 rows (max-rows) even for the service role. Past 1000
// media files a single select silently truncates → the `existing`/`idByHash` maps go incomplete
// (hub-edited titles get clobbered, folder membership silently dropped, the missing diff runs over
// a truncated set). Page every catalog read in fixed windows until a short page. Keep at 1000 in
// committed code (the loop is testable at a smaller size; see the branch's pagination proof).
const PAGE_SIZE = 1000;
// A thousands-long `.in("hash", [...])` blows the URL length limit; update vanished rows in chunks.
const MISSING_CHUNK = 200;

/**
 * Aggregate every row of a paginated select. `run(from, to)` must issue a `.range(from, to)` query
 * (inclusive window). Terminates on the first short page — including the empty page after an
 * exact-multiple total — so it always halts. Throws on any page error.
 */
async function selectAllPaged<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

// Default title from a relative filename: basename without extension. "Ambience/clip1.mp4" → "clip1".
function defaultTitle(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// Decode base64 (tolerating a data-URI prefix) to bytes. Returns null if it doesn't decode.
function b64ToBytes(b64: string): Uint8Array | null {
  try {
    const comma = b64.indexOf(",");
    const raw = b64.startsWith("data:") && comma >= 0 ? b64.slice(comma + 1) : b64;
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // ── Device-token gate ──────────────────────────────────────────────────────
  if (!DEVICE_TOKEN || (req.headers.get("x-device-token") ?? "") !== DEVICE_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: { files?: InFile[]; folders?: InFolder[] };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const rawFiles = Array.isArray(payload.files) ? payload.files.filter((f) => f && typeof f.hash === "string" && f.hash.length > 0) : [];
  // Defensive dedupe by hash (first wins). Two identical files at different paths arrive as two
  // rows with the same hash; a single upsert with onConflict then hits Postgres "ON CONFLICT
  // cannot affect row a second time" → the whole POST 500s forever. The shell dedupes too, but the
  // fn must not trust that. Folder `hashes` arrays may still reference the hash — the row exists.
  const files: InFile[] = [];
  const seenFileHash = new Set<string>();
  for (const f of rawFiles) {
    if (seenFileHash.has(f.hash)) continue;
    seenFileHash.add(f.hash);
    files.push(f);
  }
  const folders = Array.isArray(payload.folders) ? payload.folders.filter((f) => f && typeof f.path === "string") : [];

  const admin: Admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const summary = {
    ok: true,
    files_seen: files.length,
    files_upserted: 0,
    files_new: 0,
    marked_missing: 0,
    thumbs_uploaded: 0,
    folders_seen: folders.length,
    playlists_synced: 0,
    items_written: 0,
    // WARN-2: hashes whose thumbnail is ACTUALLY stored after this request (uploaded this pass OR
    // the row already had a thumb_path). The shell suppresses re-sends ONLY from this array — a
    // 2xx alone doesn't mean each thumbnail landed, since an individual upload can fail and the
    // request still 200s.
    acknowledged: [] as string[],
  };

  // ── Existing rows (to preserve hub-edited titles + prior thumb_path, and to diff missing) ──
  type ExistingRow = { hash: string; title: string | null; thumb_path: string | null };
  let existingRows: ExistingRow[];
  try {
    existingRows = await selectAllPaged<ExistingRow>((from, to) =>
      admin.from("media_files").select("hash, title, thumb_path").eq("venue_id", VENUE_ID).order("hash").range(from, to)
    );
  } catch (e) {
    return json({ error: "read existing failed", detail: String((e as Error).message ?? e) }, 500);
  }
  const existing = new Map<string, { title: string | null; thumb_path: string | null }>();
  for (const r of existingRows) existing.set(r.hash, { title: r.title, thumb_path: r.thumb_path });

  // ── Thumbnails: upload first so thumb_path can go into the upsert ────────────
  // thumb_path is deterministic (media-thumbs/{venue}/{hash}.jpg); we only (re)upload when a
  // thumb_b64 is supplied this run, otherwise we preserve any prior thumb_path.
  const thumbPathByHash = new Map<string, string | null>();
  for (const f of files) {
    const prior = existing.get(f.hash)?.thumb_path ?? null;
    if (!f.thumb_b64) {
      thumbPathByHash.set(f.hash, prior);
      continue;
    }
    const bytes = b64ToBytes(f.thumb_b64);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_THUMB_BYTES) {
      // Bad/oversized thumb — keep any prior path, don't store this one.
      thumbPathByHash.set(f.hash, prior);
      continue;
    }
    const path = `media-thumbs/${VENUE_ID}/${f.hash}.jpg`;
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (upErr) {
      thumbPathByHash.set(f.hash, prior); // upload failed — preserve prior, retry next run
    } else {
      thumbPathByHash.set(f.hash, path);
      summary.thumbs_uploaded++;
    }
  }

  // WARN-2: a hash is acknowledged iff its thumbnail is actually stored now (resolved thumb_path is
  // non-null — either uploaded this pass or preserved from a prior pass). Files whose upload failed
  // this pass keep a null path and are NOT acknowledged, so the shell re-sends their thumb_b64.
  for (const f of files) {
    if (thumbPathByHash.get(f.hash)) summary.acknowledged.push(f.hash);
  }

  // ── Upsert media_files (uniform columns; title handled separately to preserve hub edits) ──
  if (files.length > 0) {
    const nowIso = new Date().toISOString();
    const rows = files.map((f) => {
      const status = f.status && VALID_STATUS.has(f.status) ? f.status : "present";
      return {
        venue_id: VENUE_ID,
        filename: f.filename ?? defaultTitle(f.hash),
        hash: f.hash,
        duration_seconds: typeof f.duration_seconds === "number" ? f.duration_seconds : null,
        width: typeof f.width === "number" ? f.width : null,
        height: typeof f.height === "number" ? f.height : null,
        size_bytes: typeof f.size_bytes === "number" ? f.size_bytes : null,
        status,
        thumb_path: thumbPathByHash.get(f.hash) ?? null,
        updated_at: nowIso,
      };
    });
    const { error: upsertErr } = await admin.from("media_files").upsert(rows, { onConflict: "venue_id,hash" });
    if (upsertErr) return json({ error: "media_files upsert failed", detail: upsertErr.message }, 500);
    summary.files_upserted = rows.length;

    // Set default title for NEW files only (rows that had no prior existing entry) — never
    // clobber a title a manager edited in the hub.
    const newTitles = files
      .filter((f) => !existing.has(f.hash))
      .map((f) => ({ hash: f.hash, title: defaultTitle(f.filename ?? f.hash) }));
    summary.files_new = newTitles.length;
    for (const t of newTitles) {
      await admin.from("media_files").update({ title: t.title }).eq("venue_id", VENUE_ID).eq("hash", t.hash);
    }
  }

  // ── Mark vanished files missing (never delete) ──────────────────────────────
  const payloadHashes = new Set(files.map((f) => f.hash));
  const missingHashes = [...existing.keys()].filter((h) => !payloadHashes.has(h));
  if (missingHashes.length > 0) {
    const nowIso = new Date().toISOString();
    // Chunk the `.in(...)` update — thousands of 40-char hashes in one query blow the URL limit.
    for (let i = 0; i < missingHashes.length; i += MISSING_CHUNK) {
      const chunk = missingHashes.slice(i, i + MISSING_CHUNK);
      const { error: mErr } = await admin
        .from("media_files")
        .update({ status: "missing", updated_at: nowIso })
        .eq("venue_id", VENUE_ID)
        .in("hash", chunk);
      if (mErr) return json({ error: "mark-missing failed", detail: mErr.message }, 500);
    }
    summary.marked_missing = missingHashes.length;
  }

  // ── Resolve hash → file id for playlist membership (post-upsert authoritative map) ──
  type IdRow = { id: string; hash: string };
  let idRows: IdRow[];
  try {
    idRows = await selectAllPaged<IdRow>((from, to) =>
      admin.from("media_files").select("id, hash").eq("venue_id", VENUE_ID).order("hash").range(from, to)
    );
  } catch (e) {
    return json({ error: "id map read failed", detail: String((e as Error).message ?? e) }, 500);
  }
  const idByHash = new Map<string, string>();
  for (const r of idRows) idByHash.set(r.hash, r.id);

  // ── Folder auto-playlists (source='folder'; custom playlists are NEVER touched) ──
  for (const folder of folders) {
    // Upsert the folder playlist by (venue_id, folder_path). Only name/source are written on
    // conflict — presentation + shuffle are preserved (owner-set per-playlist), as is id/created_at.
    const { data: plRows, error: plErr } = await admin
      .from("media_playlists")
      .upsert(
        { venue_id: VENUE_ID, name: folder.name ?? folder.path, source: "folder", folder_path: folder.path },
        { onConflict: "venue_id,folder_path" },
      )
      .select("id");
    if (plErr) return json({ error: "playlist upsert failed", detail: plErr.message }, 500);
    const playlistId = plRows?.[0]?.id as string | undefined;
    if (!playlistId) continue;
    summary.playlists_synced++;

    // Replace items with the ordered hashes (skip hashes we don't have a file row for).
    await admin.from("media_playlist_items").delete().eq("playlist_id", playlistId);
    const items: { playlist_id: string; file_id: string; position: number }[] = [];
    let pos = 0;
    const seen = new Set<string>();
    for (const h of folder.hashes ?? []) {
      const fileId = idByHash.get(h);
      if (!fileId || seen.has(fileId)) continue; // unknown hash or dup (PK is playlist+file)
      seen.add(fileId);
      items.push({ playlist_id: playlistId, file_id: fileId, position: pos++ });
    }
    if (items.length > 0) {
      const { error: itErr } = await admin.from("media_playlist_items").insert(items);
      if (itErr) return json({ error: "playlist items insert failed", detail: itErr.message }, 500);
      summary.items_written += items.length;
    }
  }

  return json(summary);
});
