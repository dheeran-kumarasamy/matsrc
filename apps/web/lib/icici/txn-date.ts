// apps/web/lib/icici/txn-date.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. Formats a Date as the txnDate
// string ICICI's Initiate Sale API expects.
//
// Format/timezone confirmed empirically against the live ICICI UAT sandbox:
// sending a full ISO-8601 UTC timestamp (e.g. "2026-10-03T18:59:24.826Z")
// was rejected with responseCode "P1006" / responseDescription "Invalid
// Transaction Date". ICICI's documented format is "yyyy-MM-dd HH:mm:ss"
// (space-separated, no milliseconds, no timezone designator), in IST
// (Asia/Kolkata, UTC+5:30) — ICICI being an Indian bank.
//
// Explicitly converts to IST rather than using the server's local
// time/Date.getHours(), since Vercel serverless functions always execute in
// UTC regardless of the deployment's configured region — using local time
// there would silently send the wrong clock time to ICICI even once the
// string format itself was fixed.
export function formatIciciTxnDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

// ICICI PG v2 (PayPhi-based) integrations commonly document txnDate as a
// 14-digit "yyyyMMddHHmmss" compact string (no separators, no space), which
// differs from the spaced "yyyy-MM-dd HH:mm:ss" format above that this repo
// previously confirmed only empirically (see the module doc comment and
// formatIciciTxnDate's own comment) against a single UAT rejection. Kept as
// an alternate formatter — toggled via ICICI_PG_TXN_DATE_FORMAT — so both
// conventions can be tried without another code change while the real
// ICICI spec document is still unconfirmed (see hash.ts's same caveat).
export function formatIciciTxnDateCompact(date: Date): string {
  return formatIciciTxnDate(date).replace(/[-: ]/g, "");
}
