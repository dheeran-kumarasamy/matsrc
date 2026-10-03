// apps/web/lib/icici/merchant-txn.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. Generates ICICI's own
// `merchantTxnNo` — deliberately NOT the same as Buildohub's own order
// number/enquiryId (e.g. "OD/2627/10/00001"), because ICICI's spec imposes
// its own uniqueness/format/length constraints that the Buildohub order
// number format is not guaranteed to satisfy (see task section 15).
//
// Format: "UAT" + 12 random alphanumeric chars + a millisecond timestamp
// suffix, always <= 20 characters, matching the common ICICI PG constraint
// (merchantTxnNo typically capped at 20 alphanumeric characters). The "UAT"
// prefix also makes it immediately obvious in ICICI's own merchant dashboard
// and in Buildohub's logs/DB that a given transaction originated from this
// UAT-only integration, never production.
import { randomBytes } from "crypto";

const MAX_LENGTH = 20;
const PREFIX = "UAT";

export function generateMerchantTxnNo(date: Date = new Date()): string {
  // Base36 timestamp keeps the suffix short while remaining
  // time-ordered/unique-enough per millisecond; combined with 4 random bytes
  // (8 hex/base36 chars) collisions are negligible even under concurrent
  // initiation requests — DB uniqueness constraint (PaymentTransaction.
  // merchantTxnNo @unique) is still the actual source of truth, this is just
  // a low-collision generator feeding into it.
  const timestampPart = date.getTime().toString(36).toUpperCase();
  const randomPart = randomBytes(5).toString("hex").toUpperCase(); // 10 chars

  const candidate = `${PREFIX}${timestampPart}${randomPart}`;
  return candidate.slice(0, MAX_LENGTH);
}
