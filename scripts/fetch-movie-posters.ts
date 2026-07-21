/**
 * fetch-movie-posters.ts — source a real poster for every media_files row and mirror it into the
 * PUBLIC `signage` bucket at media-posters/{venue}/{hash}.jpg, then set media_files.poster_path
 * (migration 0055). The Q-SYS nowPlaying API (media-control v6) and the `now_playing` signage
 * template PREFER poster_path and fall back to the frame-thumb (thumb_path) — so a miss never
 * breaks a card.
 *
 * ── Two-source poster fetch: TMDB (preferred) → keyless Wikipedia (fallback) ─────────────────
 * TMDB (when env TMDB_API_KEY is set) is the primary source: crisp real one-sheets at w780. The
 * v3 API is a simple api_key query — `search/movie?query=<title>&year=<year>` / `search/tv?query=
 * <show>` → `results[0].poster_path` → https://image.tmdb.org/t/p/w780{poster_path}.
 * ATTRIBUTION: using the TMDB API obliges the credit "This product uses the TMDB API but is not
 * endorsed or certified by TMDB." — carried as the full sentence in docs/runbooks/qsys-media-control.md
 * and a short "POSTERS: TMDB" credit on the now_playing slide (shown only when a real poster is up).
 *
 * If TMDB_API_KEY is ABSENT, it falls back to the keyless MediaWiki Action API. (The task first
 * specified the keyless iTunes Search API, but as of 2025 Apple has emptied the movie AND tv
 * catalogs from it — `media=movie`/`media=tvShow` return resultCount:0 for every storefront,
 * verified.) MediaWiki: `generator=search` finds the film/show article, `prop=pageimages&
 * piprop=original&pilicense=any` returns its lead image — the poster for a film article
 * (`pilicense=any` is REQUIRED: posters are fair-use/non-free and pageimages hides those by
 * default). Trade-off: Wikipedia keeps non-free posters at fair-use low resolution (~250–260 px
 * wide) — real but soft; TMDB's w780 is the upgrade. // DECISION reported up.
 *
 * Parsing mirrors mediaProgram.parseTitleYear: "Name (YYYY)" → movie; "Show - SxxEyy - Ep" → the
 * SHOW name searched as a TV series. TV artwork on Wikipedia is inconsistent (title-card/logo
 * rather than a 2:3 poster, SVG logos skipped); TMDB has proper TV posters. A miss NEVER nulls an
 * existing poster_path (posters are only ever upgraded or left, never downgraded to null).
 *
 * Idempotent: rows that already have a poster_path are skipped, so re-runs only fill new/failed
 * files. `--force` re-fetches everything — with TMDB present this is how the soft Wikipedia
 * posters get REPLACED by TMDB (a TMDB miss on a --force row keeps its existing poster, never
 * nulled). `--dry` fetches + logs without uploading/writing; `--limit N` caps for a smoke test.
 *
 * Run: `npx tsx scripts/fetch-movie-posters.ts [--dry] [--force] [--limit N]`
 */
import { newServiceClient, requireEnv } from "./_shared";

const WIKI = "https://en.wikipedia.org/w/api.php";
const UA = "bunker-club-os/1.0 (signage movie-poster fetch; contact datus@mac.com)";
const BUCKET = "signage";
const VENUE = requireEnv("VENUE_ID");
const DELAY_MS = 250; // polite gap between source queries
const MAX_BYTES = 5 * 1024 * 1024; // signage bucket cap (0037)

// Source selection: TMDB when a key is present (crisp w780 one-sheets), else keyless Wikipedia.
const TMDB_KEY = process.env.TMDB_API_KEY?.trim() || "";
const SOURCE: "tmdb" | "wikipedia" = TMDB_KEY ? "tmdb" : "wikipedia";

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

/** A resolved poster from either source: the image URL, a label for logging, and whether the match
 *  is confident (the resolved title contains the searched name). Null = nothing found. */
