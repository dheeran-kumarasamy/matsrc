// packages/db/lib/enquiry-id.ts
//
// Meaningful Enquiry ID generation.
//
// Central, single source of truth for turning an Order's contractor
// (builder) + site context into a human-readable enquiry ID of the form:
//
//   <CONTRACTOR_CODE>-<SITE_CODE>-<SEQUENCE>
//
//   e.g. "ABC-SITE01-000123"
//
// IMPORTANT: this is a purely additive, DISPLAY-ONLY identifier stored in
// the new `Order.enquiryId` column. `Order.id` (the existing cuid primary
// key) remains the real database identifier, FK target, API path segment,
// and URL param for every order — nothing about it changes. Every caller
// that creates an Order (apps/web/lib/order-checkout.ts,
// apps/api/src/builder/orders/orders.service.ts,
// apps/api/src/aggregation/aggregation.service.ts) MUST go through
// `generateEnquiryId()` below instead of duplicating any of this logic.
//
// Concurrency safety: `nextEnquirySequence()` takes a row lock
// (`SELECT ... FOR UPDATE`) on the single `EnquirySequence` row and MUST be
// called from inside the same `prisma.$transaction` that creates the
// Order row, exactly mirroring the existing `lockPoolRow` pattern in
// apps/api/src/aggregation/aggregation.service.ts. This guarantees the
// numeric sequence is unique and strictly increasing across every
// contractor/site combination, never resetting per-contractor or per-site.

const SEQUENCE_PADDING = 6;

// A transaction client exposes the same `$queryRaw`/model delegates as the
// full PrismaClient, but typing it precisely would require importing
// `Prisma.TransactionClient` from the generated client in every caller.
// Using a minimal structural type here (mirroring the existing `tx: any`
// convention in aggregation.service.ts's `lockPoolRow`) keeps this helper
// framework-agnostic and usable from both apps/api (NestJS) and apps/web
// (Next.js route handlers), which use two independently-instantiated
// PrismaClients (see packages/db/index.ts).
type TxClient = {
  $queryRaw: (...args: any[]) => Promise<any>;
  enquirySequence: {
    update: (args: any) => Promise<{ value: number }>;
  };
};

/**
 * Normalizes arbitrary free text into an uppercase, alphanumeric-only code,
 * truncated to `maxLength`. Used for both the contractor and site code
 * fallback derivations below. Never returns an empty string for non-empty
 * input containing at least one alphanumeric character.
 */
function slugifyCode(input: string, maxLength: number): string {
  const cleaned = input
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return cleaned.slice(0, maxLength);
}

/**
 * Resolves (and, if necessary, lazily assigns) a stable, immutable
 * contractor code for the given builder User row.
 *
 * - If `builderCode` is already set, it is returned unchanged (stability
 *   for historical enquiries — the code must NEVER change once assigned,
 *   even if the builder later edits their name).
 * - Otherwise a code is derived once from the builder's current name/email
 *   (never from anything that changes per-enquiry) and persisted back onto
 *   the User row so every subsequent enquiry reuses the exact same code.
 * - Collisions against another builder's code are resolved deterministically
 *   by appending digits derived from the builder's own id — this still
 *   never changes once first assigned.
 *
 * Must be called from inside the same transaction that will create the
 * Order, using the transaction client, so the generated code is committed
 * atomically with the enquiry it first appears on.
 */
