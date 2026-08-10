# Phase 6E-3 — Read-Only Review of Batches A-F

This is a read-only architecture and product review. **No code, database, seed, endpoint,
source-enablement, or schema changes were made in this review**, aside from one additional
live, read-only page fetch of AGNI_STEELS to answer review question #9 (documented in full
below) — no data was inserted anywhere.

## 1. What is technically complete?

- A full source/endpoint inventory (34 sources, now 27 reconciled endpoints, zero DB/seed
  drift) with HTTP/content/compliance evidence for every one.
- A working, tested (11 unit tests + integration-level live verification), hybrid extraction
  architecture: `PricingIngestionService` now dispatches per-URL to either the existing
  `ApifyActorClient` or a new `NativeHttpExtractorClient`, with zero changes to
  normalization/SKU/district/rollup/alert logic and zero new dependencies.
- Proof that this architecture lands genuine, verifiable `PricingRawObservation` rows through
  the real, unmodified `PricingIngestionService.ingestEndpoint()` method (23 rows for
  JINDAL_PANTHER), with correct dedupe/idempotency behavior on re-run (0 landed/23 duplicate).
- Seed/DB reconciliation: seed and live DB now match 1:1 (27/27 endpoints), with the 10 stray
  DB-only rows removed only after confirming zero raw observations referenced them.

## 2. What is production-ready?

**Nothing is fully production-ready yet**, by design. "Technically working extraction" is
necessary but not sufficient — see the four-state distinction in section 13 below. The closest
candidate (JINDAL_PANTHER) is blocked on two independent, unrelated gates (geography +
compliance), not on extraction quality.

## 3. What is technically proven but geographically out-of-scope?

**JINDAL_PANTHER.** The native extractor genuinely works (23/23 real rows, verified live,
verified idempotent). But the source page itself states, verbatim, "Consumer Price in Central
Delhi (Delhi)" — this is authentic Delhi-market data, not a labeling error or a parser bug.
This system's entire `PricingDistrict` taxonomy (38 rows) is Tamil-Nadu-only. There is no
ambiguity here: JINDAL_PANTHER's *this specific endpoint's* data is genuinely out of scope for
a Tamil-Nadu-only product, regardless of how well the extraction pipeline works.

## 4. What is technically proven but compliance-blocked?

**Both JINDAL_PANTHER and AGNI_STEELS.** Both have `tosReviewedAt = NULL`. Per this repo's own
pre-existing compliance invariant (`verify-pricing-source-compliance.js`), a source may not be
`isEnabled=true` without a non-null `tosReviewedAt`. This is an administrative/legal decision,
not a technical one — it was correctly not touched by any batch in this task.

## 5. What remains unproven?

- TATA_STEEL, NCDEX: whether a Playwright-class (JS-executing) approach can extract them —
  never actually tried; only the generic Apify actor and a non-JS `fetch()` were tested.
- SAIL: whether the PDF actually contains complete, correctly-dated price/product/unit fields
  — `strings` found currency tokens, but no real text extraction was performed (no PDF library
  available in this environment).
- GEM_PORTAL, MSTC_ECOMMERCE: whether any material-specific (steel/cement) category page
  exists with real numeric pricing — only generic/unrelated category links were found so far.
- VIZAG_STEEL: whether any price-bearing page exists at all — homepage-only evidence, the
  legacy "Price Diary" ASP page referenced in old notes was never located live.
- **AGNI_STEELS' district relevance** — see section 9, this is the most important open item.

## 6. Why is Batch G correctly blocked?

Batch G requires a source with simultaneously: valid extraction + valid Tamil Nadu district +
valid/mappable SKU + acceptable compliance. JINDAL_PANTHER fails on district (Delhi) and
compliance (ToS). AGNI_STEELS fails on compliance (ToS) and has an *unconfirmed* (not
disproven, but not yet verified either) district claim, and remains `isEnabled=false` by
explicit instruction. No other source has proven extraction at all. Forcing Batch G through
any of these would require violating at least one hard guardrail (fabricating a district
mapping, bypassing compliance, or enabling a disabled source) — correctly refused.

## 7. Does the current Tamil-Nadu-only product scope remain internally consistent?

