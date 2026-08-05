/**
 * Deterministic fingerprint for PricingCanonicalSku (spec §2.3).
 *
 * sha256 over the lowercased/trimmed/pipe-joined non-null components of the
 * SKU's identity fields, in a fixed order:
 *   materialCategoryId | brandId | grade | sizeMm | sizeLabel | packLabel
 *
 * Null/undefined components are encoded as an empty segment (not skipped),
 * so the field position is always preserved in the joined string — this
 * prevents e.g. { grade: null, sizeMm: 12 } and { grade: "12", sizeMm: null }
 * from ever producing the same fingerprint by accident.
 *
 * This must stay pure and framework-free: it is called both from seed/ingest
 * scripts (plain Node, no ts-node) and, later, from ingestion pipeline code.
 */

const crypto = require("crypto");

/**
 * @param {{
 *   materialCategoryId: string,
 *   brandId?: string | null,
 *   grade?: string | null,
 *   sizeMm?: number | string | null,
 *   sizeLabel?: string | null,
 *   packLabel?: string | null,
 * }} fields
 * @returns {string} 64-char hex sha256 digest
 */
function computeCanonicalSkuFingerprint(fields) {
  if (!fields || typeof fields !== "object") {
    throw new Error("computeCanonicalSkuFingerprint requires a fields object");
  }
  if (!fields.materialCategoryId) {
    throw new Error(
      "computeCanonicalSkuFingerprint requires a non-empty materialCategoryId"
    );
  }

  const normalize = (value) => {
    if (value === null || value === undefined) return "";
    return String(value).trim().toLowerCase();
  };

  const orderedComponents = [
    fields.materialCategoryId,
    fields.brandId,
    fields.grade,
    fields.sizeMm,
    fields.sizeLabel,
    fields.packLabel,
  ].map(normalize);

  const joined = orderedComponents.join("|");

  return crypto.createHash("sha256").update(joined, "utf8").digest("hex");
}

module.exports = { computeCanonicalSkuFingerprint };
