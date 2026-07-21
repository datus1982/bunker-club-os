/**
 * fetch-movie-posters.ts — source a real poster for every media_files row and mirror it into the
 * PUBLIC `signage` bucket at media-posters/{venue}/{hash}.jpg, then set media_files.poster_path
 * (migration 0055). The Q-SYS nowPlaying API (media-control v6) and the `now_playing` signage
 * template PREFER poster_path and fall back to the frame-thumb (thumb_path) — so a miss never
 * breaks a card.
 *
 * ── Source: keyless Wikipedia / Wikimedia (NOT iTunes) ──────────────────────────────────────
 * The task specified the keyless iTunes Search API, but as of 2025 Apple has emptied the movie
 * AND tv catalogs from that API — `media=movie` / `media=tvShow` return resultCount:0 for every
 * storefront (US/GB/AU/CA/DE and no-country all verified 0). TMDB and OMDb both require an API
 * key (401 without one). So this uses the MediaWiki Action API, which IS keyless and returns the
 * real theatrical one-sheet: `generator=search` finds the film/show article, `prop=pageimages&
 * piprop=original&pilicense=any` returns its lead image (for a film article that lead image is
 * the poster; `pilicense=any` is REQUIRED because posters are fair-use/non-free and pageimages
 * hides non-free images by default). Trade-off: Wikipedia keeps non-free posters at fair-use
 * low resolution (~250–260 px wide), so posters are real but soft — still far better than a
 * grabbed video frame, and contain-fit on the slide never crops them. // DECISION reported up.
 *
 * Parsing mirrors mediaProgram.parseTitleYear: "Name (YYYY)" → movie; "Show - SxxEyy - Ep" → the
 * SHOW name searched as a TV series. TV artwork on Wikipedia is inconsistent (some shows have a
 * title-card or logo rather than a 2:3 poster, and SVG logos are skipped) — that's fine, the bar
 * plays mostly movies and any real raster art beats a frame grab; a miss just leaves the thumb.
 *
 * Idempotent: rows that already have a poster_path are skipped, so re-runs only fill new/failed
 * files. `--force` re-fetches everything, `--dry` fetches + logs without uploading/writing,
 * `--limit N` caps the run for a smoke test.
 *
 * Run: `npx tsx scripts/fetch-movie-posters.ts [--dry] [--force] [--limit N]`
 */
import { newServiceClient, requireEnv } from "./_shared";

const WIKI = "https://en.wikipedia.org/w/api.php";
const UA = "bunker-club-os/1.0 (signage movie-poster fetch; contact datus@mac.com)";
const BUCKET = "signage";
const VENUE = requireEnv("VENUE_ID");
const DELAY_MS = 250; // polite gap between Wikipedia queries
const MAX_BYTES = 5 * 1024 * 1024; // signage bucket cap (0037)

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry");
const FORCE = argv.includes("--force");
const LIMIT = (() => {
  const i = argv.indexOf("--limit");
  return i >= 0 && argv[i + 1] ? Math.max(1, parseInt(argv[i + 1], 10) || 0) : Infinity;
})();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Row { id: string; title: string | null; filename: string; hash: string; poster_path: string | null }

type Kind = "movie" | "tv";
interface Parsed { kind: Kind; name: string; year: string | null }

function basename(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
}

/** "Name (YYYY)" → movie; "Show - S01E04 - Ep" → the show, as a TV series. Falls back to filename. */
function parseEntry(title: string | null, filename: string): Parsed {
  const t = (title ?? "").trim() || basename(filename);
  const tv = t.match(/^(.*?)\s*-\s*S\d{1,2}E\d{1,3}\b/i);
  if (tv) return { kind: "tv", name: tv[1].trim(), year: null };
  const mv = t.match(/^(.*\S)\s*\((\d{4})\)\s*$/);
  if (mv) return { kind: "movie", name: mv[1].trim(), year: mv[2] };
  return { kind: "movie", name: t, year: null };
}

function searchTerm(p: Parsed): string {
  return p.kind === "movie" ? `${p.name}${p.year ? ` ${p.year}` : ""} film` : `${p.name} (TV series)`;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

interface Hit { pageTitle: string; source: string; width: number; height: number }

/** One MediaWiki request: search for the article + its non-free lead image (the poster). */
async function wikiPoster(term: string): Promise<Hit | null> {
  const url = `${WIKI}?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(term)}` +
    `&gsrlimit=1&prop=pageimages&piprop=original&pilicense=any`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`wiki ${res.status}`);
  const j = (await res.json()) as { query?: { pages?: Record<string, { title: string; original?: { source: string; width: number; height: number } }> } };
  const pages = j.query?.pages;
  if (!pages) return null;
  const first = Object.values(pages)[0];
  if (!first?.original?.source) return { pageTitle: first?.title ?? "", source: "", width: 0, height: 0 };
  return { pageTitle: first.title, source: first.original.source, width: first.original.width, height: first.original.height };
}

