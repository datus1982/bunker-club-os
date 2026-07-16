/**
 * Media reads — PostgREST pagination helper (docs/15 M1, WARN-1).
 *
 * An unranged PostgREST select silently caps at 1000 rows (max-rows) — even for the service role.
 * Past 1000 media files / playlist items a single select truncates and the library, playlist, and
 * program readers go quietly incomplete. Every media read pages in fixed windows until a short
 * page, aggregating all rows.
 *
 * `fetchPage(from, to)` must issue a `.range(from, to)` query (inclusive window) over a STABLE
 * order, and throw on error. The loop stops on the first page shorter than PAGE_SIZE — including
 * the empty page returned after an exact-multiple total — so it always terminates.
 */
export const MEDIA_PAGE_SIZE = 1000;

export async function collectPaged<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number = MEDIA_PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}
