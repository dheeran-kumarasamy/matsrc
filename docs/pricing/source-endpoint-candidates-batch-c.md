# Phase 6E-3 — Batch C: Verified Replacement Endpoint Research

Research-only batch. **No database, seed, scraper-method, or Apify actor changes were made.**
No source enablement occurred. Every candidate below was independently verified by fetching
the URL and inspecting content; nothing was guessed.

## 1. Executive Summary

- Sources researched: 15 (JINDAL_PANTHER, AGNI_STEELS, TATA_STEEL, SAIL, VIZAG_STEEL, NCDEX,
  GEM_PORTAL, MSTC_ECOMMERCE, TNSAND, JSW_STEEL, ULTRATECH_CEMENT, RAMCO_CEMENTS, ACC_CEMENT,
  AMBUJA_CEMENT/DALMIA_CEMENT/SHREE_CEMENT/BIRLA_A1/PRISM_JOHNSON as a lower-priority group)
- Candidates discovered: 2 confirmed usable as-is, 3 partially promising (need Batch D method
  test), several with no viable candidate found in this pass
  - HIGH: JINDAL_PANTHER (existing endpoint confirmed valid), AGNI_STEELS (existing endpoint
    confirmed valid, just disabled)
  - MEDIUM: SAIL (PDF, pending text-extraction confirmation), TATA_STEEL (existing endpoint,
    pending JS-rendering confirmation)
  - LOW: GEM_PORTAL / MSTC_ECOMMERCE (real category/auction URLs exist but are generic, not
    material-specific — would need per-category candidate URLs, not yet narrowed down)
  - Rejected: NCDEX (confirmed JS-shell, no server-rendered candidate found), TNSAND (only a
    login-gated `/User/GuestLogin?rurl=QuarryList` link found, no public rate page), VIZAG_STEEL
    (no candidate found this pass)
  - Sources with no candidate: JSW_STEEL, ULTRATECH_CEMENT, RAMCO_CEMENTS, ACC_CEMENT,
    AMBUJA_CEMENT, DALMIA_CEMENT, SHREE_CEMENT, BIRLA_A1, PRISM_JOHNSON — homepage/dealer-locator
    only; no `/price`, `/rate`, `/catalog`-style link discovered anywhere in their nav/footer
    HTML during this pass.

## 2. Candidate Table

| Source | Candidate URL | Type | Price | Unit | Location | Freshness | Method | Compliance | Score | Recommendation |
|---|---|---|---|---|---|---|---|---|---|---|
| JINDAL_PANTHER | jindalpanther.com/recommended-consumer-price (EXISTING) | DIRECT_SKU_PRICING | YES (₹384-2297/piece by size) | PER PIECE | Delhi (city-labeled) | NO_AS_OF_DATE | CHEERIO | robots `Allow: /` — clear | 9/10 | KEEP_EXISTING_ENDPOINT |
| AGNI_STEELS | agnisteels.com/tmt-steel-pricing/ (redirect target of /pricing.php, EXISTING) | DIRECT_SKU_PRICING | YES (₹72,730-76,930) | Implied per-tonne/kg | NOT_PRESENT | NO_AS_OF_DATE | CHEERIO | robots `Allow: /` except wp-admin | 8/10 | KEEP_EXISTING_ENDPOINT (re-enable decision belongs to Batch E) |
| SAIL | sail.co.in/.../BROCHURE_PRICED_SEP_2025.pdf (EXISTING) | DIRECT_SKU_PRICING (tentative) | LIKELY (raw `strings` found "RS." tokens) | Unconfirmed | Unconfirmed | Filename implies Sep 2025 | PDF_PARSE | robots permissive for this path | 6/10 | KEEP_EXISTING_ENDPOINT, pending PDF text extraction in Batch D |
| TATA_STEEL | tatatiscon.co.in/recommended-consumer-prices/ (EXISTING) | PRICE_BEARING_UNSTRUCTURED (suspected JS-rendered) | UNCONFIRMED — page has a state/city `<select>` dropdown (21×"state", 13×"city" hits) implying prices load per-selection via JS/AJAX | Unconfirmed | State/city selectable (dropdown found) | Unconfirmed | CHEERIO (likely needs Playwright) | robots permissive | 5/10 | Needs Batch D Playwright test before any conclusion |
| VIZAG_STEEL | vizagsteel.com (homepage only) | UNKNOWN | No candidate found | — | — | — | — | robots.txt unreachable this pass (connection reset) | 2/10 | NO_VERIFIED_PUBLIC_PRICE_ENDPOINT |
| NCDEX | ncdex.com/marketdata/livequote.aspx (EXISTING) | MARKET_INDEX (confirmed JS shell) | Confirmed NO raw data | — | — | — | CHEERIO (needs Playwright) | robots permissive | 3/10 | No alternative candidate found; a Batch D Playwright test on this SAME URL is the only path forward |
| GEM_PORTAL | mkp.gem.gov.in/home/search?q=cement (found via homepage nav link) | AUCTION_PRICING (candidate, generic) | Unconfirmed — marketplace search page, not confirmed numeric | Unconfirmed | Unconfirmed | Unconfirmed | PLAYWRIGHT | robots.txt (Googlebot-only rules seen) — needs re-check | 4/10 | Candidate only, needs Batch D inspection |
| MSTC_ECOMMERCE | mstcecommerce.com/auctionhome/... (category index links, e.g. coalblock, cfd) | AUCTION_PRICING (candidate, generic) | Unconfirmed — commodity-category auction indexes found (coal/gas), no steel/cement/TMT-specific category link found | Unconfirmed | Unconfirmed | Unconfirmed | PLAYWRIGHT | robots.txt returns HTML error, not real robots.txt | 2/10 | No material-relevant category found this pass |
| TNSAND | tnsand.in (homepage) | REFERENCE_DATA | N/A | — | — | — | PLAYWRIGHT | — | 1/10 | Only public link found is `/User/GuestLogin?rurl=QuarryList` — LOGIN_REQUIRED; quarry-rates data sits behind a login wall |
| JSW_STEEL / ULTRATECH_CEMENT / RAMCO_CEMENTS / ACC_CEMENT / AMBUJA_CEMENT / DALMIA_CEMENT / SHREE_CEMENT / BIRLA_A1 / PRISM_JOHNSON | homepage/locator only | — | No candidate found | — | — | — | — | — | 1/10 each | NO_VERIFIED_PUBLIC_PRICE_ENDPOINT for all 9 |

