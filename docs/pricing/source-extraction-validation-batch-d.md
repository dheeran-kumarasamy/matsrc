# Phase 6E-3 — Batch D: Controlled Candidate Extraction & Live Data Validation

**No database, seed, source-enablement, scraper-method, or Prisma schema changes were made.**
AGNI_STEELS was NOT enabled. No dependencies were installed. The Apify actor was NOT changed.
No production ingestion (`run-batch-live-scrape.js`) was run.

Test method: a temporary, standalone diagnostic script
(`apps/api/scripts/_batchd-test-actor.tmp.js`) was created to call the exact same actor
(`s-r/price-scraper---extract-prices-availability-from-any-url`) with the exact same input
shape (`{ urls: [url] }`) that `PricingIngestionService`/`buildApifyActorInput()` already use
in production, against ONE URL at a time, completely isolated from any
PricingSourceEndpoint/PricingScrapeRun/PricingRawObservation writes (the script never touches
Prisma or the database — it only calls `ApifyClient` directly and prints the results). **The
script was deleted immediately after use; it is not part of the codebase.**

## D2 — JINDAL_PANTHER (Tier 1, tested first)

- **D2.1 Direct HTTP test**: HTTP 200, `text/html`, ~83KB, final URL unchanged (no redirect).
  Confirmed price-bearing = true (Batch B/C evidence).
- **D2.2 Manual HTML inspection** — 3 representative real records confirmed present in raw
  HTML (verbatim from the page, not fabricated):
  1. Grade 550D, size 8mm -> Rs 384/piece
  2. Grade 550D-CRS, size 10mm -> Rs 621/piece
  3. Grade 600, size 12mm -> Rs 845/piece
  All under the table header "RECOMMENDED CONSUMER PRICE IN RUPEES (PER PIECE)", city-labeled
  "Consumer Price in Central Delhi (Delhi)".
- **D2.3 Existing scraper test (live Apify run, actual production actor/input shape)**:
  - Apify run ID: `ReMCE2qcZTCww6JAT`, status: **SUCCEEDED**
  - Actor's own log: `No valid search results for URL: https://www.jindalpanther.com/recommended-consumer-price`
    then `No products found for URL: ...`
  - Items pushed to dataset: **0**
- **D2.4 Reconciliation**: Page contains 15+ price-bearing rows (by size x grade). Extractor
  found **0**. Extraction coverage: **0%**.

**Conclusion for JINDAL_PANTHER: RUN_SUCCESS / EXTRACTION_EMPTY.** The actor is a generic
e-commerce "product search result" scraper (its own log literally says "No valid search
results" and "No products found") -- it is looking for product-listing/search-result page
patterns (e.g. title+price+add-to-cart cards), not a plain HTML `<table>` of size/grade/price
rows. This is a genuine **actor capability limitation**, not a URL problem -- the URL is
unambiguously correct and price-bearing (verified by hand in D2.2).

## D3-D9 — AGNI_STEELS, TATA_STEEL, NCDEX (Tier 1/2, tested next)

Testing continued to all three remaining Tier 1/2 candidates to confirm whether the
JINDAL_PANTHER result was source-specific or systemic. All three were run live through the
identical actor/input path:

| Source | URL | Apify Run ID | Run Status | Actor Log | Items Extracted |
|---|---|---|---|---|---|
| AGNI_STEELS | agnisteels.com/pricing.php | `UHoyME2x10BZWnxev` | SUCCEEDED | "No valid search results for URL" / "No products found" | **0** |
| TATA_STEEL | tatatiscon.co.in/recommended-consumer-prices/ | `lwh3hxOm77Qri0fBS` | SUCCEEDED | "No valid search results for URL" / "No products found" | **0** |
| NCDEX | ncdex.com/marketdata/livequote.aspx | `MlbJyAJcBLCnLdstB` | SUCCEEDED | "No valid search results for URL" / "No products found" | **0** |

**AGNI_STEELS is the most significant of these three**: like JINDAL_PANTHER, its page contains
unambiguous, hand-verified real Rs prices (Rs 72,730-76,930, confirmed in Batch B/C) directly
in raw HTML with zero JS-rendering involved -- yet the actor still found 0 products. This
**confirms** the actor limitation is not related to JS-rendering, dealer-locator content, or
any other per-source theory from Batches B/C -- it is a fundamental mismatch between this
actor's "e-commerce product search result" extraction pattern and these sources' plain HTML
price-table layout, even for a server-rendered, real-price, zero-JS page.

(TATA_STEEL and NCDEX were already independently suspected of JS-rendering issues from Batch
C -- their 0-item result is consistent with that theory too, but adds no new information
beyond what AGNI_STEELS already proves about the actor itself.)

## D10 — Real Pipeline Trace

**Not applicable.** No PricingRawObservation, PricingObservation, PricingDistrictPriceDaily, or
Public API rows were created in this batch -- extraction itself produced zero items for every
tested candidate, so there is nothing to normalize, map to a canonical SKU, resolve to a
district, roll up, or expose via the API. Per the hard-stop instruction, this batch does not
fabricate or force a trace where no genuine observation exists.

## D11-D15 — Observation Quality / Duplicate / Anomaly / Alert / Compliance

**Not applicable** for the same reason -- zero raw observations exist to evaluate. Compliance
status from Batch B stands unchanged: all 4 tested sources have `tosReviewedAt = NULL`,
flagged COMPLIANCE_REVIEW_REQUIRED, unresolved, not auto-fixed.

## D16 — Results Table

| Source | Endpoint | Method | HTTP | Extracted | Landed | Normalized | SKU | Location | Confidence | Public | Compliance | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| JINDAL_PANTHER | /recommended-consumer-price | CHEERIO (actor) | 200 | 0 | 0 | N/A | N/A | N/A | N/A | N/A | COMPLIANCE_REVIEW_REQUIRED | RUN_SUCCESS / EXTRACTION_EMPTY |
| AGNI_STEELS | /pricing.php | CHEERIO (actor) | 200 | 0 | 0 | N/A | N/A | N/A | N/A | N/A | COMPLIANCE_REVIEW_REQUIRED; source isEnabled=false | RUN_SUCCESS / EXTRACTION_EMPTY |
| TATA_STEEL | /recommended-consumer-prices/ | CHEERIO (actor) | 200 | 0 | 0 | N/A | N/A | N/A | N/A | N/A | COMPLIANCE_REVIEW_REQUIRED | RUN_SUCCESS / EXTRACTION_EMPTY |
| NCDEX | /marketdata/livequote.aspx | CHEERIO (actor) | 200 | 0 | 0 | N/A | N/A | N/A | N/A | N/A | COMPLIANCE_REVIEW_REQUIRED | RUN_SUCCESS / EXTRACTION_EMPTY |

## D17 — Source Status

- **JINDAL_PANTHER**: `EXTRACTION_WORK_REQUIRED` (actor cannot parse a plain price table)
- **AGNI_STEELS**: `EXTRACTION_WORK_REQUIRED` (same actor limitation; also currently disabled)
- **TATA_STEEL**: `EXTRACTION_WORK_REQUIRED` (actor limitation confirmed)
- **NCDEX**: `PLAYWRIGHT_REQUIRED` + `EXTRACTION_WORK_REQUIRED` (confirmed JS-shell, Batch B)
- **SAIL**: `PDF_TOOLING_REQUIRED` (not run through the Apify actor this batch -- needs a
  separate PDF_PARSE code path that does not exist yet in `PricingIngestionService`)
- **GEM_PORTAL / MSTC_ECOMMERCE**: not tested this batch (Tier 3, deferred)
- **PORTER_LOGISTICS**: `BLOCKED` (robots) · **MCX_INDIA**: `BLOCKED` (WAF)

## D18 — Recommendation

**Production candidates (ready today): NONE.** Every tested candidate -- including the two
with unambiguous, hand-confirmed real prices in plain server-rendered HTML -- returned zero
extracted items from the currently configured Apify actor.

**Candidates requiring code/config work:** JINDAL_PANTHER, AGNI_STEELS, TATA_STEEL -- the
generic actor cannot parse these pages' table/list structure regardless of URL quality (its
own logs say "No valid search results"/"No products found" for all of them, including plain
server-rendered pages with unambiguous prices). NCDEX additionally needs JS execution. SAIL
needs a PDF_PARSE code path that doesn't exist yet.