export async function resolveBuilderCode(
  tx: { user: { findUnique: (args: any) => Promise<any>; update: (args: any) => Promise<any> } },
  builderId: string,
  builderName: string | null | undefined,
  builderEmail: string | null | undefined
): Promise<string> {
  const existing = await tx.user.findUnique({
    where: { id: builderId },
    select: { builderCode: true },
  });
  if (existing?.builderCode) {
    return existing.builderCode;
  }

  const source = builderName?.trim() || builderEmail?.split("@")[0] || builderId;
  let base = slugifyCode(source, 3);
  if (!base) {
    base = slugifyCode(builderId, 3) || "BLD";
  }

  // Deterministic collision resolution: try the base code, then the base
  // code plus a 2-digit suffix derived from the builder's own id, widening
  // the suffix if that still collides. Never random, so this always
  // converges on the same final value for the same builder id.
  let candidate = base;
  let attempt = 0;
  while (true) {
    const clash = await tx.user
      .findUnique({ where: { builderCode: candidate } as any, select: { id: true } })
      .catch(() => null);
    if (!clash || clash.id === builderId) break;
    attempt += 1;
    candidate = `${base}${String(attempt).padStart(2, "0")}`;
  }

  const updated = await tx.user.update({
    where: { id: builderId },
    data: { builderCode: candidate },
    select: { builderCode: true },
  });

  return updated.builderCode!;
}

/**
 * Resolves (and, if necessary, lazily assigns) a stable site code for the
 * given Site row.
 *
 * - If `Site.code` is already set, it is normalized (uppercased,
 *   alphanumeric-only) and returned.
 * - If not set, a fallback code is derived ONCE from the site's own
 *   immutable `id` (never from the mutable `name`/address) and persisted
 *   back so it never changes afterwards.
 */
export async function resolveSiteCode(
  tx: { site: { findUnique: (args: any) => Promise<any>; update: (args: any) => Promise<any> } },
  siteId: string
): Promise<string> {
  const site = await tx.site.findUnique({
    where: { id: siteId },
    select: { code: true },
  });

  if (site?.code) {
    const normalized = slugifyCode(site.code, 10);
    if (normalized) return normalized;
  }

  const fallback = `SITE${slugifyCode(siteId, 6)}`;
  await tx.site.update({
    where: { id: siteId },
    data: { code: fallback },
  });
  return fallback;
}

/**
 * Atomically increments and returns the next global enquiry sequence
 * number. MUST be called from inside a `prisma.$transaction` callback —
 * takes a row lock on the single `EnquirySequence` row so concurrent
 * enquiry creation can never be handed the same sequence number twice
 * (mirrors the existing `lockPoolRow` SELECT ... FOR UPDATE pattern used
 * for AggregationPool in apps/api/src/aggregation/aggregation.service.ts).
 */
export async function nextEnquirySequence(tx: TxClient): Promise<number> {
  await tx.$queryRaw`SELECT "value" FROM "EnquirySequence" WHERE "id" = 'singleton' FOR UPDATE`;

  const updated = await tx.enquirySequence.update({
    where: { id: "singleton" },
    data: { value: { increment: 1 } },
    select: { value: true },
  });

  return updated.value;
}

/**
 * Formats the final, complete enquiry ID from its three parts.
 * Zero-pads the sequence to 6 digits (e.g. 123 -> "000123").
 */
export function formatEnquiryId(contractorCode: string, siteCode: string, sequence: number): string {
  const seq = String(sequence).padStart(SEQUENCE_PADDING, "0");
  return `${contractorCode}-${siteCode}-${seq}`;
}

export type GenerateEnquiryIdParams = {
  builderId: string;
  builderName: string | null | undefined;
  builderEmail: string | null | undefined;
  // Nullable: an enquiry created without a selected site (legacy/system
  // flows that don't require one — e.g. Quick Material Request or Group &
  // Save — see Phase 6 "Handling Missing Prefix Data") falls back to the
  // fixed "UNSITED" site-segment rather than inventing one from arbitrary
  // user input.
  siteId?: string | null;
};

const NO_SITE_CODE = "UNSITED";

/**
 * Generates a complete, unique, human-readable enquiry ID
 * ("<CONTRACTOR_CODE>-<SITE_CODE>-<SEQUENCE>") for a brand-new Order.
 *
 * MUST be called from inside the same `prisma.$transaction` that creates
 * the Order row, passing the transaction client as `tx`, so the resolved
 * builder/site codes and the incremented sequence are all committed
 * atomically with the enquiry itself.
 */
import { generateEnquiryNumber } from "./business-number";

export async function generateEnquiryId(tx: any, params?: GenerateEnquiryIdParams): Promise<string> {
  return generateEnquiryNumber(tx);
}
