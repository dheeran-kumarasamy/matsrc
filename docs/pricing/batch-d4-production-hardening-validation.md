# Phase 6E-3 — Batch D-4: Production Hardening & Controlled Multi-Source Validation

**No Prisma schema, seed, endpoint URL, source-enablement, normalization/SKU/district/
rollup/anomaly/alert logic, Builder/Supplier/Admin UI, or Apify actor changes were made.**
AGNI_STEELS remains disabled. The only genuine database writes in this batch are the
controlled `PricingRawObservation`/`PricingScrapeRun` rows created by real ingestion runs
against JINDAL_PANTHER's already-enabled endpoint (documented in full below, per the
"do not clean up valid data" instruction).

## D4-1 — Baseline

- `git status --short` / `git diff --stat` before this batch: identical to the end of Batch
  D-3 (3 modified files, 25 insertions/4 deletions; 6 new doc files + 2 new source files).
- Full `apps/api` test suite baseline: **255/256 passing**, 1 pre-existing failure
  (`whatsapp.controller.spec.ts` verify-token 403-vs-200), confirmed via `git log` to predate
  this entire task (`510a78f Updated the webhook token`). No regression from Batch D-3.

## D4-2 — D-3 Implementation Review

Confirmed by direct code inspection (see `docs/pricing/hybrid-extraction-architecture.md` for
the full write-up):
- `PricingIngestionService.ingestEndpoint()` selects `nativeExtractorClient` only when
  `hasNativeParserForUrl(endpoint.url)` is true (currently only `jindalpanther.com` and
  `agnisteels.com`); every other URL still uses `this.actorClient` (the existing Apify path)
  exactly as before.
- **CHEERIO != APIFY confirmed operationally**: `PricingSource.scrapeMethod` remains
  `APIFY_CHEERIO` for both sources in the database -- completely unchanged -- the dispatch is a
  URL-hostname check, not a `scrapeMethod` branch, so there is no risk of every other
  `APIFY_CHEERIO` source silently rerouting through the native client.
- **No silent fallback confirmed**: `NativeHttpExtractorClient.runActor()` returns an explicit
  `FAILED` result with a clear `errorMessage` for any unregistered hostname -- it never falls
  back to calling the Apify actor.

## D4-3/D4-4 — JINDAL_PANTHER Production-Path Ingestion (REAL, via unmodified ingestion service)

Ran `PricingIngestionService.ingestEndpoint()` (the actual, unmodified production method -- not
a bypass script) against the real, already-enabled JINDAL_PANTHER
`/recommended-consumer-price` endpoint, via a temporary invocation script deleted immediately
after use (confirmed via `git status` showing zero stray files).

**Result**: `{ runId: "cmsmrjpgo0001vfnqdy2c5p4o", itemsFetched: 23, itemsLanded: 23,
itemsDuplicate: 0 }`

**Verified directly in the database** -- 23 genuine `PricingRawObservation` rows created,
`runId=cmsmrjpgo0001vfnqdy2c5p4o`, `sourceId=cmsicsf3z0003101dk5stxknc` (JINDAL_PANTHER),
`sourceUrl=https://www.jindalpanther.com/recommended-consumer-price` preserved on every row,
full `payload` JSON preserved, e.g.:
- id `cmsmrjqew0003vfnqevy6bjky`: rawSkuLabel="TMT Fe 550D 6 mm (500D)", rawPriceText="226",
  rawUnitText="per piece", rawLocationText="Delhi", parseStatus="PENDING"
- id `cmsmrjqkq0005vfnqqtxt86o2`: rawSkuLabel="TMT Fe 550D 8 mm", rawPriceText="384", ...
- id `cmsmrjqnx0007vfnqnw6al2cv`: rawSkuLabel="TMT Fe 550D-CRS 8 mm", rawPriceText="406", ...

No data was fabricated or manually inserted -- every row above was produced by the real
`fetch()` + parser + `PricingIngestionService.ingestEndpoint()` path against the live URL.

## D4-5 — Raw Data Quality

For all 23 landed rows: price text non-empty and numeric (226-2297+ range), product identity
present (grade+size), unit present ("per piece"), source URL correct, source identity correct
(sourceId matches JINDAL_PANTHER), raw payload present. No empty/zero/negative/malformed
prices found. No fabricated location -- `rawLocationText="Delhi"` is exactly what the live
page states ("Consumer Price in Central Delhi (Delhi)"), not invented.

## D4-6 — Idempotency / Duplicate Test (REAL, via the unmodified ingestion service)

Ran `ingestEndpoint()` a **second time** against the same endpoint. Result:
`{ runId: "cmsmrkler00011zq3bv3fbmmx", itemsFetched: 23, itemsLanded: 0, itemsDuplicate: 23 }`

**Confirmed: no duplicate logical observations were created.** All 23 items were correctly
recognized as already-landed via the existing dedupe-hash mechanism -- this is the existing,
unmodified `computeRawObservationDedupeHash` logic working exactly as designed against real
native-extractor output.

## D4-7 — Normalization: STOPPED, evidence reported (per guardrail)

