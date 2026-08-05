/**
 * Determinism check for computeRawObservationDedupeHash (spec §2.4).
 *
 * Same convention as verify-pricing-fingerprint.js — packages/db has no test
 * framework configured, so this is a plain assert-based script. Run with:
 *
 *   node packages/db/scripts/verify-pricing-dedupe-hash.js
 */

const assert = require("assert");
const {
  computeRawObservationDedupeHash,
} = require("../lib/pricing-dedupe-hash");

function run() {
  const input = {
    sourceId: "src_agni_steels",
    sourceUrl: "https://agnisteels.com/pricing.php",
    rawSkuLabel: "Fe 500D 12mm",
    rawPriceText: "₹58,500/MT",
    rawUnitText: "MT",
    rawLocationText: "Chennai",
    rawAsOfText: "05-Aug-2026",
  };

  // 1. Deterministic across repeated calls / equivalent objects.
  const h1 = computeRawObservationDedupeHash(input);
  const h2 = computeRawObservationDedupeHash(input);
  const h3 = computeRawObservationDedupeHash({ ...input });
  assert.strictEqual(h1, h2, "dedupeHash must be deterministic across calls");
  assert.strictEqual(
    h1,
    h3,
    "dedupeHash must be deterministic across equivalent-but-distinct objects"
  );
  assert.match(h1, /^[a-f0-9]{64}$/, "dedupeHash must be a 64-char hex sha256 digest");

  // 2. An unchanged re-scrape (identical extracted text) produces the same
  //    hash even if whitespace/case differ slightly on the page.
  const hRescrape = computeRawObservationDedupeHash({
    ...input,
    rawPriceText: " ₹58,500/MT ",
    rawLocationText: "CHENNAI",
  });
  assert.strictEqual(
    h1,
    hRescrape,
    "an unchanged page (modulo whitespace/case) must dedupe to the same hash"
  );

  // 3. A genuinely changed price must produce a different hash.
  const hChangedPrice = computeRawObservationDedupeHash({
    ...input,
    rawPriceText: "₹59,000/MT",
  });
  assert.notStrictEqual(
    h1,
    hChangedPrice,
    "a changed rawPriceText must change the dedupeHash"
  );

  // 4. sourceId / sourceUrl are required.
  assert.throws(
    () => computeRawObservationDedupeHash({ ...input, sourceId: "" }),
    /sourceId/,
    "must throw when sourceId is missing/empty"
  );
  assert.throws(
    () => computeRawObservationDedupeHash({ ...input, sourceUrl: "" }),
    /sourceUrl/,
    "must throw when sourceUrl is missing/empty"
  );

  console.log("All pricing dedupe-hash determinism checks passed.");
}

run();
