// Cloudflare Pages Function — guards /assets/* against the SPA-fallback cache trap.
//
// THE BUG THIS CLOSES (PR #42 "prod black screen"; PR #31 favicon variant):
// Vite emits hashed, immutable bundles under /assets/ (e.g. /assets/useMutation-OLDHASH.js).
// During a deploy's propagation window a browser can request an OLD hashed chunk that no
// longer exists in the new deploy. On stock Pages, a request with no matching static asset
// falls through the SPA rewrite (`/* /index.html 200` in _redirects) and returns index.html
// with a 200. Browsers then CACHE that HTML under the .js URL, so the lazy import() keeps
// getting HTML (never valid JS) forever — a silent, permanent black screen until a
// cache-bypassing reload. A real 404 (a) tells the browser the chunk is gone and (b) is not
// cached, so the trap never arms.
//
// WHY A FUNCTION (not _redirects): Pages _redirects does NOT support 404-status rewrites —
// the "Rewrites (other status codes)" row is explicitly unsupported in the docs
// (https://developers.cloudflare.com/pages/configuration/redirects/). A tiny Function is the
// simplest mechanism that yields a genuine 404.
//
// This route only matches /assets/* (Pages routing: functions/assets/[[path]].js). Every
// other path — SPA routes, the DNS-cutover 301s, /favicon.ico — is untouched and keeps
// flowing through normal static serving + _redirects.
export const onRequest = async (context) => {
  // Delegate to Pages' own static-asset server. For a real hashed asset this returns the
  // file (correct content-type; caching = Pages etag revalidation + any zone-level TTL) passed through
  // unchanged. For a miss it falls through to the SPA rewrite and returns index.html (200,
  // text/html) — the exact condition we must convert into a 404.
  const res = await context.env.ASSETS.fetch(context.request);

  const contentType = res.headers.get("content-type") || "";
  // A genuine build asset under /assets/ is JS / CSS / an image / a font — never HTML.
  // If we got HTML back, the asset is missing and Pages served the SPA shell. Turn that into
  // a real, uncached 404 so the browser never poisons its cache with index.html under the
  // asset URL. (If ASSETS.fetch ever returns a bare 404 for the miss instead, this branch is
  // simply skipped and we pass the 404 straight through — correct either way.)
  if (res.status === 200 && contentType.includes("text/html")) {
    return new Response("Asset not found.\n", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  return res;
};
