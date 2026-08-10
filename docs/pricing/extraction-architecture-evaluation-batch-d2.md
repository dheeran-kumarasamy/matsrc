# Phase 6E-3 — Batch D-2: Extraction Architecture Evaluation & Native Extractor Proof

**No production changes were made.** No Prisma schema, PricingSource, PricingSourceEndpoint,
seed JSON, scrapeMethod, isEnabled, Apify actor, scheduler, normalization, or rollup logic was
touched. No dependencies were installed (the test below uses only Node's built-in `fetch`,
already available in the Node runtime this repo targets — no new package.json entries). No
source was enabled (AGNI_STEELS remains `isEnabled=false`). No full production scrape was run.

## Step D2-1 — Current Extraction Architecture (inspected, not modified)

- `PricingSource.scrapeMethod` enum already exists: `APIFY_ACTOR | APIFY_CHEERIO |
  APIFY_PLAYWRIGHT | PDF_PARSE | HTTP_JSON | INTERNAL_QUERY` (schema.prisma).
- **However**, `PricingIngestionService.ingestEndpoint()` (the only code path that actually
  runs) does **not** branch on `scrapeMethod` at all -- it always calls
  `this.actorClient.runActor({ actorId: endpoint.source.apifyActorId ?? endpoint.source.scrapeMethod, url, input })`
  via the single `ApifyActorClient` interface (`apify-actor-client.ts`). Every source, regardless
  of its configured `scrapeMethod`, is routed through the same generic Apify actor call. This is
  confirmed directly in the source code (line ~99) -- the enum value is stored but not used to
  select a different extraction strategy anywhere in the ingestion path.
- Per-source raw-field mapping (`TATA_STEEL`, `TNSAND`, `INDIAMART`, `AGNI_STEELS` mapper
  functions) already exists in `pricing-ingestion.service.ts` to translate whatever fields the
  actor's dataset item happens to contain into `rawSkuLabel/rawPriceText/rawUnitText/...` -- this
  layer is reusable regardless of how the raw dataset item is produced.
- `PricingNormalizationService` operates purely on `PricingRawObservation` rows already in the
  database -- it has **zero dependency on how those rows were created** (Apify vs. anything
  else). This confirms the "extraction is swappable, downstream logic is shared" principle is
  already structurally true for everything *after* landing; it's only the landing step itself
  that's monolithic.
- No `cheerio`, `axios`, or HTML-parser dependency exists anywhere in `apps/api`
  (`package.json` dependencies checked directly -- only `apify-client`, NestJS packages, bullmq,
  twilio, etc.). Node's global `fetch` (built into the Node runtime already in use here --
  confirmed v24) is available with zero new dependencies.

**Current extraction architecture**: single, non-polymorphic -- every endpoint funnels through
one generic Apify actor call regardless of its `scrapeMethod` field. The database schema
already anticipates a polymorphic design (the enum), but the ingestion code was never wired up
to honor it.

## Step D2-2 — Existing Cheerio/HTML-parsing Infrastructure

**None exists.** No cheerio, no HTML DOM parser, no axios. The only HTTP capability available
without a new dependency is Node's built-in `fetch`. Regex-based text extraction (not a DOM
parser) was used for this proof, since installing cheerio was not authorized in this batch.

## Step D2-3 — JINDAL_PANTHER Native Extraction Proof (temporary script, deleted after use)

Used `fetch()` + regex-based `<td>` cell extraction (no Apify, no new dependency) against the
live URL `https://www.jindalpanther.com/recommended-consumer-price`:

**Extracted rows (verbatim from the live page, not fabricated):**

| Raw HTML cells | Extracted |
|---|---|
| `6 mm (500D)` / `226` / `-` / `-` | Size=6mm(500D), 550D=Rs226, 550D-CRS=N/A, 600=N/A |
| `8 mm` / `384` / `406` / `392` | Size=8mm, 550D=Rs384, 550D-CRS=Rs406, 600=Rs392 |
| `10 mm` / `586` / `621` / `599` | Size=10mm, 550D=Rs586, 550D-CRS=Rs621, 600=Rs599 |
| `12 mm` / `826` / `876` / `845` | Size=12mm, 550D=Rs826, 550D-CRS=Rs876, 600=Rs845 |
| `16 mm` / `1469` / `1559` / `1503` | Size=16mm, 550D=Rs1469, 550D-CRS=Rs1559, 600=Rs1503 |

(9 rows total parsed from 36 raw `<td>` cells extracted.)

## Step D2-4 — JINDAL_PANTHER Extraction Coverage

