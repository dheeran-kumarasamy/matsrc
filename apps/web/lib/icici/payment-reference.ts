// apps/web/lib/icici/payment-reference.ts
//
// ICICI Bank Payment Gateway — UAT ONLY. Generates PaymentTransaction's own
// human-readable `paymentReference` — shown to the builder on the payment
// result page. Distinct from both Buildohub's order number (OD/...) and
// ICICI's merchantTxnNo (see merchant-txn.ts), mirroring this schema's
// existing separate-internal-vs-external-identifier pattern.
import { randomBytes } from "crypto";

export function generatePaymentReference(date: Date = new Date()): string {
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `PAY-ICICI-UAT-${datePart}-${randomPart}`;
}
