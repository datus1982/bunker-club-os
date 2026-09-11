#!/usr/bin/env node
/**
 * test:tvchunk — the bar TVs' JS closure must contain ZERO staff-console code.
 *
 * PR #106 isolated the display routes into their own chunks (`modules/signage/
 * displayRoutes.tsx` exports only `SlotDisplay`; `modules/leaderboard/displayRoutes.tsx`
 * exports only `DrinksDisplay`) so a bar TV never downloads the staff hub. That contract
 * was enforced only by a comment in those two files — a future direct import inside
 * `SlotDisplay.tsx` or any signage template (pulling in `ConfirmDialog`, `StaffPageHeader`,
 * the v2 shell, a `useMutation` writer…) would silently re-couple them and nothing would
 * notice. This script makes the contract a build gate (reviewer NOTE-2 on PR #106).
 *
 * Method (the reviewer's own reproduction, scripted):
 *   1. dist/index.html -> the entry chunk.
 *   2. Every `assets/displayRoutes-*.js` is a display loader.
 *   3. For each loader, walk its TRANSITIVE STATIC-IMPORT closure over the built JS.
 *      The entry chunk is excluded: it is the always-loaded shared base (react, router,
 *      supabase, App.tsx's lazy route table) and it legitimately carries staff chunk
 *      filenames + lazy-export names as strings. Vite's preload list excludes it too.
 *   4. Cross-check that closure against Vite's own `__vite__mapDeps` preload list for the
 *      loader's `import()` call, and scan the CSS in that list as well (CSS never appears
 *      in a JS import statement, so the preload list is the only way to see it — that is
 *      what makes the `sv2-` / `bui-` class-prefix markers meaningful).
 *   5. Fail on a staff chunk NAME in the closure, or a staff MARKER string inside any
 *      closure file, or a missing display sentinel (proof we found the right chunk).
 *
 * Run AFTER a build. No dependencies; Node >= 18.
 *   node scripts/check-tv-chunk.mjs           (pnpm test:tvchunk)
 * Exit: 0 clean · 1 violation · 2 cannot run (no build).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(REPO, "apps", "web", "dist");
const ASSETS = join(DIST, "assets");

/** Chunk filenames that must never appear in a display closure. Anchored at the basename. */
const STAFF_CHUNK_PATTERNS = [
  /^routes-.*\.js$/, //            the staff route modules (signage hub, trivia, admin, portal…)
  /^staff-form-/,
  /^staff-shell-v2-/,
  /^ConfirmDialog-/,
  /^useSignageAdmin-/,
  /^useMutation-/, //              react-query mutation runtime: a display only ever reads
  /^Users/,
  /^Scoring/,
  /^SignageHub/,
  /^FormField-/, //                the shared/ui primitives chunk (carries useUiVersion + staff-form.css)
  /^ui-/, //                       trivia/ui.tsx — host-console styles
];

/** Case-sensitive substrings that prove staff code got into a display chunk. */
const STAFF_MARKERS = [
  "admin_list_staff",
  "admin_upsert_staff",
  "SIGNAGE HUB",
  "INVITE STAFF",
  "EDIT ASSET",
  "SWITCH PROGRAM",
  "EDIT ROTATION",
  "MEDIA LIBRARY",
  "StaffPageHeader",
  "StaffLayout",
  "useUiVersion",
  "bunker.ui_version",
  "sv2-",
  "bui-",
  ".upsert(",
];

/**
 * Known display loaders, keyed by the export the loader chunk carries, with a sentinel
 * string that MUST be somewhere in that loader's closure. The sentinel proves the walk
 * found real display code rather than an empty/renamed chunk (a check that passes because
 * it is looking at nothing is worse than no check). Add a row here when a new display
 * route gets its own chunk — an unrecognised `displayRoutes-*.js` is a failure.
 */
const DISPLAY_LOADERS = [
  {
    exportName: "SlotDisplay",
    label: "bar TVs  /signage/s/:slug",
    sentinels: ["signage_heartbeat", "NO SUCH SLOT"],
  },
  {
    exportName: "DrinksDisplay",
    label: "legacy   /drinks",
    sentinels: ["NO SALES DATA YET"], // DrinksDisplay.tsx idle copy
  },
];

const fail = (msg) => {
  console.error(`\n  cannot run: ${msg}\n  Build first:  npm --prefix apps/web run build\n`);
  process.exit(2);
};

