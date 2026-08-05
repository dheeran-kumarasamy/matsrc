/**
 * Deterministic dedupe hash for PricingRawObservation (spec §2.4, see the
 * `dedupeHash` field comment on PricingRawObservation in schema.prisma).
 *
 * sha256 over the pipe-joined (sourceId, sourceUrl, rawSkuLabel, rawPriceText,
 * rawUnitText, rawLocationText, rawAsOfText), in that fixed order. Makes
 * re-runs idempotent: re-scraping a page whose extracted fields have not
 * changed produces the same hash, so the ingestion service can skip
 * inserting a duplicate row.
 *
 * Deliberately mirrors packages/db/lib/pricing-fingerprint.js: pure,
 * framework-free, no Prisma import, so it can be required from plain Node
 * scripts (seed/backfill tooling) as well as from the NestJS ingestion
 * service in apps/api without pulling in a second implementation that could
 * drift out of sync.
 *
 * Null/undefined components are encoded as an empty segment (not skipped),
 * preserving field position — same rationale as the SKU fingerprint.
 */

const crypto = require("crypto");

/**
 * @param {{
 *   sourceId: string,
 *   sourceUrl: string,
 *   rawSkuLabel?: string | null,
 *   rawPriceText?: string | null,
 *   rawUnitText?: string | null,
 *   rawLocationText?: string | null,
 *   rawAsOfText?: string | null,
 * }} fields
 * @returns {string} 64-char hex sha256 digest
 */
function computeRawObservationDedupeHash(fields) {
  if (!fields || typeof fields !== "object") {
    throw new Error("computeRawObservationDedupeHash requires a fields object");
  }
  if (!fields.sourceId) {
    throw new Error("computeRawObservationDedupeHash requires a non-empty sourceId");
  }
  if (!fields.sourceUrl) {
    throw new Error("computeRawObservationDedupeHash requires a non-empty sourceUrl");
  }

  // sourceId/sourceUrl are identifiers, not free text — preserve as-is aside
  // from trimming. The raw*Text fields are scraped strings, so they get the
  // same casefold/trim normalization as the SKU fingerprint to avoid
  // spurious "new" rows caused only by whitespace/case noise in re-scrapes.
  const normalizeIdentifier = (value) => String(value).trim();
  const normalizeText = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).trim().toLowerCase();
  };

  const orderedComponents = [
    normalizeIdentifier(fields.sourceId),
    normalizeIdentifier(fields.sourceUrl),
    normalizeText(fields.rawSkuLabel),
    normalizeText(fields.rawPriceText),
    normalizeText(fields.rawUnitText),
    normalizeText(fields.rawLocationText),
    normalizeText(fields.rawAsOfText),
  ];

  const joined = orderedComponents.join("|");

  return crypto.createHash("sha256").update(joined, "utf8").digest("hex");
}

module.exports = { computeRawObservationDedupeHash };
