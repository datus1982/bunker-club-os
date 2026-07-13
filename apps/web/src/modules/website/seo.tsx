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
export const OG_IMAGE = `${SITE_ORIGIN}/og-default.svg`;

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

export function useDocumentMeta({ title, description, path, ogType = "website" }: MetaOpts) {
  useEffect(() => {
    const url = SITE_ORIGIN + path;
    document.title = title;

    upsertMeta('meta[name="description"][data-managed="seo"]', "name", "description", description);
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
      // JSON.stringify output is inert data, not markup — safe to inject.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