## 3. Source-by-Source Findings (HIGH/MEDIUM tier only — LOW/rejected covered by table above)

**JINDAL_PANTHER** — Current endpoint: `/recommended-consumer-price`. Current classification:
DIRECT_SKU_PRICING (Batch B). Candidate: same URL (no replacement needed). Evidence: raw HTML
`<table class="price-table">` with real per-piece prices by size (6mm-20mm+) and grade
(550D/550D-CRS/600), city-labeled "Consumer Price in Central Delhi". Price type: numeric,
per-piece. Location: Delhi only (single city on this page — other cities may need separate
pages, not yet explored). Freshness: no as-of date found. Recommended method: CHEERIO (already
correct — page is server-rendered). Compliance: robots.txt fully permissive. **Recommendation:
KEEP_EXISTING_ENDPOINT.**

**AGNI_STEELS** — Current endpoint: `/pricing.php` (redirects to `/tmt-steel-pricing/`).
Current classification: DIRECT_SKU_PRICING (Batch B), source `isEnabled=false`. Candidate: the
redirect target itself, already the same source. Evidence: 10+ literal ₹ amounts
(₹72,730-76,930) in raw HTML, "Fe 550" grade labels. Price type: numeric. Location: not
present on this page. Freshness: no as-of date found. Recommended method: CHEERIO (correct).
Compliance: robots.txt permissive except wp-admin/agni-old. **Recommendation:
KEEP_EXISTING_ENDPOINT — re-enabling the source is a Batch E decision, not made here.**