/** Map a fetched image's content-type to an accepted (bucket) extension + type. Null = reject. */
function imageKind(contentType: string | null, source: string): { ext: string; type: string } | null {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg") || /\.jpe?g($|\?)/i.test(source)) return { ext: "jpg", type: "image/jpeg" };
  if (ct.includes("png") || /\.png($|\?)/i.test(source)) return { ext: "png", type: "image/png" };
  if (ct.includes("webp") || /\.webp($|\?)/i.test(source)) return { ext: "webp", type: "image/webp" };
  return null; // svg / gif / unknown — skip (frame-thumb fallback remains)
}

async function main() {
  const admin = newServiceClient();
  console.log(`\nfetch-movie-posters — ${DRY ? "DRY RUN (no upload/write)" : "LIVE"}${FORCE ? " · FORCE" : ""}${LIMIT !== Infinity ? ` · limit ${LIMIT}` : ""}\n`);

  const { data, error } = await admin
    .from("media_files")
    .select("id, title, filename, hash, poster_path")
    .eq("venue_id", VENUE)
    .order("title");
  if (error) throw new Error(`media_files read: ${error.message}`);
  const rows = (data ?? []) as Row[];

  let processed = 0, skipped = 0, found = 0, missed = 0, lowConf = 0;
  const misses: string[] = [];
  const lows: string[] = [];

  for (const row of rows) {
    if (row.poster_path && !FORCE) { skipped++; continue; }
    if (processed >= LIMIT) break;
    processed++;

    const parsed = parseEntry(row.title, row.filename);
    const label = (row.title ?? basename(row.filename)).slice(0, 60);
    try {
      const hit = await wikiPoster(searchTerm(parsed));
      await sleep(DELAY_MS); // polite between wiki calls (image fetch below is a different host)

      if (!hit || !hit.source) { missed++; misses.push(label); console.log(`  ○ MISS  ${label}  (no article/image)`); continue; }

      // Confidence: the resolved article title should contain the searched name (or vice-versa
      // for very short names). A miss here still takes the image but is flagged for review.
      const nName = norm(parsed.name), nPage = norm(hit.pageTitle);
      const confident = !!nName && (nPage.includes(nName) || (nName.length >= 6 && nName.includes(nPage)));
      if (!confident) { lowConf++; lows.push(`${label}  →  ${hit.pageTitle}`); }

      const imgRes = await fetch(hit.source, { headers: { "User-Agent": UA } });
      if (!imgRes.ok) { missed++; misses.push(label); console.log(`  ○ MISS  ${label}  (image ${imgRes.status})`); continue; }
      const kind = imageKind(imgRes.headers.get("content-type"), hit.source);
      if (!kind) { missed++; misses.push(label); console.log(`  ○ MISS  ${label}  (unsupported ${hit.source.split(".").pop()})`); continue; }
      const bytes = new Uint8Array(await imgRes.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) { missed++; misses.push(label); console.log(`  ○ MISS  ${label}  (bad size ${bytes.length})`); continue; }

      const path = `media-posters/${VENUE}/${row.hash}.${kind.ext}`;
      if (!DRY) {
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, upsert: true });
        if (upErr) { missed++; misses.push(label); console.log(`  ✗ FAIL  ${label}  (upload: ${upErr.message})`); continue; }
        const { error: setErr } = await admin.from("media_files").update({ poster_path: path }).eq("id", row.id);
        if (setErr) { missed++; misses.push(label); console.log(`  ✗ FAIL  ${label}  (db: ${setErr.message})`); continue; }
      }
      found++;
      const flag = confident ? "" : "  ⚠ low-confidence";
      console.log(`  ✔ ${parsed.kind === "tv" ? "TV " : "   "}${label}  ←  ${hit.pageTitle} (${hit.width}×${hit.height})${flag}`);
    } catch (e) {
      missed++; misses.push(label);
      console.log(`  ✗ ERR   ${label}  (${e instanceof Error ? e.message : String(e)})`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n── summary ─────────────────────────────`);
  console.log(`  library rows      ${rows.length}`);
  console.log(`  already had poster ${skipped}${FORCE ? " (ignored, --force)" : " (skipped)"}`);
  console.log(`  processed         ${processed}`);
  console.log(`  posters set       ${found}${DRY ? " (dry — not written)" : ""}`);
  console.log(`  low-confidence    ${lowConf}`);
  console.log(`  missed            ${missed}`);
  if (lows.length) { console.log(`\n  ⚠ low-confidence matches (spot-check these):`); for (const l of lows) console.log(`      ${l}`); }
  if (misses.length) { console.log(`\n  ○ missed (kept frame-thumb fallback):`); for (const m of misses) console.log(`      ${m}`); }
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); });
