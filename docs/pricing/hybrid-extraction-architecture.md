# Hybrid Extraction Architecture (Phase 6E-3 Batch D-3)

## 1. Why Apify remains

The `s-r/price-scraper---extract-prices-availability-from-any-url` Apify actor is still the
default extraction path for every source. It was not removed or replaced -- its suitability for
genuine e-commerce/marketplace listing pages (its apparent design target) was never disproven;
only its unsuitability for plain server-rendered HTML price tables was proven (Batch D). Live
Apify credentials, cost tracking, and `LiveApifyActorClient`/`StubApifyActorClient` all remain
unchanged.

## 2. Why native extraction was introduced

Batch D live-tested the two strongest candidate sources -- JINDAL_PANTHER and AGNI_STEELS, both
independently hand-verified to contain real, unambiguous, server-rendered Rs prices -- through
the exact production Apify actor/input path and got **zero extracted items for both**, with the
actor's own log stating "No valid search results for URL" / "No products found for URL" in
every case. Batch D-2 then proved, using only Node's built-in `fetch()` (zero new
dependencies), that both pages' real prices are trivially extractable with a small
per-hostname parser. This is not a URL problem or a JS-rendering problem -- it is a genuine
capability mismatch between this specific actor and plain HTML price-table pages.

## 3. Extraction method dispatch

`PricingIngestionService.ingestEndpoint()` now checks, per-endpoint, whether the endpoint's
primary URL's hostname has a registered native parser
(`hasNativeParserForUrl()` in `native-http-extractor-client.ts`). If so, it routes the call
through `NativeHttpExtractorClient` instead of the existing `ApifyActorClient`. Every other
endpoint's behavior is completely unchanged -- this is a per-URL check, not a
`scrapeMethod`/database/seed change. `PricingSource.scrapeMethod` continues to describe "what
kind of page this is" (still `APIFY_CHEERIO` for both JINDAL_PANTHER and AGNI_STEELS); it does
not need to change to trigger this dispatch, and doing so was deliberately avoided so no
seed/DB update was required for this implementation.

## 4. Raw observation contract

`NativeHttpExtractorClient` implements the same `ApifyActorClient` interface
(`runActor({ actorId, url, input }) => Promise<ApifyRunResult>`) as the existing Apify clients,
returning `{ apifyRunId, apifyDatasetId, items, status, errorMessage? }`. Each item already has
the exact `rawSkuLabel/rawPriceText/rawUnitText/rawLocationText/rawAsOfText/rawSupplierName`
shape `PricingIngestionService`'s existing `SOURCE_RAW_FIELD_PARSERS["AGNI_STEELS"]` (and the
generic fallback, for JINDAL_PANTHER which has no dedicated parser entry) already expect via
`item.rawSkuLabel ?? ...` -- no changes were needed to that mapping table, dedupe-hash
computation, `PricingRawObservation` creation, or `PricingScrapeRun` bookkeeping.

## 5. JINDAL_PANTHER implementation

`parseJindalPantherHtml(html)` locates the `price-table` marker, extracts all `<td>` cell text
in document order, and groups every run of 4 cells starting at a `"<N> mm"` size cell into one
row of `[size, price550D, price550D-CRS, price600]`. A `"-"` cell (grade/size not offered) is
skipped, never fabricated. Verified live: 23 real items extracted (size 6mm through the largest
size on the page, across up to 3 grades each), matching the page's actual table content.

## 6. AGNI_STEELS implementation

`parseAgniSteelsHtml(html)` finds every `Rs\s?([0-9,]+)` price and every `Fe\s?(\d{3})` grade
mention in raw document order and pairs them positionally (Nth price with Nth grade); if counts
differ, only the overlapping prefix is used -- no price is ever invented for an unmatched grade.
Verified live: 16 real items extracted, matching the manually-verified price list from Batch B/C.

## 7. Error handling

- Unknown hostname (no registered parser): explicit `FAILED` result with a clear
  `errorMessage` -- **no silent fallback to an empty-but-"successful" result**.
- Fetch/network failure: `FAILED` with the underlying error message.
- Non-2xx HTTP response: `FAILED` with the status code in the message.
- Invalid URL: `FAILED` with a clear message.

This mirrors `PricingIngestionService`'s existing try/catch around `actorClient.runActor()`,
which already marks the `PricingScrapeRun` `FAILED` and rethrows on any client error -- no
changes were needed there.

## 8. Observability

`NativeHttpExtractorClient` logs via the standard Nest `Logger` (same pattern as
`LiveApifyActorClient`/`StubApifyActorClient`): one log line per run with hostname + item count
on success, a `warn` line with the reason on any failure path. `PricingScrapeRun.apifyRunId`
is populated with a `native_...` prefixed synthetic ID so it's visibly distinguishable from a
real Apify run ID in the admin dashboard without any schema change.

## 9. Testing

`native-http-extractor-client.spec.ts` (11 tests, all passing): parser correctness for both
sources (including the "no fabricated data for unmatched cells/grades" cases), hostname
detection, and the client's dispatch/error-handling behavior (unregistered hostname -> FAILED,
non-2xx -> FAILED, success -> SUCCEEDED with items). `pricing-ingestion.service.spec.ts` was
updated only to accept the new constructor parameter (4 pre-existing tests, all still passing,
no behavioral test changes). Full `apps/api` suite: **255/256 passing**; the 1 failure
(`whatsapp.controller.spec.ts` verify-token 403-vs-200) is confirmed pre-existing/unrelated via
`git log` (last touched in an unrelated prior commit `510a78f Updated the webhook token`).

## 10. Future source-specific extractors (not implemented)

The same `ApifyActorClient` interface can host future extractors (e.g. a Playwright-based
client for TATA_STEEL/NCDEX once JS-rendering is confirmed necessary, or a PDF-text-extraction
client for SAIL) without touching `PricingNormalizationService`, SKU/district resolution,
rollups, or alerts -- all of which already operate purely on `PricingRawObservation` rows,
independent of how those rows were created. These are explicitly deferred to separate,
approved follow-up tasks per the Batch D-3 scope boundary.
