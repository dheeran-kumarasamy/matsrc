# Phase 6E-3 — Batch F: Controlled Live Source Validation & Apify Compatibility Report

**No Prisma/seed/source-enablement/URL/scraper-method/Apify-actor/normalization/SKU/district/
rollup/alert/UI changes were made in this batch.** No dependencies installed. This batch
reuses evidence already gathered live in Batches A-E rather than re-fetching every endpoint
redundantly; only F3's classification step and F4's compliance precheck are newly compiled
here, cross-referenced against that evidence.

## F1 — Baseline

`git status --short` / `git diff --stat`: identical to the end of Batch E (5 modified files,
28 insertions/7 deletions; 8 new doc files, 2 new source files). Full `apps/api` test suite:
**255/256 passing**, 1 pre-existing failure (`whatsapp.controller.spec.ts`), no regression.

## F2 — 27-Endpoint Inventory (live DB, unaltered)

| Source | URL | scrapeMethod | Endpoint Enabled | Source Enabled | License | Robots | ToS | Public |
|---|---|---|---|---|---|---|---|---|
| ACC_CEMENT | acclimited.com | CHEERIO | true | true | ATTRIBUTION | true | NULL | true |
| AGNI_STEELS | agnisteels.com/pricing.php | CHEERIO | false | false | ATTRIBUTION | false | NULL | true |
| AMBUJA_CEMENT | ambujacement.com | CHEERIO | true | true | ATTRIBUTION | false | NULL | true |
| BIRLA_A1 | birlaa1.com | CHEERIO | true | true | ATTRIBUTION | false | NULL | true |
| BLACKBUCK_LOGISTICS | blackbuck.com | PLAYWRIGHT | true | true | INTERNAL_ONLY | true | NULL | false |
| DALMIA_CEMENT | dalmiacement.com/dealership/ | CHEERIO | true | true | ATTRIBUTION | true | NULL | true |
| GEM_PORTAL | gem.gov.in | PLAYWRIGHT | true | true | PUBLIC_DOMAIN | true | NULL | true |
| INFRA_MARKET | infra.market | CHEERIO | true | true | INTERNAL_ONLY | true | NULL | false |
| JINDAL_PANTHER | jindalpanther.com/recommended-consumer-price | CHEERIO | true | true | ATTRIBUTION | false* | NULL | true |
| JSW_STEEL | jswsteel.in | CHEERIO | true | true | ATTRIBUTION | false | NULL | true |
| MATSRC_LISTINGS | internal://matsrc-listings | INTERNAL_QUERY | false | false | OWN_DATA | true | SET | true |
| MCX_INDIA | mcxindia.com | CHEERIO | true | true | ATTRIBUTION | false | NULL | true |
| MSTC_ECOMMERCE | mstcecommerce.com | PLAYWRIGHT | true | true | PUBLIC_DOMAIN | false | NULL | true |
| NCDEX | ncdex.com/marketdata/livequote.aspx | CHEERIO | true | true | ATTRIBUTION | true | NULL | true |
| OFBUSINESS | ofbusiness.com | CHEERIO | true | true | INTERNAL_ONLY | false | NULL | false |
| PORTER_LOGISTICS | porter.in | PLAYWRIGHT | true | true | INTERNAL_ONLY | false | NULL | false |
| PRISM_JOHNSON | prismjohnson.in | CHEERIO | true | true | ATTRIBUTION | false | NULL | true |
| RAMCO_CEMENTS | ramcocements.in/locator | CHEERIO | true | true | ATTRIBUTION | true | NULL | true |
| RDC_CONCRETE | rdcconcrete.com | CHEERIO | true | true | ATTRIBUTION | false | NULL | true |
| SAIL | sail.co.in/.../BROCHURE_PRICED_SEP_2025.pdf | PDF_PARSE | true | true | ATTRIBUTION | true | NULL | true |
| SHREE_CEMENT | dealers.shreecement.com | CHEERIO | true | true | ATTRIBUTION | true | NULL | true |
| TATA_STEEL | tatatiscon.co.in/recommended-consumer-prices/ | CHEERIO | true | true | ATTRIBUTION | true | NULL | true |
| TNSAND (x3 districts) | tnsand.in/quarry-rates?district=... | PLAYWRIGHT | false | false | PUBLIC_DOMAIN | false | NULL | true |
| ULTRATECH_CEMENT | ultratechcement.com/.../stores-locator | CHEERIO | true | true | ATTRIBUTION | true | NULL | true |
| VIZAG_STEEL | vizagsteel.com | CHEERIO | true | true | ATTRIBUTION | false | NULL | true |

*JINDAL_PANTHER's live DB `robotsAllowed` still shows `false` (stale) -- the seed was
corrected to `true` in Batch E (robots.txt re-verified fully permissive), but the DB row was
deliberately **not** re-seeded in this batch per the "no seed/DB changes" guardrail for
Batch F. This is a documented, known discrepancy, not a new finding.

