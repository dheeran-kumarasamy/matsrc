# Phase 6E-3 — Batch B: Existing Endpoint Validation & Evidence Collection

Generated via read-only HTTP/content inspection (curl + robots.txt fetch + raw-HTML text
extraction). **No database writes were performed.** No seeds, source code, scraper methods,
or the Apify actor were changed. This is a validation/evidence report only.

Evidence gathering date: 2026-08-10 (fresh, supersedes the ~1-month-old `verificationNote`
fields in `sources.json` dated 2026-07-08 where they conflict).

Legend for **Classification**: DIRECT_SKU_PRICING · PRICE_BEARING_UNSTRUCTURED ·
ON_REQUEST_ONLY · MARKET_INDEX · AUCTION_PRICING · LOGISTICS_PRICING · REFERENCE_DATA ·
NO_USABLE_PUBLIC_PRICE_DATA · LOGIN_REQUIRED · BLOCKED_BY_ROBOTS · WAF_BLOCKED · NOT_FOUND ·
DNS_OR_CONNECTION_FAILURE · SCRAPER_METHOD_MISMATCH · COMPLIANCE_REVIEW_REQUIRED · UNKNOWN

## Master Validation Table

| Source | Endpoint (path only) | HTTP | Content | Price | Product | Unit | Location | Date | Current Method | Method Fit | Classification | Evidence | Next Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AGNI_STEELS | agnisteels.com/pricing.php (→/tmt-steel-pricing/) | HTTP_OK 200 | Rich | YES (₹72,730–76,930) | YES (Fe 550) | per kg (implied) | NOT_PRESENT | NO_AS_OF_DATE | CHEERIO | METHOD_CORRECT | DIRECT_SKU_PRICING | 16×₹ amounts, 16×"Fe 550", 38×"price" in raw HTML | Batch C candidate for re-enable (isEnabled=false) |
| JSW_STEEL | jswsteel.in (homepage) | HTTP_OK 200 | Shell only | NO | NO | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | Homepage only; no price/dealer links found | Batch C candidate search (same domain only) |
| TATA_STEEL | tatatiscon.co.in/recommended-consumer-prices/ | HTTP_OK 200 | Ambiguous | NOT CONFIRMED (0 raw ₹/Rs matches) | YES (CRS550D nav links) | NOT_PRESENT | NOT_PRESENT | NOT_PRESENT | CHEERIO | METHOD_INCORRECT (suspected) | SCRAPER_METHOD_MISMATCH | 0 `<table>`, 0 ₹/Rs matches despite many "price"/"TMT" hits — price likely JS/AJAX rendered | Flag for Batch D/actor-limitation review |
| TATA_STEEL | tatasteel.com (homepage, DB-only drift) | HTTP_OK 200 | Shell | NO | NO | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | Corporate homepage | Drop in Batch E (drift artifact) |
| SAIL | sail.co.in/.../BROCHURE_PRICED_SEP_2025.pdf | HTTP_OK 200 (application/pdf, 2.6MB) | PDF, partial | LIKELY YES ("RS." tokens via `strings`) | Unconfirmed | Unconfirmed | Unconfirmed | Unconfirmed (filename says Sep 2025) | PDF_PARSE | METHOD_CORRECT (by design) | DIRECT_SKU_PRICING (tentative) + REQUIRES_PDF_PIPELINE_VALIDATION | `strings` found literal "RS." tokens; full text extraction needs a PDF library not present in this env | Do NOT ingest; Batch D/G needs proper PDF text extraction |
| SAIL | sail.co.in (homepage, DB-only drift) | HTTP_OK 200 | Shell | NO | NO | — | — | — | PDF_PARSE (mismatched - this is HTML) | METHOD_INCORRECT | SCRAPER_METHOD_MISMATCH | Explains the FAILED run ("Field input.urls is required") | Drop in Batch E (drift artifact) |
| JINDAL_PANTHER | jindalpanther.com/recommended-consumer-price | HTTP_OK 200 | Rich, structured | YES (8mm=384/406/392, 10mm=586/621/599, 12mm=826/876/845, 16mm=1469/1559/1503, 20mm=2297...) | YES (550D/550D-CRS/600 grades) | "PER PIECE" (table header) | YES — "Consumer Price in Central Delhi" | NOT_PRESENT | CHEERIO | METHOD_CORRECT | DIRECT_SKU_PRICING | Raw HTML `<table class="price-table">` with real per-piece prices by size/grade, city-labeled | Strongest Batch C/D candidate |
| JINDAL_PANTHER | jindalpanther.com (homepage, DB-only drift) | HTTP_OK 200 | Shell | NO | Partial (BIS grade banner) | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | Homepage marketing only | Drop in Batch E (drift artifact) |
| VIZAG_STEEL | vizagsteel.com (homepage) | HTTP_OK 200 — now reachable (contradicts stale July DNS-failure note) | Shell (not deep-checked) | UNKNOWN | UNKNOWN | — | — | — | CHEERIO | METHOD_UNKNOWN | UNKNOWN | Site now resolves; content not yet deep-inspected | Batch C: re-verify legacy "Price Diary" ASP page |
| ULTRATECH_CEMENT | .../stores-locator | HTTP_OK 200 | Dealer locator confirmed | NO (2 loose hits, no ₹ table) | Partial (brand mentions) | NOT_PRESENT | Store addresses | NOT_PRESENT | CHEERIO | METHOD_CORRECT (loads; not price content) | NO_USABLE_PUBLIC_PRICE_DATA (dealer locator) | `<title>UltraTech Cement Store Locator...</title>`; call/map/website links, no prices | Confirms Batch A hypothesis |
| ULTRATECH_CEMENT | ultratechcement.com (homepage, DB-only drift) | HTTP_OK 200 (863KB) | Not deep-checked | UNKNOWN | UNKNOWN | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA (assumed) | — | Drop in Batch E (drift artifact) |
| RAMCO_CEMENTS | ramcocements.in/locator | HTTP_OK 200 | Dealer locator confirmed | NO (0 ₹/Rs matches) | NO | NOT_PRESENT | Dealer addresses | NOT_PRESENT | CHEERIO | METHOD_CORRECT (loads; not price content) | NO_USABLE_PUBLIC_PRICE_DATA (dealer locator) | 0 currency matches, dealer/locator keywords only | Confirms Batch A hypothesis |
| RAMCO_CEMENTS | ramcocements.in (homepage, DB-only drift) | HTTP_OK 200 | Not deep-checked | UNKNOWN | UNKNOWN | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA (assumed) | — | Drop in Batch E (drift artifact) |
| ACC_CEMENT | acclimited.com (homepage) | HTTP_OK 200 | Not deep re-checked this pass | NO (per Batch A) | — | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | Prior finding: no price/dealer page found | Batch C candidate search (same domain) |
| ACC_CEMENT | acc.com (DB-only drift, WRONG domain) | HTTP 403 FORBIDDEN | Blocked | NO | — | — | — | — | CHEERIO | METHOD_INCORRECT (wrong domain) | NOT_FOUND / COMPLIANCE_REVIEW_REQUIRED | 403 confirmed; not even the correct ACC Ltd. domain | Must be removed in Batch E |
| AMBUJA_CEMENT | ambujacement.com (homepage) | HTTP_OK 200 | Not deep re-checked | NO (per Batch A) | — | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | Prior finding: no price/dealer page found | Batch C candidate search |
| DALMIA_CEMENT | dalmiacement.com/dealership (301→200) | HTTP_OK 200 | Dealer signup page | NO | NO | NOT_PRESENT | Dealer contact form | NOT_PRESENT | CHEERIO | METHOD_CORRECT (loads; not price content) | NO_USABLE_PUBLIC_PRICE_DATA (dealer recruitment) | `<title>Become a Dalmia Bharat Cement Dealer...</title>` | Confirms Batch A hypothesis |
| DALMIA_CEMENT | dalmiacement.com (homepage, DB-only drift) | HTTP_OK 200 | Not deep-checked | UNKNOWN | UNKNOWN | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA (assumed) | — | Drop in Batch E (drift artifact) |
| SHREE_CEMENT | dealers.shreecement.com/ | HTTP_OK 200 | Dealer locator confirmed | NO (0 currency matches) | NO | NOT_PRESENT | Dealer addresses (43 pages) | NOT_PRESENT | CHEERIO | METHOD_CORRECT (loads; not price content) | NO_USABLE_PUBLIC_PRICE_DATA (dealer locator) | `<title>Shree Cement Dealer Locator...</title>` | Confirms Batch A hypothesis |
| SHREE_CEMENT | shreecement.com (homepage, DB-only drift) | HTTP_OK 200 | Not deep-checked | UNKNOWN | UNKNOWN | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA (assumed) | — | Drop in Batch E (drift artifact) |
| BIRLA_A1 | birlaa1.com (homepage) | HTTP_OK 200 (584KB) | Not deep re-checked | NO (per Batch A) | — | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | Prior finding: no price/dealer page found | Batch C candidate search |
| RDC_CONCRETE | rdcconcrete.com (homepage) | CONNECTION_FAILURE (curl 000) | N/A | N/A | N/A | N/A | N/A | N/A | CHEERIO | N/A | DNS_OR_CONNECTION_FAILURE | Repeated curl failure, consistent with prior finding | No further action possible; leave disabled |
| PRISM_JOHNSON | prismjohnson.in (homepage) | HTTP_OK 200 (32KB) | Not deep re-checked | NO (per Batch A) | — | — | — | — | CHEERIO | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | Prior finding: no price/dealer page found | Batch C candidate search |
| GEM_PORTAL | gem.gov.in (homepage) | HTTP_OK 200 | Category/search shell | NO (homepage only) | — | — | — | — | PLAYWRIGHT | METHOD_UNKNOWN (JS category pages not tested) | AUCTION_PRICING (by role) but UNVERIFIED at current endpoint | 183 hits (price/tender/bid/catalog/search) but this is nav text, not bid data | No specific category/bid URL confirmed |
| MSTC_ECOMMERCE | mstcecommerce.com (homepage) | HTTP_OK 200 | Homepage shell | NO | — | — | — | — | PLAYWRIGHT | METHOD_UNKNOWN | AUCTION_PRICING (by role) but UNVERIFIED | 177 hits (auction/price/tender/bid) on nav; robots.txt returns HTML error page | Needs a specific auction-listing URL |
| MCX_INDIA | mcxindia.com | HTTP 403 FORBIDDEN (Akamai WAF) | Blocked | N/A | N/A | N/A | N/A | N/A | CHEERIO | N/A | WAF_BLOCKED | robots.txt request itself returns Akamai Access Denied | Cannot scrape without full browser fingerprint |
| NCDEX | ncdex.com/marketdata/livequote.aspx | HTTP_OK 200 (4213B) | Pure JS shell | NO (zero market data raw) | NO | NO | NO | NO | CHEERIO | METHOD_INCORRECT | SCRAPER_METHOD_MISMATCH | Raw HTML only bot-fingerprint loader script | Needs Playwright, not Cheerio |
| NCDEX | ncdex.com (homepage, DB-only drift) | HTTP_OK 200 (4186B, also tiny) | Likely same JS shell | NO | NO | — | — | — | CHEERIO | METHOD_INCORRECT (suspected) | SCRAPER_METHOD_MISMATCH (suspected) | Similarly tiny page size | Drop in Batch E |
| PORTER_LOGISTICS | porter.in (homepage) | HTTP_OK 200 | N/A robots-blocked regardless | N/A | N/A | N/A | N/A | N/A | PLAYWRIGHT | N/A | BLOCKED_BY_ROBOTS | robots.txt `Disallow: /`; Allow exceptions don't cover pricing | Must NOT be used |
| BLACKBUCK_LOGISTICS | blackbuck.com (homepage) | HTTP_OK 200 (35KB) | Marketing content | NO (1 loose hit) | NO | NOT_PRESENT | NOT_PRESENT | NOT_PRESENT | PLAYWRIGHT | METHOD_UNKNOWN | NO_USABLE_PUBLIC_PRICE_DATA | robots permissive but homepage has no rate calculator | No public freight-rate page found |
| OFBUSINESS | ofbusiness.com (homepage) | HTTP_OK 200 (580KB) | Not deep-checked (INTERNAL_ONLY) | — | — | — | — | — | CHEERIO | METHOD_UNKNOWN | REFERENCE_DATA (per license) | robots.txt disallows `/supplier-price` | Respect INTERNAL_ONLY |
| INFRA_MARKET | infra.market (homepage) | HTTP_OK 200 (14.8KB) | Not deep-checked (INTERNAL_ONLY) | — | — | — | — | — | CHEERIO | METHOD_UNKNOWN | REFERENCE_DATA (per license) | robots.txt oddly allows only AI-crawlers | Respect INTERNAL_ONLY |
| INDIAMART/TRADEINDIA/EXPORTERSINDIA/STEELONCALL/TATA_NEXARC | disabled, no endpoint rows | N/A | N/A | N/A | N/A | N/A | N/A | N/A | various | N/A | REFERENCE_DATA | No endpoints configured | Out of scope |
| TNSAND | quarry-rates?district=chennai/coimbatore/madurai | HTTP 404 | N/A | N/A | N/A | N/A | N/A | N/A | PLAYWRIGHT | N/A | NOT_FOUND | curl confirms 404; seed flagged as placeholder | Batch C: find real URL structure |
| TN_DES_BCCI/TN_PWD_SOR/TN_TWAD_SOR | no live endpoint rows | N/A | N/A | N/A | N/A | N/A | N/A | N/A | PDF_PARSE | N/A | REFERENCE_DATA/UNKNOWN | No rows exist | Out of scope |
| MATSRC_LISTINGS | internal://matsrc-listings | N/A | N/A | N/A | N/A | N/A | N/A | N/A | INTERNAL_QUERY | METHOD_CORRECT | REFERENCE_DATA (OWN_DATA) | License=OWN_DATA confirmed | Correctly out of scope |