- Apify extracted: **0**
- Native (fetch + regex) extracted: **9 rows** (matching the visually-confirmed table rows from
  Batch B/C: 6mm through 32mm+ across 3 grade columns)
- Coverage: **~100%** of the visible price table
- **Result: NATIVE_EXTRACTION = SUCCESS**

## Step D2-5 — AGNI_STEELS Native Extraction Proof

Used `fetch()` + regex (`Rs\s?([0-9,]+)` and `Fe\s?(\d{3})`) against
`https://agnisteels.com/tmt-steel-pricing/`:

- Apify extracted: **0**
- Native extracted: **16 price matches** (Rs76,930 / Rs73,930 / Rs72,730 x5 / Rs73,930 /
  Rs76,930 / Rs73,930 / ...), **16 grade mentions** (all "Fe 550")
- Coverage: matches the manual count from Batch B/C (16 currency amounts identified by hand)
- **Result: NATIVE_EXTRACTION = SUCCESS**

## Step D2-6 — Apify vs. Native Comparison

| Source | Apify extracted | Native extracted | Native viable? |
|---|---|---|---|
| JINDAL_PANTHER | 0 | 9 rows (near-100% coverage) | **YES** |
| AGNI_STEELS | 0 | 16 price points | **YES** |

## Compatibility with Existing Downstream Pipeline

- **Raw observation contract**: fully compatible. Native extraction produces exactly the same
  logical fields (`rawSkuLabel`, `rawPriceText`, `rawUnitText`, `rawLocationText`,
  `rawAsOfText`) that `PricingIngestionService`'s existing per-source mapper functions already
  expect -- no contract change needed.
- **Normalization**: fully compatible. `PricingNormalizationService.normalizeOne()` only reads
  from `PricingRawObservation` rows; it has no dependency on how those rows were created.
- **SKU mapping / district resolution / confidence / rollups**: same -- all operate purely on
  already-landed `PricingRawObservation`/`PricingObservation` rows, agnostic to extraction
  method.
- **No canonical SKU was created. No source was enabled. No database writes occurred** -- this
  was a read-only proof against live URLs only.

## Final Report

**JINDAL_PANTHER** -- Apify extracted: 0 · Native extracted: 9 rows

**AGNI_STEELS** -- Apify extracted: 0 · Native extracted: 16 price points

**Native extraction viable: YES** (for both tested sources, with zero new dependencies)

**Current Apify actor suitable: SOURCE-DEPENDENT** -- it is not suitable for plain HTML
price-table pages (confirmed failure on 4/4 candidates in Batch D, including two with
unambiguous real prices), but its suitability for other source types was not re-tested and is
out of scope here.

**Recommended architecture: HYBRID** -- matching the schema's pre-existing `scrapeMethod`
enum intent:
- CHEERIO-configured sources with plain HTML tables (JINDAL_PANTHER, AGNI_STEELS, likely
  TATA_STEEL once resolved) -> a lightweight native HTTP+parsing extractor, not the generic
  Apify actor
- PLAYWRIGHT-configured sources (NCDEX, TNSAND, GEM_PORTAL, MSTC_ECOMMERCE, PORTER_LOGISTICS,
  BLACKBUCK_LOGISTICS) -> would need genuine JS execution, which neither the current Apify
  actor nor a plain `fetch()` provides -- a real decision point for a future batch
- PDF_PARSE-configured sources (SAIL) -> a dedicated PDF text-extraction path, still absent
  from the codebase
- The **existing normalization/SKU/district/rollup logic requires zero changes** under any of
  these -- confirmed structurally compatible above.

## Proposed Next Implementation Phase (NOT implemented -- proposal only)

1. Add a new `ApifyActorClient`-equivalent implementation (e.g. a `NativeHttpExtractorClient`)
   that fetches a URL and applies a small, source-specific parser (reusing the existing
   per-source mapper pattern already in `pricing-ingestion.service.ts`), selected by
   `PricingSource.scrapeMethod` -- **this requires a scoping decision and explicit approval
   before any code is written**, since it touches production ingestion code.
2. Wire `PricingIngestionService.ingestEndpoint()` to branch on `scrapeMethod` instead of
   always calling the Apify actor -- this is the one production code change this evidence
   points toward, but **it has not been made in this batch**.
3. Defer PLAYWRIGHT and PDF_PARSE sources to separate follow-up phases given they need
   capabilities (real browser execution, PDF text extraction) not proven here.

## Hard Stop Confirmation

No production code was changed. No dependencies were installed. No Apify actor was changed.
AGNI_STEELS remains disabled. No seeds were updated. No Prisma schema was touched. No full live
scrape was run. This report is evidence only, awaiting explicit approval before any
implementation.