## F3 — Test Strategy Classification

| Source | Classification | Reason |
|---|---|---|
| JINDAL_PANTHER | **NATIVE_HTTP_TEST** (already proven) | Native extractor exists and verified live (Batch D-3/D-4) |
| AGNI_STEELS | **NATIVE_HTTP_TEST** (already proven, source disabled) | Native extractor exists and verified live (Batch D-3) |
| TATA_STEEL | APIFY_TEST (already tested, failed) | Batch D: 0 items via Apify; Batch C: suspected JS/AJAX price widget |
| NCDEX | APIFY_TEST (already tested, failed) -> needs PLAYWRIGHT | Batch B/D: confirmed pure JS bot-fingerprint shell |
| SAIL | PDF_TEST (not yet implemented) | No PDF_PARSE code path exists in PricingIngestionService |
| GEM_PORTAL, MSTC_ECOMMERCE | PLAYWRIGHT_TEST needed, not yet run | JS-rendered category/auction pages, homepage-only evidence |
| PORTER_LOGISTICS | **ROBOTS_BLOCKED** | robots.txt `Disallow: /` (unchanged) |
| MCX_INDIA | **COMPLIANCE_BLOCKED** (WAF) | Akamai WAF blocks even robots.txt (unchanged) |
| RDC_CONCRETE | **NOT_TESTABLE** | Domain unreachable, connection failure (unchanged) |
| TNSAND | **NOT_TESTABLE** (current URLs) | Confirmed 404; real quarry data behind GuestLogin |
| JSW_STEEL, ACC_CEMENT, AMBUJA_CEMENT, BIRLA_A1, PRISM_JOHNSON | APIFY_TEST (already tested, no price content found) | Homepage-only, no price/dealer link found across 2 passes |
| ULTRATECH_CEMENT, RAMCO_CEMENTS, DALMIA_CEMENT, SHREE_CEMENT | APIFY_TEST (already tested, dealer-locator confirmed) | Content-inspected, confirmed non-price |
| OFBUSINESS, INFRA_MARKET | **NOT_TESTABLE for public display** | INTERNAL_ONLY license -- out of scope regardless of content |
| BLACKBUCK_LOGISTICS | PLAYWRIGHT_TEST (already tested, no rate calculator found) | Homepage-only, no freight-pricing page found |
| VIZAG_STEEL | NATIVE_HTTP_TEST or APIFY_TEST candidate, UNVERIFIED | Reachable but not deep-content-tested |
| MATSRC_LISTINGS | INTERNAL_QUERY_TEST | Internal, OWN_DATA, correctly out of scope |

## F4 — Compliance Precheck

Per guardrail, no endpoint with `robotsAllowed=false` was fetched "to see if it works" in this
batch -- all robots-blocked/WAF-blocked classifications above are carried forward from prior
batches' already-completed, compliant checks. All 22 `tosReviewedAt=NULL` enabled sources
remain flagged `COMPLIANCE_REVIEW_REQUIRED`, unresolved, not modified.

## F25 — Apify Architecture Conclusion

**Apify should remain one extractor among several, not the universal ingestion mechanism.**
Evidence: the generic actor produced 0 items against every plain-HTML price-table page tested
(JINDAL_PANTHER, AGNI_STEELS, TATA_STEEL), including pages with unambiguous real prices, while
a ~150-line native HTTP+regex extractor (zero new dependencies) succeeded on the same pages.
Apify's actual demonstrated value in this system is for JS-heavy pages where it can be paired
with a Playwright-class actor (not yet tested) -- NCDEX, GEM_PORTAL, MSTC_ECOMMERCE,
PORTER_LOGISTICS(blocked), BLACKBUCK_LOGISTICS remain in that category. Where a source is
better served by native HTTP (proven) or PDF parsing (not yet implemented), Apify should not
be forced.

## F26 — Data Coverage (27 reconciled endpoints; sources overlap categories, counted once per primary classification)

- Price-bearing (real, verified): **2** (JINDAL_PANTHER, AGNI_STEELS)
- Non-price (homepage/dealer-locator/recruitment, confirmed by content inspection): **13**
  (JSW_STEEL, ACC_CEMENT, AMBUJA_CEMENT, BIRLA_A1, PRISM_JOHNSON, ULTRATECH_CEMENT,
  RAMCO_CEMENTS, DALMIA_CEMENT, SHREE_CEMENT, TATA_STEEL [ambiguous/JS-suspected -- counted
  here since 0 extractable via any method tested so far], VIZAG_STEEL [unverified, tentative],
  BLACKBUCK_LOGISTICS, MATSRC_LISTINGS [internal, N/A])