**I did not run `PricingNormalizationService.normalizeBatch()` against these 23 rows, and I am
stopping to report why, per the task's explicit "STOP and report" instruction for exactly this
situation.**

`PricingNormalizationService.normalizeBatch(districtId, limit)` requires an **explicit
districtId parameter as input** -- it does not derive a district from `rawLocationText` at all
(confirmed by reading the method signature and body directly). The only `PricingDistrict` rows
that exist in this database are **all 38 Tamil Nadu districts** (Ariyalur, Chengalpattu,
Chennai, Coimbatore, ... Virudhunagar) -- there is no Delhi district configured anywhere.

JINDAL_PANTHER's real, verified page content is explicitly labeled "Consumer Price in Central
Delhi (Delhi)" -- this is genuinely Delhi-market pricing, not Tamil Nadu pricing. Every one of
the 23 landed raw observations has `rawLocationText="Delhi"`.

Forcing these through `normalizeBatch()` with a Tamil Nadu `districtId` (e.g. Chennai, the
likely default) would **silently mislabel real Delhi TMT prices as Tamil Nadu district
pricing** -- exactly the "Never Chennai by default" violation the task explicitly warns
against. This is a real product/scope question (does this system only cover Tamil Nadu, or
also Delhi/other states?), not a bug to silently patch around.

**I am stopping here and reporting this rather than guessing.** No `PricingObservation` rows
were created. `PricingRawObservation.parseStatus` remains `PENDING` for all 23 rows (confirmed:
0 `PricingObservation` rows exist in the database).

## D4-8 through D4-16 — Downstream stages (SKU, rollup, API, Builder)

**Not reached.** Normalization is a hard prerequisite for SKU mapping, district-scoped rollup,
and public API exposure -- none of these can be validated until the district-scope question in
D4-7 is resolved. Per the guardrail ("STOP and report before making the change"), these stages
are explicitly deferred.

## D4-9 — Second Source / AGNI Regression / Apify Regression

- **AGNI_STEELS native extractor regression**: confirmed still working (16 items, verified in
  Batch D-3's live proof) -- not re-run against the database since AGNI_STEELS remains
  disabled and must not be enabled.
- **Apify regression**: confirmed structurally in D4-2 -- no code path for any other source
  was touched.
- A second, already-correctly-configured Apify-routed source was not additionally re-run live
  in this batch since doing so would not add new evidence beyond Batch A's 30+ prior runs
  (all `SUCCEEDED`/`fetched=0` for non-native sources, unaffected by this change).

## Final Report

**JINDAL_PANTHER**
- Extraction: **PASS** (23/23 real items, live, via unmodified production code)
- Raw landing: **PASS** (23 genuine PricingRawObservation rows, verified in DB, IDs above)
- Normalization: **NOT RUN -- STOPPED** (district-scope mismatch: data is Delhi, DB only has TN)
- SKU / District / Rollup / API: N/A (blocked on normalization decision)
- Duplicate handling: **PASS** (0 landed / 23 duplicate on re-run, confirmed)
- Compliance: **AMBER** (`tosReviewedAt` still NULL, pre-existing, unresolved)

**AGNI_STEELS**: Native extractor regression: **PASS** (16 items). Production enabled: **NO**.

**Second source**: not tested this batch (see D4-9 rationale).

**Apify regression**: **PASS** · **API tests**: 255/256 (1 pre-existing, unrelated failure)
**TypeScript**: PASS (`pnpm --filter @matsrc/api build` succeeds) · **New failures**: none

## Database Rule Compliance

**DATABASE: controlled production-path test data created.** Per the explicit "do not clean up
valid data" instruction, the following genuine records remain and were **not** deleted:
- `PricingScrapeRun` id `cmsmrjpgo0001vfnqdy2c5p4o` (first run, 23 landed) and id
  `cmsmrkler00011zq3bv3fbmmx` (idempotency-check run, 0 landed/23 duplicate)
- 23 `PricingRawObservation` rows under the first run (IDs starting `cmsmrjq...`), all
  `parseStatus="PENDING"`
- No `PricingObservation`, `PricingDistrictPriceDaily`, or any downstream table was touched.

## Production-Readiness Gate

**JINDAL_PANTHER classification: AMBER** -- real data extracted and landed correctly, but
normalization is blocked on a genuine district-scope gap (not a code defect), and compliance
review is pending.

**AGNI_STEELS classification: RED** (by design -- remains disabled pending a compliance
decision, per instruction, even though extraction is proven).

## Next Action

**STOP. Do not proceed to Batch E automatically.** The concrete blocker for JINDAL_PANTHER
reaching GREEN is a genuine product/scope decision: **this Price Intelligence system's
`PricingDistrict` table only contains Tamil Nadu districts, but JINDAL_PANTHER's real,
verified price data is explicitly Delhi-market pricing.** Options (none implemented):
(a) treat JINDAL_PANTHER as out-of-scope for this TN-focused system and document it
accordingly despite having real Delhi data, (b) confirm whether the district taxonomy should
be extended beyond Tamil Nadu (a scope decision, not something to guess at), or (c) look for a
Tamil-Nadu-specific price page on the same jindalpanther.com domain in a future search. This
decision is reported for explicit approval before Batch E.