**Sources that should remain inactive:** PORTER_LOGISTICS, MCX_INDIA, RDC_CONCRETE, TNSAND.

## FINAL REPORT

1. **Tested Sources**: JINDAL_PANTHER, AGNI_STEELS, TATA_STEEL, NCDEX (SAIL was NOT run through
   the generic Apify actor -- doing so would repeat the exact FAILED-run mismatch already
   documented in Batch A; SAIL needs its own PDF_PARSE path, not this actor).
2. **Actual Extraction Results**: 4/4 runs `SUCCEEDED` at the Apify-run level; 4/4 produced
   **0 extracted items**. Actor log for every URL: "No valid search results for URL... No
   products found for URL..."
3. **Genuine Observations Created**: **0**.
4-9. **Normalization/SKU/District/Confidence/Public Display Results**: N/A -- no raw
   observations exist.
9. **Compliance Results**: all 4 tested sources remain `tosReviewedAt = NULL`,
   COMPLIANCE_REVIEW_REQUIRED -- unresolved, untouched.
10. **Extraction Failures**: 4/4 -- root cause is a **generic Apify actor capability
    limitation** (confirmed via the actor's own log output, not inferred), not a URL problem.
    Per guardrail #4 ("If changing the actor appears necessary: STOP and report the evidence.
    Do not change it automatically"), **this evidence is being reported now -- no actor change
    has been made.**
11. **Required Code Changes**: NONE made. If pursued later: SAIL needs a new PDF_PARSE
    ingestion path (doesn't exist today); JINDAL_PANTHER/AGNI_STEELS/TATA_STEEL would need
    either a different, table-aware Apify actor/task, or a custom extraction script.
12. **Required Configuration Changes**: NONE made.
13. **Required Dependency Changes**: NONE made/installed.
14. **Database Changes**: **NONE.**
15. **Recommended Production Candidates**: none can go to production today. JINDAL_PANTHER and
    AGNI_STEELS remain the best-evidenced *content* (real, verified prices) but are blocked on
    an **actor limitation**, not a source/endpoint quality problem.
16. **Sources Still Blocked**: JINDAL_PANTHER, AGNI_STEELS, TATA_STEEL, NCDEX (actor
    limitation); SAIL (missing PDF pipeline); PORTER_LOGISTICS (robots); MCX_INDIA (WAF);
    RDC_CONCRETE (unreachable); TNSAND (login-required); all 22 enabled sources also carry
    unresolved `tosReviewedAt = NULL`.
17. **Next Action**: **STOP and await explicit approval.** Per guardrail #4, this evidence
    (not a URL problem, not a source-content problem -- a genuine actor incapability against
    plain HTML price tables) is reported for a decision on whether to: (a) pursue a different
    Apify actor/task better suited to structured price tables, (b) build a small custom
    extraction script for the confirmed-good JINDAL_PANTHER/AGNI_STEELS pages, or (c) accept
    that this actor cannot serve this remediation's goal and adjust scope. **None of these
    options have been implemented -- this batch stops here for a decision.**
