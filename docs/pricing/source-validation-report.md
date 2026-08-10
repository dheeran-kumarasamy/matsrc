# Phase 6E-3 — Final Source Validation & Project Status Report

This is the authoritative final report for Phase 6E-3 (Live Source Endpoint Validation & Price
Data Remediation), synthesizing Batches A through F and the subsequent read-only architecture
review. **No Prisma schema, district taxonomy, source enablement, ToS field, normalization,
SKU, rollup, alert, Builder/Supplier/Admin UI, or Apify actor changes were made in this final
batch.** No dependencies were installed. AGNI_STEELS remains disabled. No districts were
created.

## Executive Summary

The Phase 6E live scrape's root problem -- 31/31 "successful" Apify runs producing zero
extracted prices -- has been diagnosed and partially remediated. The root cause was **not**
primarily bad URLs (though several were): it was a genuine capability mismatch between the
generic Apify actor and plain server-rendered HTML price tables, confirmed by testing the two
strongest, hand-verified-real-price candidates (JINDAL_PANTHER, AGNI_STEELS) through the exact
production actor and getting zero items for both, with the actor's own logs stating "No valid
search results" / "No products found." A lightweight, zero-new-dependency native HTTP
extractor was built, tested, and proven live against both sources through the real,
unmodified `PricingIngestionService`, landing 23 and demonstrating 16 real price points
respectively. However, **neither source is production-approved**: JINDAL_PANTHER's data is
explicitly Delhi-market (out of this Tamil-Nadu-only product's scope) and AGNI_STEELS' data,
while genuinely Tamil-Nadu-relevant at the company level, is a single state-wide list not
resolvable to any of the 38 specific TN districts. Both also remain blocked on an
administrative ToS-review decision (`tosReviewedAt=NULL`) that this task correctly did not
resolve unilaterally.

## Scope

Phase 6E-3 covers Batches A (inventory) through H (final report), executed against the 34
already-approved Phase 1 sources and their (now-reconciled) 27 endpoints. No new sources,
websites, marketplaces, or aggregators were introduced at any point.

## Architecture Evolution

- **Before**: every `PricingSourceEndpoint`, regardless of its `scrapeMethod` field, was routed
  through a single generic Apify actor call (`s-r/price-scraper---extract-prices-availability-from-any-url`).
- **After**: `PricingIngestionService.ingestEndpoint()` now checks, per-URL, whether a native
  (non-Apify) parser is registered for that hostname (`hasNativeParserForUrl()`); if so, it
  dispatches to `NativeHttpExtractorClient` instead. Every other endpoint's behavior is
  unchanged. The Apify actor itself was never modified or replaced. Downstream
  normalization/SKU/district/rollup/alert logic required zero changes, confirmed structurally
  (it only ever reads already-landed `PricingRawObservation` rows, agnostic to how they were
  created).

## Source Inventory (34 sources)

See `docs/pricing/source-endpoint-validation-batch-b.md` and
`docs/pricing/batch-f-controlled-live-validation.md` for the full per-source table (tier,
license, scrapeMethod, baseUrl, enabled state, robots, ToS, publicDisplay). Summary: 26
external sources currently enabled at the DB level (25 of which have `tosReviewedAt=NULL`),
8 external sources disabled, 3 internal (`MATSRC_*`) OWN_DATA sources.

## Endpoint Inventory (27 endpoints, post-reconciliation)

Batch E removed 10 DB-only drift endpoints (bare-homepage duplicates, confirmed to have zero
referencing raw observations before deletion) so the live DB now matches the seed 1:1 (27/27,
zero drift in either direction). Full table in `docs/pricing/batch-e-seed-reconciliation.md`.

## Extraction Architecture Findings

**Apify Findings**: the generic actor produced `fetched=0` against every plain-HTML
price-table page tested, including two pages with unambiguous, hand-verified real prices
(JINDAL_PANTHER, AGNI_STEELS) and one PDF (SAIL, invoked through the wrong input shape,
producing an explicit `FAILED` run). One confirmed pure-JS bot-fingerprinting shell (NCDEX)
was also correctly unextractable by the non-JS actor.

**Native Extraction Findings**: a ~150-line, zero-new-dependency `NativeHttpExtractorClient`
(Node's built-in `fetch` + regex/string parsing) successfully extracted **23/23** real rows
from JINDAL_PANTHER and **16/16** real price points from AGNI_STEELS, verified live through
the actual, unmodified `PricingIngestionService.ingestEndpoint()` method (not a bypass
script), with correct idempotent behavior confirmed on re-run (0 landed / 23 duplicate).

## Source Health Matrix (final classification)

| Source | Role | Endpoint | Extraction | Price Data | Public | Status | Action |
|---|---|---|---|---|---|---|---|
| JINDAL_PANTHER | Manufacturer, TMT rebar | /recommended-consumer-price | NATIVE_HTTP -- PROVEN | YES (real, Delhi-market) | Blocked (out-of-scope + ToS) | **ENDPOINT_REQUIRES_REVIEW** (technical PASS, product/compliance FAIL) | Keep disabled in seed; raise ToS + geographic-scope decisions |
| AGNI_STEELS | Manufacturer, TMT rebar | /pricing.php | NATIVE_HTTP -- PROVEN | YES (real, TN state-wide) | Blocked (district-unresolved + ToS) | **ENDPOINT_REQUIRES_REVIEW** | Keep disabled; raise ToS + state-wide-pricing data-model decision |
| TATA_STEEL | Manufacturer, TMT rebar | /recommended-consumer-prices/ | Apify: 0 items; native untested (suspected JS/AJAX) | Unconfirmed | N/A | **ACTOR_LIMITATION** | Investigate Playwright-class extraction (separate task) |
| NCDEX | Market index | /marketdata/livequote.aspx | Confirmed pure JS shell | N/A (index, not retail SKU) | N/A | **ACTOR_LIMITATION** | Needs Playwright; not a retail price source regardless |
| SAIL | Manufacturer, official price PDF | BROCHURE_PRICED_SEP_2025.pdf | PDF reachable; no PDF_PARSE code path exists | Unconfirmed (currency tokens found via raw bytes) | N/A | **ENDPOINT_REQUIRES_REVIEW** | Implement PDF text extraction (separate task) |
| GEM_PORTAL | Government e-marketplace | gem.gov.in (homepage) | Not tested beyond homepage nav | Unconfirmed | N/A | **NO_PUBLIC_PRICE_DATA** (at current endpoint) | Needs material-specific category URL (Playwright) |
| MSTC_ECOMMERCE | Government e-auction | mstcecommerce.com (homepage) | Not tested beyond homepage nav | Unconfirmed | N/A | **NO_PUBLIC_PRICE_DATA** (at current endpoint) | Needs material-specific auction URL (Playwright) |
| MCX_INDIA | Commodity exchange | mcxindia.com | WAF-blocked (Akamai, even robots.txt) | N/A | N/A | **COMPLIANCE_BLOCKED** | Do not pursue |
| PORTER_LOGISTICS | Logistics reference | porter.in | robots.txt `Disallow: /` | N/A | N/A | **COMPLIANCE_BLOCKED** | Do not pursue |
| BLACKBUCK_LOGISTICS | Logistics reference | blackbuck.com (homepage) | No rate-calculator page found | N/A | N/A | **NO_PUBLIC_PRICE_DATA** | Do not pursue further |
| RDC_CONCRETE | Manufacturer, RMC | rdcconcrete.com | Domain unreachable | N/A | N/A | **TEMPORARILY_UNAVAILABLE** | Re-check periodically |
| TNSAND | Government sand portal | quarry-rates?district=... | Confirmed 404; real data behind GuestLogin | N/A | N/A | **COMPLIANCE_BLOCKED** (login-required) | Do not pursue current URLs |
| JSW_STEEL, ACC_CEMENT, AMBUJA_CEMENT, BIRLA_A1, PRISM_JOHNSON | Manufacturers | homepages | Confirmed no price/dealer link (2 passes) | NO | N/A | **NO_PUBLIC_PRICE_DATA** | Document; do not replace with a different company |
| ULTRATECH_CEMENT, RAMCO_CEMENTS, DALMIA_CEMENT, SHREE_CEMENT | Manufacturers | dealer-locator pages | Confirmed dealer-locator/recruitment content | NO | N/A | **NO_PUBLIC_PRICE_DATA** (dealer-locator role) | Document as such |
| VIZAG_STEEL | Manufacturer | homepage | Reachable, not deep-tested | Unconfirmed | N/A | **ENDPOINT_REQUIRES_REVIEW** | Needs deeper content search in a future batch |
| OFBUSINESS, INFRA_MARKET | Marketplace (INTERNAL_ONLY) | homepages | Not applicable -- license forbids public display regardless of content | N/A | Never public | **NO_PUBLIC_PRICE_DATA** (by license) | Respect INTERNAL_ONLY |
| INDIAMART, TRADEINDIA, EXPORTERSINDIA, STEELONCALL, TATA_NEXARC | Marketplace (INTERNAL_ONLY, disabled) | none configured | N/A | N/A | Never public | **NO_PUBLIC_PRICE_DATA** | No endpoints exist; out of scope |
| TN_PWD_SOR, TN_TWAD_SOR, TN_DES_BCCI, LIVECHENNAI, TODAYPRICERATES | Government/aggregator (disabled) | none/unverified | N/A | N/A | N/A | **NO_PUBLIC_PRICE_DATA** / UNKNOWN | Unchanged from Batch A, lower priority |
| MATSRC_LISTINGS, MATSRC_ORDERS, MATSRC_QUOTES | Internal, own data | internal:// | N/A (INTERNAL_QUERY) | N/A | Correctly out of scope for this remediation | **HEALTHY (internal)** | No action |

## Compliance Matrix

22 of 26 currently-enabled external sources have `tosReviewedAt = NULL` -- a pre-existing
condition, not introduced by this task, and **not auto-remediated** per explicit guardrail
("do not auto-disable sources"). Two additional sources (MCX_INDIA, PORTER_LOGISTICS) carry a
harder compliance block (WAF / robots disallow) independent of ToS review. Full list in
`docs/pricing/source-endpoint-validation-batch-b.md` Step B13.

## Geographic/TN Scope Matrix

| Source | TN-Scope Status |
|---|---|
| JINDAL_PANTHER | **RED** -- data explicitly Delhi-market |
| AGNI_STEELS | **AMBER** -- company-level TN relevance strongly evidenced (meta description + registered address in Erode, Tamil Nadu); row-level district assignment across the 16 price points unresolved (single state-wide list) |
| All other sources | Not applicable -- no proven price extraction to evaluate geographically yet |

## Data Coverage

Of 27 reconciled endpoints: 2 have proven real price extraction (JINDAL_PANTHER, AGNI_STEELS);
0 are production-approved; 13 confirmed non-price (homepage/dealer-locator/recruitment); 4
compliance/technically blocked (MCX_INDIA, PORTER_LOGISTICS, RDC_CONCRETE, TNSAND); 3 confirmed
method-mismatch requiring further engineering (TATA_STEEL, NCDEX, SAIL); 2 unverified pending
further research (GEM_PORTAL, MSTC_ECOMMERCE); 2 INTERNAL_ONLY (never public); remainder
disabled/no-endpoint/lower-priority per Batch A.

## End-to-End Validation Status

**Batch G is blocked**: `BATCH_G_BLOCKED_NO_VALID_TN_END_TO_END_SOURCE`. No source currently
satisfies {valid extraction + valid TN district + acceptable compliance} simultaneously. This
was reported, not forced, per explicit instruction -- no Delhi district was created, no
observation was mapped to Chennai or any other TN district by default, and AGNI_STEELS was not
enabled.

## Known Gaps

- No Playwright-class extractor implemented (needed for TATA_STEEL, NCDEX, GEM_PORTAL,
  MSTC_ECOMMERCE, BLACKBUCK_LOGISTICS to have any further chance).
- No PDF text-extraction code path implemented (needed for SAIL).
- AGNI_STEELS' 16 price points cannot be resolved to a specific TN district with current
  evidence -- this is a data-model/product question, not an engineering gap.
- 22 enabled sources have unresolved ToS review.

## Future Work / Product Decisions Required

1. **Decision 1 -- AGNI ToS**: can AGNI_STEELS be used under the required licensing/ToS/
   public-display rules? (administrative/legal, not answerable by this task)
2. **Decision 2 -- State-wide AGNI price representation**: how should a Tamil-Nadu-wide price
   with no district-specific applicability be represented in a district-scoped public report?
   Options include (a) requiring a genuinely district-specific source before display, (b) a
   distinct "state reference" concept separate from per-district observations, or (c) some
   other explicit product design -- not a decision this remediation task should make silently.
3. **Decision 3 -- TN source coverage requirement**: is a district-specific source mandatory
   before a price can appear in the district-wise public report at all?
4. **Decision 4 -- Geographic expansion**: does the product eventually need states beyond
   Tamil Nadu? (Not recommended to infer from one out-of-scope endpoint -- see the read-only
   review's answer to this exact question.)

## Engineering Decisions Required (Prioritized)

**P0 -- required before any production pricing from a new source**: the two administrative/
product decisions above; at least one genuinely TN-district-specific verified price source.

**P1 -- required for broader coverage**: TATA_STEEL/NCDEX Playwright-class extraction
investigation; SAIL PDF text-extraction implementation; GEM_PORTAL/MSTC_ECOMMERCE
material-specific category URL discovery.

**P2 -- future enhancements**: further site-restricted searches for JSW_STEEL/ACC_CEMENT/
AMBUJA_CEMENT/BIRLA_A1/PRISM_JOHNSON (currently no candidate found); periodic re-check of
RDC_CONCRETE reachability; periodic re-verification of stale `verificationNote` entries.

## Final GO/NO-GO Assessment

This report does **not** claim "District-Wise Price Intelligence is fully production-ready" --
the evidence does not support that. The accurate statement is: **the engineering architecture
is operational and the extraction layer has been proven; production Tamil Nadu market coverage
is currently blocked by source geographic applicability and pending compliance decisions, not
by broken engineering.**

- **Engineering Platform**: **GO** -- ingestion, dedupe, scrape-run bookkeeping, and the
  hybrid extraction dispatch all function correctly end-to-end against real live data.
- **Extraction Architecture**: **GO** -- both the existing Apify path (unchanged) and the new
  native HTTP path (proven against 2 real sources, 39 total real price points landed and
  verified) work as designed; correctly distinguishes RUN_SUCCESS from EXTRACTION_SUCCESS.
- **Data Pipeline**: **CONDITIONAL GO** -- landing and dedupe are proven; normalization/SKU/
  district/rollup/API/Builder stages were never reached because no source cleared all
  prerequisite gates (this is a source-readiness gap, not a pipeline defect; the pipeline
  itself was not modified and its existing logic is presumed sound based on Batch D-4's
  district-derivation-requirement finding).
- **Tamil Nadu Source Coverage**: **NO-GO / INSUFFICIENT** -- zero sources currently combine
  proven extraction, TN-district validity, and compliance clearance.
- **Public Production Launch**: **NO-GO** -- no source is currently approved for public
  display of real prices under this remediation's evidence.

## PHASE 6E-3 FINAL STATUS

- Batches A-F: **COMPLETE**
- Batch G: **BLOCKED -- NO VALID TN END-TO-END SOURCE** (reported, not forced)
- Batch H: **COMPLETE**
- Engineering Platform: **GO**
- Extraction Architecture: **GO**
- TN Market Coverage: **NO-GO / INSUFFICIENT**
- Public Production: **NO-GO**
- Production-approved sources: **NONE**
- Open Product Decisions: AGNI ToS; state-wide-price representation; TN-source-coverage
  requirement; geographic-expansion question (not recommended)
- Open Compliance Decisions: ToS review for 22 enabled sources (at minimum JINDAL_PANTHER,
  AGNI_STEELS if pursued further)
- Open Engineering Work: Playwright-class extractor (TATA_STEEL/NCDEX/GEM_PORTAL/
  MSTC_ECOMMERCE); PDF text-extraction path (SAIL)
- Final Recommendation: proceed with the two open product/compliance decisions above before
  any source in this remediation can move toward production; do not force TN coverage by
  weakening compliance or fabricating district assignments.
