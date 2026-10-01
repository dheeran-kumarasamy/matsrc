// packages/db/lib/invoice-number.ts
//
// Invoice number generation.
//
// Central, single source of truth for generating a unique, server-side,
// human-readable invoice number of the form:
//
//   INV-<YEAR>-<6-digit sequence>
//
//   e.g. "INV-2026-000001"
//
// Mirrors the exact same pattern already used for the Meaningful Enquiry ID
// (see packages/db/lib/enquiry-id.ts / EnquirySequence): a single global,
// monotonically-increasing sequence counter, incremented inside a
// `SELECT ... FOR UPDATE` row lock taken within the SAME `prisma.$transaction`
// that creates the Invoice row, so concurrent "Generate Invoice" requests can
// never be handed the same sequence number twice.
//
// The year prefix is purely cosmetic/display (taken from the current date at
// generation time) — the underlying `value` counter is global and never
// resets per year, so the numeric part alone remains globally unique even
// across a year boundary.

const SEQUENCE_PADDING = 6;

// A transaction client exposes the same `$queryRaw`/model delegates as the
// full PrismaClient. Using a minimal structural type here (mirroring the
// existing `TxClient` convention in enquiry-id.ts) keeps this helper usable
// from both apps/api (NestJS) and apps/web (Next.js route handlers).
type TxClient = {
  $queryRaw: (...args: any[]) => Promise<any>;
  invoiceSequence: {
    update: (args: any) => Promise<{ value: number }>;
  };
};

/**
 * Atomically increments and returns the next global invoice sequence
 * number. MUST be called from inside a `prisma.$transaction` callback —
 * takes a row lock on the single `InvoiceSequence` row so concurrent
 * invoice generation can never be handed the same sequence number twice.
 */
export async function nextInvoiceSequence(tx: TxClient): Promise<number> {
  await tx.$queryRaw`SELECT "value" FROM "InvoiceSequence" WHERE "id" = 'singleton' FOR UPDATE`;

  const updated = await tx.invoiceSequence.update({
    where: { id: "singleton" },
    data: { value: { increment: 1 } },
    select: { value: true },
  });

  return updated.value;
}

/**
 * Formats the final invoice number from its parts. Zero-pads the sequence
 * to 6 digits (e.g. 123 -> "000123").
 */
export function formatInvoiceNumber(year: number, sequence: number): string {
  const seq = String(sequence).padStart(SEQUENCE_PADDING, "0");
  return `INV-${year}-${seq}`;
}

export { generateInvoiceNumber } from "./business-number";
