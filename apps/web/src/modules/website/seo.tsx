import { useEffect } from "react";

/**
 * SEO chrome for the public site (docs/14) with NO new deps (no react-helmet).
 * A tiny imperative hook upserts per-route <title>, meta description, canonical,
 * and OpenGraph/Twitter tags into <head>; a <JsonLd> component injects
 * structured data. SPA-safe: every navigation re-runs the hook and overwrites
 * the same managed tags (marked data-managed) rather than stacking duplicates.
 */

/** Canonical production origin (the site will live at the apex, not os.*). */
export const SITE_ORIGIN = "https://bunkerokc.com";
export const SITE_NAME = "Bunker Club";
// 1200×630 raster (og-default.jpg, ~180 KB) — real OG images must be a bitmap;
// scrapers (iMessage/Slack/Facebook) do not render SVG previews. JPEG (not PNG)
// keeps the photographic card small. Matches the static og:image in index.html
// so the JS updater overwrites the same tag.
export const OG_IMAGE = `${SITE_ORIGIN}/og-default.jpg`;

// Static defaults — MUST byte-match the static head block in index.html (W1/N8).
// useDocumentMeta writes these back on unmount so staff routes (/login, /scoring…)
// don't carry stale per-page marketing meta after leaving the public site.
const DEFAULT_TITLE = "Bunker Club — Atomic Age High-Dive Bar in OKC";
const DEFAULT_DESCRIPTION =
  "An atomic age high-dive bar at 433 NW 23rd St in Oklahoma City. Open 4 PM to 2 AM daily, with Atomic Pub Trivia every Wednesday night.";

type MetaOpts = {
  title: string;
  description: string;
  /** Path incl. leading slash, e.g. "/visit". */
  path: string;
  ogType?: "website" | "article";
};

function upsertMeta(selector: string, attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute("data-managed", "seo");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"][data-managed="seo"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    el.setAttribute("data-managed", "seo");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Write the full managed tag set. Selectors match the STATIC tags shipped in
 * index.html by name/property (no data-managed qualifier), so this UPDATES the
 * static block in place rather than appending duplicate tags.
 */
function applyMeta(title: string, description: string, url: string, ogType: "website" | "article") {
  document.title = title;

  upsertMeta('meta[name="description"]', "name", "description", description);
  upsertLink("canonical", url);

  upsertMeta('meta[property="og:title"]', "property", "og:title", title);
  upsertMeta('meta[property="og:description"]', "property", "og:description", description);
  upsertMeta('meta[property="og:type"]', "property", "og:type", ogType);
  upsertMeta('meta[property="og:url"]', "property", "og:url", url);
  upsertMeta('meta[property="og:image"]', "property", "og:image", OG_IMAGE);
  upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", SITE_NAME);

  upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
  upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", title);
  upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", description);
  upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", OG_IMAGE);
}

export function useDocumentMeta({ title, description, path, ogType = "website" }: MetaOpts) {
  useEffect(() => {
    applyMeta(title, description, SITE_ORIGIN + path, ogType);
    // On unmount (navigating off the public site, e.g. to /login) reset every tag
    // to the static index.html defaults so staff routes don't inherit stale
    // marketing meta (N8).
    return () => applyMeta(DEFAULT_TITLE, DEFAULT_DESCRIPTION, SITE_ORIGIN + "/", "website");
  }, [title, description, path, ogType]);
}

/**
 * Inject a JSON-LD block. React renders the script with the LD payload as text;
 * keyed by id so re-mounts replace rather than duplicate.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Escape `<` to < so a value containing "</script>" (or any markup) can't
      // break out of the script element (N7). The payload stays valid JSON-LD.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