**Yes.** Every `PricingDistrict` row is a Tamil Nadu district (verified directly against the
live database: Ariyalur through Virudhunagar, 38 total, all `TN-*` codes). Nothing in this
task's evidence contradicts a TN-only scope; it only reveals that some *candidate endpoints*
(JINDAL_PANTHER's Delhi page) fall outside that scope. The scope itself has not been shown to
be wrong -- only that not every technically-workable source fits it.

## 8. Is there any evidence that we should expand the geographic taxonomy now?

**No, and this review does not recommend it.** One out-of-scope data point (JINDAL_PANTHER's
Delhi page) is not evidence that the product needs multi-state coverage -- it is evidence that
*this specific endpoint* happens to publish Delhi-only pricing on its main "recommended
consumer price" page. Expanding geographic scope is a business/product decision with
implications far beyond this remediation task (new districts, new SKU-district combinations,
new rollup dimensions, new UI copy, new compliance review for a different jurisdiction) and
must not be inferred from a single endpoint's content.

## 9. Is AGNI_STEELS genuinely Tamil-Nadu-specific, or is that merely unconfirmed?

**Genuinely, strongly evidenced as Tamil-Nadu-relevant at the company level, but not yet
per-row/per-city verified at the price-table level.** A fresh, read-only re-fetch of the live
page (`https://agnisteels.com/tmt-steel-pricing/`) for this review found:
- The page's own meta description states verbatim: "Agni Steels provides updated TMT bar
  prices in Madurai, Chennai, Tamil Nadu, and across India..."
- The page's structured schema.org JSON-LD data states the company's registered address as
  `addressLocality: "Erode", addressRegion: "Tamilnadu"`.
- The page's `og:site_name` and JSON-LD `name` both read "Tmt steel bars manufacturers in
  Tamilnadu, Kerala and All over india".

This is genuine, verifiable evidence that Agni Steels is a real Tamil Nadu company describing
itself as serving Tamil Nadu markets -- materially stronger than an assumption. **However**,
the existing `rawLocationText: "Tamil Nadu"` hardcoded in
`native-http-extractor-client.ts`'s `parseAgniSteelsHtml()` (inherited unchanged from the
pre-existing `SOURCE_RAW_FIELD_PARSERS.AGNI_STEELS` mapper convention already in
`pricing-ingestion.service.ts`) is a **state-level** label, not a specific TN district. The 16
individual price rows on the page are not each tagged with a specific city/district -- they
appear to be a single state-wide price list (consistent with the seed's own pre-existing note:
"Single state-wide pricing page; no per-district URL parameter observed"). So: company-level TN
relevance is genuinely evidenced; **row-level district assignment (which of the 38 TN
districts each price applies to) remains unproven** and must not be guessed at normalization
time.

## 10. Which source should be the first candidate for a genuine end-to-end TN validation?

**AGNI_STEELS**, once (a) `tosReviewedAt` is administratively resolved and (b) a decision is
made on how to handle its state-wide (not per-district) pricing during normalization/district
resolution. It has the strongest combination of genuine extraction proof (16/16 real prices,
native extractor already implemented and tested) and genuine TN relevance evidence (verified
above) of any source examined across Batches A-F.

## 11. What is the minimum missing evidence required to unblock Batch G?

For AGNI_STEELS specifically: (1) an explicit compliance/ToS-review decision (administrative,
outside this task's authority), and (2) an explicit product decision on how a state-wide
(non-district-specific) price source should be represented in a district-scoped pricing
system -- this is a normalization-logic design question, not a data-gathering question, and
should not be resolved by silently picking a district. Neither of these can be produced by
further live scraping; both require an explicit decision from whoever owns this product.

## 12. What must NOT be changed merely to make Batch G pass?

- Must not create a Delhi `PricingDistrict` row to accommodate JINDAL_PANTHER.
- Must not map JINDAL_PANTHER's or AGNI_STEELS' observations to Chennai (or any other TN
  district) "by default" or convenience.
- Must not flip `AGNI_STEELS.isEnabled` to `true` without the compliance/ToS decision.
- Must not invent a specific TN district for AGNI_STEELS' state-wide price list merely to
  produce a passing pipeline trace.
- Must not weaken `verify-pricing-source-compliance.js`'s invariant to unblock either source.

## 13. State Distinctions (not to be conflated)

| State | JINDAL_PANTHER | AGNI_STEELS |
|---|---|---|
| **TECHNICALLY VALID** (extraction produces real, correct raw data) | YES -- 23/23 rows, live-verified, idempotent | YES -- 16/16 rows, live-verified |
| **PRODUCTION APPROVED** (cleared for live customer-facing use) | NO | NO |
| **TN-SCOPE VALID** (data is genuinely Tamil-Nadu-relevant at the observation level) | NO -- data is explicitly Delhi-market | PARTIAL -- company-level TN relevance strongly evidenced; row-level district assignment unproven |
| **COMPLIANCE APPROVED** (ToS review complete, safe to enable) | NO -- `tosReviewedAt=NULL` | NO -- `tosReviewedAt=NULL` |

## Recommended Decision

Do not proceed to Batch H by declaring victory on data volume. Instead, Batch H should
document exactly this: a working, tested, hybrid extraction architecture with two technically
proven sources, both correctly held back by independent, legitimate, non-technical gates
(geography for one, compliance + district-design for both). This is the intended outcome of a
rigorous remediation, not a shortfall to be papered over. Recommend proceeding to Batch H with
this review's findings incorporated verbatim into the source health classification and final
report, and explicitly recommend the two open decisions in section 11 be raised to the
product/compliance owner as separate, explicit follow-up items -- not resolved unilaterally by
this task.
