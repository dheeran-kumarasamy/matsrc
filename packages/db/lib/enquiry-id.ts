// packages/db/lib/enquiry-id.ts
//
// Consolidated Enquiry ID generation.
//
// Central, single source of truth for turning an Order's contractor
// (builder) + selected-site context into a human-readable enquiry ID of
// the form:
//
//   <FIRSTNAME3>-<SITENAME5>-<CITY3><RANDOM1>-<SERIAL5>
//
//   e.g. "RAJ-CHENN-CHE7-00123"
//
// Meaning:
//   RAJ    -> first 3 letters of the builder/contractor's first name
//   CHENN  -> first 5 alphanumeric characters of the SELECTED site's name
//   CHE    -> first 3 letters of the selected site's city (if known)
//   7      -> a single, server-generated random alphanumeric character
//   00123  -> the global, monotonically-increasing 5-digit enquiry serial
//
// If the selected site has no city on file, the entire 4-character third
// component is generated randomly instead (e.g. "X7K2") rather than
// inventing/inferring a city from any other source.
//
// IMPORTANT: this is a purely additive, DISPLAY-ONLY identifier stored in
// the `Order.enquiryId` column (Postgres TEXT, unbounded -- already large
// enough for the 20-character maximum this format can produce, so no
// migration is required). `Order.id` (the existing cuid primary key)
// remains the real database identifier, FK target, API path segment, and
// URL param for every order -- nothing about it changes. Every caller that
// creates an Order (apps/web/lib/order-checkout.ts,
// apps/api/src/builder/orders/orders.service.ts,
// apps/api/src/aggregation/aggregation.service.ts) MUST go through
// `generateEnquiryId()` below instead of duplicating any of this logic.
//
// Existing (pre-migration) enquiry IDs using the previous
// "<CONTRACTOR_CODE>-<SITE_CODE>-<SEQUENCE>" format are NEVER rewritten by
// this module -- they continue to be read back and displayed exactly as
// stored. Only brand-new enquiries use this new format.
//
// Concurrency safety: `nextEnquirySequence()` takes a row lock
// (`SELECT ... FOR UPDATE`) on the single `EnquirySequence` row and MUST
// be called from inside the same `prisma.$transaction` that creates the
// Order row, exactly mirroring the existing `lockPoolRow` pattern in
// apps/api/src/aggregation/aggregation.service.ts. This guarantees the
// numeric serial is unique and strictly increasing across every
// contractor/site/city combination, never resetting per-contractor,
// per-site, per-city, or per-random-value.

import { randomInt } from "crypto";

const SERIAL_PADDING = 5;
const SERIAL_MAX = 10 ** SERIAL_PADDING - 1; // 99999

const RANDOM_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

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
 * Keeps only alphabetic characters, uppercases, trims, and truncates to
 * `maxLength`. Used for the first-name and city components, which the
 * spec requires to be alphabetic-only.
 */