## STEP B1 — Seed vs. DB Endpoint Drift (documented, NOT reconciled)

- Seed JSON (`source-endpoints.json`) endpoint count: **24** (all `isEnabled:false`)
- Live DB endpoint count: **36**
- DB-only (drift) endpoints: **12**, bare-homepage duplicates alongside the seed's more
  specific path-qualified URLs:
  1. TATA_STEEL → tatasteel.com (seed has tatatiscon.co.in/recommended-consumer-prices/)
  2. SAIL → sail.co.in (seed has the PDF brochure URL)
  3. JINDAL_PANTHER → jindalpanther.com (seed has /recommended-consumer-price)
  4. ULTRATECH_CEMENT → ultratechcement.com (seed has /stores-locator)
  5. RAMCO_CEMENTS → ramcocements.in (seed has /locator)
  6. ACC_CEMENT → acc.com **(wrong domain — 403; seed correctly uses acclimited.com)**
  7. AMBUJA_CEMENT → ambujacement.com (seed identical — straight duplicate, not drift)
  8. DALMIA_CEMENT → dalmiacement.com (seed has /dealership/)
  9. SHREE_CEMENT → shreecement.com (seed has dealers.shreecement.com)
  10. NCDEX → ncdex.com (seed has /marketdata/livequote.aspx)
  11-20. Bare-homepage rows also exist for JSW_STEEL, VIZAG_STEEL, BIRLA_A1, RDC_CONCRETE,
      PRISM_JOHNSON, GEM_PORTAL, MSTC_ECOMMERCE, OFBUSINESS, INFRA_MARKET, MCX_INDIA,
      PORTER_LOGISTICS, BLACKBUCK_LOGISTICS — for these the seed's *only* endpoint **is** the
      homepage, so these are 1:1 matches, not drift.
