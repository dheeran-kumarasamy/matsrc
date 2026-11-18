// apps/web/lib/icici/txn-date.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. Formats a Date as the txnDate
// string ICICI's Initiate Sale API expects.
//
// Format/timezone confirmed against the live ICICI UAT sandbox and integration pack:
// ICICI's Initiate Sale API expects "YYYYMMDDHHMMSS" (14 digits, no hyphens, colons, or spaces),
// in IST (Asia/Kolkata, UTC+5:30) — ICICI being an Indian bank.
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
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}