**SAIL** — Current endpoint: the priced-product-brochure PDF. Current classification:
DIRECT_SKU_PRICING (tentative) + REQUIRES_PDF_PIPELINE_VALIDATION (Batch B). Candidate: same
PDF (no replacement found; this appears to be SAIL's one official public price document).
Evidence: `strings` on the raw PDF bytes surfaced literal "RS." currency tokens, confirming
price-relevant content exists in the document, but full text extraction was not possible in
this environment (no pdftotext/PyPDF2/pdfminer/pdf-parse available). Recommended method:
PDF_PARSE (already correct — the FAILED run was due to being invoked via the wrong generic
actor, not a wrong URL). Compliance: robots.txt permits this path. **Recommendation: KEEP
EXISTING ENDPOINT, pending a proper PDF text-extraction pass in Batch D.**

**TATA_STEEL** — Current endpoint: `/recommended-consumer-prices/`. Current classification:
SCRAPER_METHOD_MISMATCH (suspected, Batch B). Candidate: same URL — found a state/city
`<select>` dropdown widget in the raw HTML (21 "state" + 13 "city" keyword occurrences),
strongly suggesting the actual price table is populated client-side via JS/AJAX after a
state/city selection, which a non-JS Cheerio fetch would never see. No alternative
server-rendered price page was found on this domain during this pass. **Recommendation: do
not replace the URL; the fix (if any) belongs to a Batch D Playwright-based extraction test on
this SAME URL, or documenting ACTOR_EXTRACTION_LIMITATION if that also fails.**

**VIZAG_STEEL** — Current endpoint: homepage. No nav links referencing "price"/"diary"/"rate"
were found in the homepage HTML this pass (the legacy "Price Diary" ASP page mentioned in the
original seed `verificationNote` could not be located). robots.txt fetch failed with a
connection reset (distinct from the earlier full-page fetch which succeeded) — inconsistent
result, worth a retry in Batch D but not a confirmed block. **Recommendation:
NO_VERIFIED_PUBLIC_PRICE_ENDPOINT for now — do not fabricate the old ASP URL without seeing it
linked live.**

**NCDEX** — Current endpoint: `/marketdata/livequote.aspx`, confirmed pure JS
bot-fingerprinting shell (Batch B). No alternative server-rendered NCDEX page was found.
**Recommendation: no URL replacement; Batch D must test this exact URL with a Playwright-class
actor, or document ACTOR_EXTRACTION_LIMITATION if the fingerprinting defeats it too.**

**GEM_PORTAL / MSTC_ECOMMERCE** — Both are government auction/marketplace platforms whose
homepages link to real, live sub-pages (`mkp.gem.gov.in/home/search?q=cement`;
`mstcecommerce.com/auctionhome/coalblock/index.jsp` etc.), confirming the *platform* is
AUCTION_PRICING in role, but none of the specific category links found are material-specific
enough (cement search returns a generic marketplace catalog, not confirmed numeric pricing;
MSTC's category list found so far is coal/gas-related, not steel/cement/TMT-specific).
**Recommendation: treat as LOW-priority candidates only — Batch D would need to inspect the
`mkp.gem.gov.in/home/search?q=cement` result page specifically before any conclusion; do not
assume it contains usable pricing yet.**

## 4. Recommended Batch D Test Set

**Tier 1 (test first — highest evidence quality):**
1. JINDAL_PANTHER (`/recommended-consumer-price`) — expect EXTRACTION_SUCCESS with current
   CHEERIO method; strongest candidate to prove the full pipeline end-to-end.
2. AGNI_STEELS (`/pricing.php` → `/tmt-steel-pricing/`) — expect EXTRACTION_SUCCESS with
   current CHEERIO method; source re-enablement is a separate Batch E decision.

**Tier 2 (test with method awareness — may reveal ACTOR_EXTRACTION_LIMITATION):**
3. SAIL (PDF) — requires proper PDF text extraction before/instead of the generic actor; test
   is about validating the PDF_PARSE pathway, not the generic Cheerio/Playwright actor.
4. TATA_STEEL (`/recommended-consumer-prices/`) — test with a JS-executing (Playwright-class)
   approach to confirm/deny the JS-rendering hypothesis.
5. NCDEX (`/marketdata/livequote.aspx`) — same JS-rendering test rationale.

**Tier 3 (lower confidence — test only if time permits, do not block on these):**
6. GEM_PORTAL (`mkp.gem.gov.in/home/search?q=cement`) — inspect result page for real numeric
   listings before deciding if useful.
7. VIZAG_STEEL — re-attempt robots.txt + deeper homepage nav crawl for the legacy Price Diary
   page before giving up.

**Do NOT test in Batch D:** MCX_INDIA (WAF_BLOCKED), PORTER_LOGISTICS (BLOCKED_BY_ROBOTS),
RDC_CONCRETE (unreachable), TNSAND (LOGIN_REQUIRED), MSTC_ECOMMERCE (no material-relevant
category found), JSW_STEEL/ULTRATECH_CEMENT/RAMCO_CEMENTS/ACC_CEMENT/AMBUJA_CEMENT/
DALMIA_CEMENT/SHREE_CEMENT/BIRLA_A1/PRISM_JOHNSON (no candidate found at all).

## 5. Endpoint Replacement Plan

**No endpoint URL replacements are proposed.** Every HIGH/MEDIUM candidate above is the
**existing** endpoint already in the seed — Batch C found no evidence that any *different* URL
on these same domains would be better. The only proposed change (deferred to Batch E) is
**removing the 10 DB-only bare-homepage drift rows** identified in Batch B for sources that
already have a better, more specific seed URL (this is a cleanup, not a replacement).

## 6. Sources With No Viable Endpoint

| Source | Reason | Evidence | Recommended Status |
|---|---|---|---|
| JSW_STEEL | No price/dealer/catalog link found | Homepage nav crawl, 2 independent passes | NO_PUBLIC_PRICE_DATA |
| ULTRATECH_CEMENT | Only a dealer/store locator exists | `<title>...Store Locator...</title>`, no price content | NO_PUBLIC_PRICE_DATA (dealer locator role) |
| RAMCO_CEMENTS | Only a dealer/store locator exists | 0 currency matches on /locator | NO_PUBLIC_PRICE_DATA (dealer locator role) |
| ACC_CEMENT | No price/dealer/catalog link found | Homepage nav crawl | NO_PUBLIC_PRICE_DATA |
| AMBUJA_CEMENT | No price/dealer/catalog link found | Homepage nav crawl | NO_PUBLIC_PRICE_DATA |
| DALMIA_CEMENT | Only a dealer-recruitment page exists | `<title>Become a...Dealer...</title>` | NO_PUBLIC_PRICE_DATA (recruitment role) |
| SHREE_CEMENT | Only a dealer/store locator exists | `<title>...Dealer Locator...</title>`, 0 currency matches | NO_PUBLIC_PRICE_DATA (dealer locator role) |
| BIRLA_A1 | No price/dealer/catalog link found | Homepage nav crawl | NO_PUBLIC_PRICE_DATA |
| PRISM_JOHNSON | No price/dealer/catalog link found | Homepage nav crawl | NO_PUBLIC_PRICE_DATA |
| VIZAG_STEEL | No price page linked from homepage | Homepage nav crawl this pass | NO_PUBLIC_PRICE_DATA (tentative — worth one more look) |
| TNSAND | Quarry rates require login | Only public link is `/User/GuestLogin?rurl=QuarryList` | LOGIN_REQUIRED |
| MSTC_ECOMMERCE | No material-specific category found | Category links found are coal/gas-related | NO_PUBLIC_PRICE_DATA (for TMT/cement specifically; platform itself is AUCTION_PRICING) |

**No source is recommended for removal.** Per the guardrails, sources without usable public
pricing are documented as such, not replaced with alternative companies.

## 7. Compliance Blockers

| Source | Blocker | Evidence |
|---|---|---|
| PORTER_LOGISTICS | BLOCKED_BY_ROBOTS | `Disallow: /` in robots.txt (Batch B) |
| MCX_INDIA | WAF_BLOCKED | Akamai edge returns 403 even for robots.txt (Batch B) |
| TNSAND | LOGIN_REQUIRED | Only public link is a GuestLogin redirect to QuarryList |
| 22 enabled sources | tosReviewedAt = NULL | Full list in Batch B report — unresolved, not auto-fixed |

## 8. Seed/DB Reconciliation Plan (NOT executed — for Batch E reference only)

- **DB-only rows to remove in Batch E**: the 10 bare-homepage drift rows identified in Batch B
  Step B1 (TATA_STEEL/tatasteel.com, SAIL/sail.co.in, JINDAL_PANTHER/jindalpanther.com,
  ULTRATECH_CEMENT/ultratechcement.com, RAMCO_CEMENTS/ramcocements.in, ACC_CEMENT/acc.com
  [wrong domain], AMBUJA_CEMENT/ambujacement.com, DALMIA_CEMENT/dalmiacement.com,
  SHREE_CEMENT/shreecement.com, NCDEX/ncdex.com).
- **Seed endpoints that should remain unchanged**: all 24 current seed rows — none require a
  URL change based on this research (JINDAL_PANTHER and AGNI_STEELS confirmed already-correct;
  SAIL/TATA_STEEL/NCDEX need method-level Batch D testing, not URL changes).
- **Candidate replacements**: none proposed (see Section 5).
- **Duplicate homepages**: same as the DB-only-removal list above; no other duplicates found.

This reconciliation is **not performed in this batch** — reserved explicitly for Batch E.