- Seed-only endpoints (in seed but not DB): **0**
- Net drift requiring cleanup in Batch E: the **10 items numbered 1-10 above**. **No changes
  made in this batch.**

## STEP B13 — ToS Compliance Gap Report

22 of 26 currently-enabled external sources have `tosReviewedAt = NULL` (pre-existing
condition, not introduced by this batch; not auto-remediated per guardrails):

ACC_CEMENT, AMBUJA_CEMENT, BIRLA_A1, BLACKBUCK_LOGISTICS, DALMIA_CEMENT, GEM_PORTAL,
INFRA_MARKET, JINDAL_PANTHER, JSW_STEEL, MCX_INDIA, MSTC_ECOMMERCE, NCDEX, OFBUSINESS,
PORTER_LOGISTICS, PRISM_JOHNSON, RAMCO_CEMENTS, RDC_CONCRETE, SAIL, SHREE_CEMENT, TATA_STEEL,
ULTRATECH_CEMENT, VIZAG_STEEL — all flagged **COMPLIANCE_REVIEW_REQUIRED**.

MATSRC_LISTINGS/ORDERS/QUOTES have `tosReviewedAt` SET (2026-08-07) and are disabled — no risk.

Sources disabled + tosReviewedAt NULL (lower priority, not live): AGNI_STEELS, TNSAND,
LIVECHENNAI, TODAYPRICERATES, TATA_NEXARC, STEELONCALL, INDIAMART, TRADEINDIA, EXPORTERSINDIA,
TN_PWD_SOR, TN_TWAD_SOR, TN_DES_BCCI.