function extractAlpha(input: string | null | undefined, maxLength: number): string {
  const cleaned = (input ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  return cleaned.slice(0, maxLength);
}

/**
 * Keeps only alphanumeric characters, uppercases, trims, and truncates to
 * `maxLength`. Used for the site-name component, which the spec allows to
 * be alphanumeric.
 */
function extractAlphaNumeric(input: string | null | undefined, maxLength: number): string {
  const cleaned = (input ?? "")
    .trim()
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
  return cleaned.slice(0, maxLength);
}

/**
 * Deterministically pads a too-short code out to exactly `targetLength`
 * using characters derived from `seed` (an immutable identifier -- e.g.
 * the builder's or site's own database id) rather than inventing
 * arbitrary data, so the same input always produces the same padded code.
 * Never returns a malformed (too-short) code.
 */
function padDeterministic(value: string, targetLength: number, seed: string): string {
  if (value.length >= targetLength) return value.slice(0, targetLength);
  const seedFill = extractAlphaNumeric(seed, targetLength);
  let combined = value + seedFill;
  // Extremely unlikely (seed would need to contain zero alphanumeric
  // characters), but guarantee a well-formed, fixed-length code no matter
  // what: repeat-pad with a fixed deterministic filler as a last resort.
  while (combined.length < targetLength) combined += "X";
  return combined.slice(0, targetLength);
}

/**
 * Resolves the 3-character `AAA` first-name component from the builder's
 * actual first name associated with the enquiry (trimmed, letters only,
 * uppercased, first 3 characters).
 *
 * Fallback (fewer than 3 valid letters available): deterministically pads
 * using the builder's own immutable user id -- never the email address as
 * the primary source (the local-part of the email is only used, per the
 * existing application convention, as the secondary source for a display
 * name) and never a random/invented value.
 */
export function resolveFirstNameCode(
  builderName: string | null | undefined,
  builderEmail: string | null | undefined,
  builderId: string
): string {
  const source = builderName?.trim() || builderEmail?.split("@")[0] || "";
  const code = extractAlpha(source, 3);
  return padDeterministic(code, 3, builderId);
}

/**
 * Resolves the 5-character `BBBBB` site-name component from the name of
 * the site actually selected for this enquiry (trimmed, alphanumeric
 * only, uppercased, first 5 characters).
 *
 * Fallback (fewer than 5 valid characters available, or no site name at
 * all -- e.g. legacy flows such as Quick Material Request / Group & Save
 * that don't require a selected site): deterministically pads/derives
 * using the site's own immutable id, or the fixed "UNSITED" placeholder
 * seed when there is no site at all -- never invented from arbitrary data.
 */
export function resolveSiteNameCode(siteName: string | null | undefined, siteSeed: string): string {
  const code = extractAlphaNumeric(siteName, 5);
  return padDeterministic(code, 5, siteSeed);
}

/**
 * Resolves the 3-character city portion of the `CCCC` component from the
 * selected site's own city field (trimmed, letters only, uppercased,
 * first 3 characters). Returns `null` when the site has no usable city
 * information -- callers MUST then generate the entire 4-character
 * component randomly (see `generateCityRandomComponent`) rather than
 * inventing or inferring a city from any other source (builder address,
 * browser location, free-text entry, etc.).
 */
export function resolveCityCode(city: string | null | undefined): string | null {
  const code = extractAlpha(city, 3);
  return code.length === 3 ? code : null;
}

/**
 * Generates a single cryptographically-secure, uppercase alphanumeric
 * character, server-side, using Node's `crypto.randomInt` (already the
 * project's existing secure-random primitive -- see
 * apps/web/lib/contact-verification/otp.ts). Never derived from the
 * timestamp, user id, site id, or serial number, so it can never be
 * predicted from any of that data.
 */
export function generateRandomAlphanumericChar(): string {
  return RANDOM_CHARSET[randomInt(0, RANDOM_CHARSET.length)];
}

/**
 * Generates `count` cryptographically-secure, uppercase alphanumeric
 * characters (see `generateRandomAlphanumericChar`).
 */
export function generateRandomAlphanumericChars(count: number): string {
  let result = "";
  for (let i = 0; i < count; i += 1) {
    result += generateRandomAlphanumericChar();
  }
  return result;
}

/**
 * Builds the complete 4-character `CCCC` component: `CITY3 + RANDOM1`
 * when the selected site has a usable city, or a fully random
 * 4-character value when it does not (see `resolveCityCode`).
 */
export function generateCityRandomComponent(city: string | null | undefined): string {
  const cityCode = resolveCityCode(city);
  if (cityCode) {
    return `${cityCode}${generateRandomAlphanumericChar()}`;
  }
  return generateRandomAlphanumericChars(4);
}

/**
 * Atomically increments and returns the next global enquiry serial
 * number. MUST be called from inside a `prisma.$transaction` callback --
 * takes a row lock on the single `EnquirySequence` row so concurrent
 * enquiry creation can never be handed the same serial number twice
 * (mirrors the existing `lockPoolRow` SELECT ... FOR UPDATE pattern used
 * for AggregationPool in apps/api/src/aggregation/aggregation.service.ts).
 * The serial is global -- it is never reset by contractor, site, city, or
 * random value.
 *
 * Throws if the sequence would exceed the 5-digit serial's maximum value
 * of 99999, rather than silently truncating/reusing serials or emitting
 * an invalid 6-digit serial. If this is ever hit in production, the
 * 5-digit serial format must be revisited (e.g. widened) as an explicit,
 * separate change -- never worked around here.
 */
export async function nextEnquirySequence(tx: TxClient): Promise<number> {
  await tx.$queryRaw`SELECT "value" FROM "EnquirySequence" WHERE "id" = 'singleton' FOR UPDATE`;

  const updated = await tx.enquirySequence.update({
    where: { id: "singleton" },
    data: { value: { increment: 1 } },
    select: { value: true },
  });

  if (updated.value > SERIAL_MAX) {
    throw new Error(
      `Enquiry serial ${updated.value} exceeds the 5-digit serial capacity (max ${SERIAL_MAX}). ` +
        "Refusing to truncate or reuse serial numbers -- the serial format must be widened as an explicit change."
    );
  }

  return updated.value;
}

/**
 * Formats the final, complete enquiry ID from its four parts:
 * "<FIRSTNAME3>-<SITENAME5>-<CITYRANDOM4>-<SERIAL5>", e.g.
 * "RAJ-CHENN-CHE7-00123". Zero-pads the serial to 5 digits.
 */
export function formatEnquiryId(
  firstNameCode: string,
  siteNameCode: string,
  cityRandomComponent: string,
  serial: number
): string {
  const paddedSerial = String(serial).padStart(SERIAL_PADDING, "0");
  return `${firstNameCode}-${siteNameCode}-${cityRandomComponent}-${paddedSerial}`;
}

export type GenerateEnquiryIdParams = {
  builderId: string;
  builderName: string | null | undefined;
  builderEmail: string | null | undefined;
  // Nullable: an enquiry created without a selected site (legacy/system
  // flows that don't require one -- e.g. Quick Material Request or Group
  // & Save) falls back to the fixed "UNSITED" site-name seed and a fully
  // random 4-character third component, rather than inventing a
  // site/city from arbitrary user input.
  siteId?: string | null;
};

const NO_SITE_SEED = "UNSITED";

/**
 * Generates a complete, unique, human-readable enquiry ID
 * ("<FIRSTNAME3>-<SITENAME5>-<CITY3><RANDOM1>-<SERIAL5>") for a brand-new
 * Order, using the builder/contractor's actual first name and the SITE
 * ACTUALLY SELECTED for this enquiry (never the builder's
 * default/first/active site).
 *
 * MUST be called from inside the same `prisma.$transaction` that creates
 * the Order row, passing the transaction client as `tx`, so the resolved
 * builder/site/city data and the incremented serial are all committed
 * atomically with the enquiry itself.
 */
export async function generateEnquiryId(tx: any, params: GenerateEnquiryIdParams): Promise<string> {
  const site = params.siteId
    ? await tx.site.findUnique({
        where: { id: params.siteId },
        select: { name: true, city: true },
      })
    : null;

  const firstNameCode = resolveFirstNameCode(params.builderName, params.builderEmail, params.builderId);
  const siteNameCode = resolveSiteNameCode(site?.name ?? null, params.siteId ?? NO_SITE_SEED);
  const cityRandomComponent = generateCityRandomComponent(site?.city ?? null);
  const serial = await nextEnquirySequence(tx);

  return formatEnquiryId(firstNameCode, siteNameCode, cityRandomComponent, serial);
}