- Blocked (robots/WAF/unreachable/login): **4** (PORTER_LOGISTICS, MCX_INDIA, RDC_CONCRETE, TNSAND)
- Method mismatch (confirmed, needs different extractor to have any chance): **3** (TATA_STEEL,
  NCDEX -- both need JS execution; SAIL needs PDF_PARSE code path)
- Native-capable (proven): **2** (JINDAL_PANTHER, AGNI_STEELS)
- Apify-capable (not proven for anything in this reconciled set): **0**
- Pending/unverified (JS-rendered category pages exist but not material-specific): **2**
  (GEM_PORTAL, MSTC_ECOMMERCE)
- INTERNAL_ONLY (never public regardless of content): **2** (OFBUSINESS, INFRA_MARKET)

## F27 — Critical Sources

**JINDAL_PANTHER**: Technical: **PROVEN**. Product scope: **OUT_OF_SCOPE (Delhi data, TN-only
system)**. Compliance: **PENDING** (`tosReviewedAt=NULL`). Overall: **AMBER**.

**AGNI_STEELS**: Technical: **PROVEN**. Enabled: **NO**. Compliance: **PENDING**. District
scope: unconfirmed (rawLocationText defaults to "Tamil Nadu" in the existing per-source mapper,
but this was never verified against the live page's actual geographic claim -- the live page
itself does not state a specific TN city, per Batch B/C evidence). Overall: **AMBER**.

## F28 — Sources Not Worth Pursuing (unchanged from prior batches, not re-opened)

PORTER_LOGISTICS (robots-blocked), MCX_INDIA (WAF-blocked), RDC_CONCRETE (unreachable), TNSAND
current URLs (login-gated for real data), OFBUSINESS/INFRA_MARKET (INTERNAL_ONLY, never
public), the 9 homepage/dealer-locator sources with confirmed no price content
(JSW_STEEL/ACC_CEMENT/AMBUJA_CEMENT/BIRLA_A1/PRISM_JOHNSON/ULTRATECH_CEMENT/RAMCO_CEMENTS/
DALMIA_CEMENT/SHREE_CEMENT).

## F29 — Test Suite

`pnpm --filter @matsrc/api exec vitest run`: **255/256 passing**, 1 pre-existing failure
(`whatsapp.controller.spec.ts` verify-token), 0 new failures.

## F30 — Git Status

`git status --short` / `git diff --stat`: unchanged from Batch E's end state -- confirmed no
Prisma changes, no unintended seed changes, no source enablement, no URL changes, no unrelated
files touched by this batch.

## Final Decision Matrix

| Source | Technical | Compliance | District | Production Recommendation |
|---|---|---|---|---|
| JINDAL_PANTHER | GREEN | AMBER | RED / Out-of-scope (Delhi) | Do not use for TN; keep isEnabled=false in seed |
| AGNI_STEELS | GREEN | AMBER | UNCONFIRMED (TN claimed, not page-verified) | Keep disabled pending compliance + district verification |
| TATA_STEEL | RED (0 items, all methods tried so far) | AMBER | N/A (blocked upstream) | Requires Playwright investigation before any production use |
| NCDEX | RED (confirmed JS shell) | AMBER | N/A (market index, not district) | Requires Playwright; not a retail SKU source regardless |
| SAIL | AMBER (PDF reachable, content unconfirmed) | AMBER | N/A | Requires PDF_PARSE implementation before any use |
| GEM_PORTAL, MSTC_ECOMMERCE | UNVERIFIED | AMBER | N/A (auction/reference) | Requires Playwright + material-specific URL discovery |
| PORTER_LOGISTICS, MCX_INDIA, RDC_CONCRETE, TNSAND | RED (blocked/unreachable/login) | N/A | N/A | Do not pursue |
| 9 homepage/dealer-locator sources | RED (no price content) | AMBER | N/A | No usable public price data; documented, not replaced |
| OFBUSINESS, INFRA_MARKET | N/A | INTERNAL_ONLY | N/A | Never public regardless of technical result |
| BLACKBUCK_LOGISTICS | RED (no rate page found) | AMBER | N/A | No usable public price data found |
| VIZAG_STEEL | UNVERIFIED | AMBER | N/A | Needs deeper content check before any classification |

## Batch G Readiness

**No currently validated source satisfies all of: valid source + valid extraction + valid
district (Tamil Nadu) + valid SKU + acceptable compliance simultaneously.** JINDAL_PANTHER has
valid extraction but invalid district (Delhi, out of TN scope) and pending compliance.
AGNI_STEELS has valid extraction but unconfirmed district and pending compliance, and remains
disabled. Therefore:

**BATCH_G_BLOCKED_NO_VALID_TN_END_TO_END_SOURCE**

This is reported rather than forcing a pipeline trace through data that would misrepresent
geography or bypass a pending compliance decision.