interface Sourced { imageUrl: string; label: string; confident: boolean }

const isConfident = (name: string, matched: string): boolean => {
  const a = norm(name), b = norm(matched);
  return !!a && (b.includes(a) || (a.length >= 6 && a.includes(b)));
};

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

/** Wikipedia source (keyless fallback). */
async function wikiSourced(p: Parsed): Promise<Sourced | null> {
  const hit = await wikiPoster(searchTerm(p));
  if (!hit || !hit.source) return null;
  return { imageUrl: hit.source, label: `${hit.pageTitle} (${hit.width}×${hit.height})`, confident: isConfident(p.name, hit.pageTitle) };
}

/** TMDB source (preferred when TMDB_API_KEY is set): search movie by title+year / tv by show name,
 *  take the top result's poster_path at w780. Never nulls — returns null on no-poster (caller keeps
 *  any existing poster_path). */
async function tmdbSourced(p: Parsed): Promise<Sourced | null> {
  const base = "https://api.themoviedb.org/3";
  const url = p.kind === "movie"
    ? `${base}/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(p.name)}${p.year ? `&year=${p.year}` : ""}`
    : `${base}/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(p.name)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tmdb ${res.status}`);
  const j = (await res.json()) as { results?: Array<{ poster_path: string | null; title?: string; name?: string; release_date?: string }> };
  const results = (j.results ?? []).filter((r) => r.poster_path);
  if (results.length === 0) return null;
  // Prefer a movie result whose release year matches ±1; else the top (relevance-ranked) result.
  let pick = results[0];
  if (p.kind === "movie" && p.year) {
    const y = Number(p.year);
    const match = results.find((r) => { const ry = Number((r.release_date ?? "").slice(0, 4)); return ry && Math.abs(ry - y) <= 1; });
    if (match) pick = match;
  }
  const matchedTitle = pick.title ?? pick.name ?? "";
  return {
    imageUrl: `https://image.tmdb.org/t/p/w780${pick.poster_path}`,
    label: matchedTitle || "(tmdb)",
    confident: isConfident(p.name, matchedTitle),
  };
}

/** Resolve a poster from the active source (TMDB when keyed, else Wikipedia). */
function sourcePoster(p: Parsed): Promise<Sourced | null> {
  return SOURCE === "tmdb" ? tmdbSourced(p) : wikiSourced(p);
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
  console.log(`\nfetch-movie-posters — source ${SOURCE.toUpperCase()}${SOURCE === "tmdb" ? " (w780)" : " (keyless)"} · ${DRY ? "DRY RUN (no upload/write)" : "LIVE"}${FORCE ? " · FORCE" : ""}${LIMIT !== Infinity ? ` · limit ${LIMIT}` : ""}\n`);

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
      const hit = await sourcePoster(parsed);
      await sleep(DELAY_MS); // polite between source calls (the image fetch below is a different host)

      // A miss NEVER writes — an existing poster_path is left intact (never downgraded to null).
      if (!hit) { missed++; misses.push(label); console.log(`  ○ MISS  ${label}  (no poster${row.poster_path ? ", kept existing" : ""})`); continue; }
      if (!hit.confident) { lowConf++; lows.push(`${label}  →  ${hit.label}`); }

      const imgRes = await fetch(hit.imageUrl, { headers: { "User-Agent": UA } });
      if (!imgRes.ok) { missed++; misses.push(label); console.log(`  ○ MISS  ${label}  (image ${imgRes.status})`); continue; }
      const kind = imageKind(imgRes.headers.get("content-type"), hit.imageUrl);
      if (!kind) { missed++; misses.push(label); console.log(`  ○ MISS  ${label}  (unsupported ${hit.imageUrl.split(".").pop()})`); continue; }
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
      const flag = hit.confident ? "" : "  ⚠ low-confidence";
      console.log(`  ✔ ${parsed.kind === "tv" ? "TV " : "   "}${label}  ←  ${hit.label}${flag}`);
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