// ─── 1. locate the build ──────────────────────────────────────────────────────
if (!existsSync(join(DIST, "index.html"))) fail(`no build at ${DIST}`);
const html = readFileSync(join(DIST, "index.html"), "utf8");
const entryMatch = html.match(/<script[^>]+src="\/(assets\/[^"]+\.js)"/);
if (!entryMatch) fail("no entry <script> found in dist/index.html");
const ENTRY = basename(entryMatch[1]);
if (!existsSync(join(ASSETS, ENTRY))) fail(`entry chunk ${ENTRY} missing from dist/assets`);

const entrySrc = readFileSync(join(ASSETS, ENTRY), "utf8");
const loaderFiles = readdirSync(ASSETS)
  .filter((f) => /^displayRoutes-.*\.js$/.test(f))
  .sort();
if (loaderFiles.length === 0) fail("no assets/displayRoutes-*.js — the display chunks vanished");

// ─── 2. Vite's preload table (best effort — shape is a Vite internal) ─────────
let mapDeps = null;
let mapDepsNote = "";
const tableMatch = entrySrc.match(/m\.f=(\[[^\]]*\])/);
if (tableMatch) {
  try {
    mapDeps = JSON.parse(tableMatch[1]);
  } catch {
    mapDepsNote = "preload table found but not parseable";
  }
} else {
  mapDepsNote = "preload table (__vite__mapDeps) not found in the entry chunk";
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The preload list Vite ships for one loader's dynamic import, or null. */
function preloadFor(loader) {
  if (!mapDeps) return null;
  const re = new RegExp(`import\\("\\./${escapeRe(loader)}"\\),__vite__mapDeps\\(\\[([\\d,\\s]*)\\]\\)`);
  const m = entrySrc.match(re);
  if (!m) return null;
  return m[1]
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => mapDeps[Number(n)])
    .filter(Boolean)
    .map((f) => basename(f));
}

// ─── 3. static-import closure ─────────────────────────────────────────────────
const SPEC_RE = /(?:\bfrom|\bimport)"(\.\/[^"]+)"/g;
const DYN_RE = /\bimport\("(\.\/[^"]+)"\)/g;
const srcCache = new Map();
const read = (f) => {
  if (!srcCache.has(f)) srcCache.set(f, readFileSync(join(ASSETS, f), "utf8"));
  return srcCache.get(f);
};

/** BFS over static imports. The entry chunk is the shared base — never walked, never scanned. */
function closureOf(loader) {
  const seen = new Set();
  const dynamic = new Set();
  const queue = [loader];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || file === ENTRY) continue;
    if (!existsSync(join(ASSETS, file))) continue;
    seen.add(file);
    const src = read(file);
    for (const m of src.matchAll(SPEC_RE)) {
      const dep = basename(m[1]);
      if (dep !== ENTRY && !seen.has(dep)) queue.push(dep);
    }
    for (const m of src.matchAll(DYN_RE)) {
      const dep = basename(m[1]);
      if (dep === ENTRY) continue;
      dynamic.add(dep);
      // WALK it, don't just scan it: a lazy-loaded chunk's own static imports are part of what
      // the TV would fetch once that import() fires (reviewer WARN-1, #108).
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return { files: [...seen].sort(), dynamic: [...dynamic].sort() };
}

// ─── 4. rules ─────────────────────────────────────────────────────────────────
const violations = [];
const infos = [];
const report = [];

