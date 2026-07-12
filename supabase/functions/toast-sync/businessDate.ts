// businessDate.ts — TZ-1 fix (docs/08). Pure, dependency-free so it runs under both
// Deno (the edge function) and Node/tsx (the unit test in scripts/test-business-date.ts).
//
// The legacy toast-sync computed the Toast businessDate with a HARDCODED UTC-6 offset,
// so during CDT (UTC-5, Mar–Nov) the late-night board queried the wrong date and went
// stale/empty. Here the venue-local calendar date comes straight from Intl in the
// venue's timezone — correct across DST and month/year boundaries with no offset math.
//
// closeoutHour models Toast's business-day rollover: an order at 1am belongs to the
// previous business date if the restaurant closes out later than midnight (bars commonly
// roll at ~4am). Local times before closeoutHour count as the previous business day.
// Pass the value Toast reports for the restaurant (config:read); default 0 = calendar date.
export function businessDateFor(now: Date, timeZone: string, closeoutHour = 0): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  let y = Number(get("year"));
  let m = Number(get("month"));
  let d = Number(get("day"));
  const h = Number(get("hour"));

  if (h < closeoutHour) {
    // Still "last night" for the venue — roll back one calendar day.
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    y = dt.getUTCFullYear();
    m = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  }

  return `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}