for (const loader of loaderFiles) {
  const { files, dynamic } = closureOf(loader);
  const preload = preloadFor(loader);
  const preloadCss = (preload ?? []).filter((f) => f.endsWith(".css"));
  const preloadJs = (preload ?? []).filter((f) => f.endsWith(".js"));

  // Which display route is this? Identify by the loader's own export, not its hash.
  const src = read(loader);
  const spec = DISPLAY_LOADERS.find((d) => new RegExp(`\\b${d.exportName}\\b`).test(src));
  if (!spec) {
    violations.push(
      `${loader}: UNRECOGNISED display loader — no known display export found.\n` +
        `      A new display chunk must be registered in DISPLAY_LOADERS in this script,\n` +
        `      with a sentinel string, or the gate silently stops covering it.`
    );
  }

  // Everything the rules apply to: static closure + the CSS Vite preloads with it +
  // anything the closure pulls in dynamically (nothing does today — a TV requests no JS
  // after boot — but a future dynamic import must not be a way around the contract).
  const scanSet = [...new Set([...files, ...preloadCss, ...dynamic])];
  // JS chunks Vite preloads but the static walk missed (or vice-versa): informational.
  const onlyPreload = preloadJs.filter((f) => !files.includes(f));
  const onlyStatic = files.filter((f) => !preloadJs.includes(f));
  if (preload && (onlyPreload.length || onlyStatic.length)) {
    infos.push(
      `${loader}: static closure and Vite's preload list diverge — ` +
        `preload-only: ${onlyPreload.join(", ") || "none"}; static-only: ${onlyStatic.join(", ") || "none"} ` +
        `(rules applied to the union)`
    );
  }
  if (!preload) {
    // A missing preload table means the TV's CSS is NOT covered (sv2-/bui- markers live there
    // too). Silently passing would let a Vite bump quietly narrow the gate (reviewer NOTE-2) —
    // so it is a violation: fix the parser, don't ship blind.
    violations.push(
      `${loader}: preload list not parsed${mapDepsNote ? ` (${mapDepsNote})` : ""} — ` +
        `CSS is not covered for this loader; update the __vite__mapDeps parser in this script`
    );
  }
  if (dynamic.length) {
    infos.push(`${loader}: closure contains nested dynamic import(s): ${dynamic.join(", ")} (walked + scanned under the same rules)`);
  }

  // Rule A — no staff chunk by name.
  for (const f of scanSet) {
    const pat = STAFF_CHUNK_PATTERNS.find((p) => p.test(f));
    if (pat) violations.push(`${loader}: staff chunk in the closure -> ${f}  (matches ${pat})`);
  }

  // Rule B — no staff marker inside any closure file. Import specifiers are blanked
  // first: a chunk's own hash can contain any substring (`…Bsv2-x.js`), and a staff file
  // NAMED in an import is already caught, harder, by rule A.
  for (const f of scanSet) {
    if (!existsSync(join(ASSETS, f))) continue;
    const body = read(f).replace(SPEC_RE, 'from"#"').replace(DYN_RE, 'import("#")');
    for (const marker of STAFF_MARKERS) {
      const at = body.indexOf(marker);
      if (at === -1) continue;
      const snippet = body.slice(Math.max(0, at - 20), at + 40).replace(/\s+/g, " ");
      violations.push(`${loader}: staff marker "${marker}" in ${f}\n      …${snippet}…`);
    }
  }

  // Rule C — sentinels: prove we are looking at the real display code.
  if (spec) {
    for (const sentinel of spec.sentinels) {
      const found = scanSet.some((f) => existsSync(join(ASSETS, f)) && read(f).includes(sentinel));
      if (!found) {
        violations.push(
          `${loader}: display sentinel "${sentinel}" NOT found in the ${spec.exportName} closure — ` +
            `the walk is looking at the wrong chunk, or the string moved (update DISPLAY_LOADERS)`
        );
      }
    }
  }

  const bytes = files.reduce((n, f) => n + statSync(join(ASSETS, f)).size, 0);
  const cssBytes = preloadCss.reduce((n, f) => n + statSync(join(ASSETS, f)).size, 0);
  report.push({ loader, spec, files, preloadCss, bytes, cssBytes });
}

// ─── 5. output ────────────────────────────────────────────────────────────────
console.log(`\nTV CHUNK CONTRACT — dist entry ${ENTRY}\n`);
for (const r of report) {
  const name = r.spec ? `${r.spec.exportName}  (${r.spec.label})` : "UNRECOGNISED LOADER";
  console.log(`  ${name}`);
  console.log(`  ${"-".repeat(64)}`);
  for (const f of r.files) {
    console.log(`    ${String(statSync(join(ASSETS, f)).size).padStart(7)}  ${f}`);
  }
  for (const f of r.preloadCss) {
    console.log(`    ${String(statSync(join(ASSETS, f)).size).padStart(7)}  ${f}  (css, from preload list)`);
  }
  console.log(
    `    ${String(r.bytes).padStart(7)}  = ${r.files.length} JS chunk(s)` +
      (r.preloadCss.length ? `; +${r.cssBytes} CSS = ${r.bytes + r.cssBytes} total` : "")
  );
  console.log("");
}
for (const i of infos) console.log(`  note: ${i}`);
if (infos.length) console.log("");

if (violations.length) {
  console.error(`TV CHUNK: VIOLATION — ${violations.length} finding(s)\n`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(
    `\n  The bar TVs must never download staff-console code (CLAUDE.md RULE #1 / PR #106).\n` +
      `  Keep modules/{signage,leaderboard}/displayRoutes.tsx exporting display routes only,\n` +
      `  and do not import staff components or mutation hooks from SlotDisplay/templates.\n`
  );
  process.exit(1);
}
console.log("TV CHUNK: CLEAN — no staff code in any display closure\n");
process.exit(0);
