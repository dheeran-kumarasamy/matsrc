import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { PricingConfigService } from "./pricing-config.service";
import { APIFY_ACTOR_CLIENT, ApifyActorClient } from "./apify-actor-client";
import { NATIVE_EXTRACTOR_CLIENT, hasNativeParserForUrl } from "./native-http-extractor-client";

// packages/db/lib/*.js are plain, framework-free Node modules (no test
// framework / no ts build step for packages/db — see the file headers).
// @matsrc/db has no "exports" map restricting subpath access, so requiring
// a specific file under it is safe and avoids re-implementing the same
// hashing logic a second time in TypeScript.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeRawObservationDedupeHash } = require("@matsrc/db/lib/pricing-dedupe-hash");

interface RawItemFields {
  rawSkuLabel?: string | null;
  rawPriceText?: string | null;
  rawUnitText?: string | null;
  rawLocationText?: string | null;
  rawAsOfText?: string | null;
  rawSupplierName?: string | null;
}

/**
 * Turns "one PricingSourceEndpoint" into "one PricingScrapeRun + N
 * PricingRawObservation rows", using the pluggable ApifyActorClient
 * (currently the no-op stub — see apify-actor-client.ts).
 *
 * Landing is deliberately dumb: it does not attempt to parse/normalize
 * anything beyond pulling the handful of raw-* string fields off each
 * dataset item (so a parser bug never requires re-scraping — see the
 * PricingRawObservation model comment in schema.prisma). Normalization
 * happens later, in PricingNormalizationService.
 */
@Injectable()
export class PricingIngestionService {
  private readonly logger = new Logger(PricingIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingConfig: PricingConfigService,
    @Inject(APIFY_ACTOR_CLIENT) private readonly actorClient: ApifyActorClient,
    @Inject(NATIVE_EXTRACTOR_CLIENT) private readonly nativeExtractorClient: ApifyActorClient
  ) {}

  /**
   * Runs ingestion for a single enabled PricingSourceEndpoint: creates a
   * PricingScrapeRun row, invokes the actor client, and inserts one
   * PricingRawObservation per dataset item (skipping any whose dedupeHash
   * already exists — makes re-runs idempotent per spec §2.4).
   */
  async ingestEndpoint(
    endpointId: string,
    triggeredBy: string = "manual"
  ): Promise<{ runId: string; itemsFetched: number; itemsLanded: number; itemsDuplicate: number }> {
    const endpoint = await this.prisma.pricingSourceEndpoint.findUnique({
      where: { id: endpointId },
      include: { source: true },
    });

    if (!endpoint) {
      throw new Error(`PricingSourceEndpoint "${endpointId}" not found.`);
    }

    if (!this.pricingConfig.isEnabled()) {
      throw new Error("Pricing feature is disabled (PRICING_FEATURE_ENABLED=false).");
    }

    if (!endpoint.isEnabled || !endpoint.source.isEnabled) {
      throw new Error(
        `Endpoint "${endpointId}" (or its parent source "${endpoint.source.code}") is not enabled — ` +
          `refusing to ingest. Endpoints only become eligible once ToS review clears the source.`
      );
    }

    const run = await this.prisma.pricingScrapeRun.create({
      data: {
        sourceId: endpoint.sourceId,
        status: "RUNNING",
        triggeredBy,
        apifyActorId: endpoint.source.apifyActorId ?? undefined,
      },
    });

    const apifyInput = (endpoint.apifyInput as Record<string, unknown> | null) ?? null;

    // Support multiple URLs per endpoint: PricingSourceEndpoint.url stays the
    // primary/canonical URL (unique constraint, used for dedupe/logging),
    // while apifyInput.additionalUrls (string[]) lets one endpoint hand
    // several pricing pages to a single actor call. urlFieldName (also read
    // out of apifyInput by buildApifyActorInput) controls whether these are
    // sent as `urls`, `startUrls`, or a single `url`.
    const additionalUrls = Array.isArray(apifyInput?.additionalUrls)
      ? (apifyInput!.additionalUrls as unknown[]).filter((u): u is string => typeof u === "string")
      : [];
    const urls = [endpoint.url, ...additionalUrls];

    // Phase 6E-3 Batch D-3: dispatch to the native HTTP extractor for the
    // handful of sources proven (Batch B/C/D/D-2) to have real, extractable
    // prices that the generic Apify actor cannot parse — everything else
    // keeps using the existing ApifyActorClient exactly as before. This is
    // a per-URL check, not a scrapeMethod/DB/seed change, so every other
    // source's behavior is completely unaffected.
    const primaryUrl = endpoint.url;
    const client = hasNativeParserForUrl(primaryUrl) ? this.nativeExtractorClient : this.actorClient;

    let result;
    try {
      result = await client.runActor({
        actorId: endpoint.source.apifyActorId ?? endpoint.source.scrapeMethod,
        url: urls.length > 1 ? urls : endpoint.url,
        input: apifyInput ?? undefined,
      });
    } catch (error) {

      await this.prisma.pricingScrapeRun.update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }

    let landed = 0;
    let duplicate = 0;

    for (const item of result.items) {
      const fields = this.extractRawFields(item, endpoint.source.code);

      const dedupeHash = computeRawObservationDedupeHash({
        sourceId: endpoint.sourceId,
        sourceUrl: endpoint.url,
        ...fields,
      });

      const existing = await this.prisma.pricingRawObservation.findUnique({
        where: { dedupeHash },
        select: { id: true },
      });

      if (existing) {
        duplicate += 1;
        continue;
      }

      await this.prisma.pricingRawObservation.create({
        data: {
          runId: run.id,
          sourceId: endpoint.sourceId,
          sourceUrl: endpoint.url,
          payload: item as any,
          ...fields,
          dedupeHash,
        },
      });
      landed += 1;
    }

    const finalStatus =
      result.status === "SUCCEEDED" ? (landed > 0 || result.items.length === 0 ? "SUCCEEDED" : "PARTIAL") : result.status;

    await this.prisma.pricingScrapeRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        apifyRunId: result.apifyRunId,
        apifyDatasetId: result.apifyDatasetId,
        itemsFetched: result.items.length,
        errorMessage: result.errorMessage ?? null,
      },
    });

    await this.prisma.pricingSourceEndpoint.update({
      where: { id: endpoint.id },
      data: {
        lastFetchedAt: new Date(),
        lastStatus: finalStatus,
        consecutiveFailures: finalStatus === "FAILED" ? endpoint.consecutiveFailures + 1 : 0,
      },
    });

    this.logger.log(
      `Ingested endpoint ${endpoint.id} (${endpoint.source.code}): fetched=${result.items.length} landed=${landed} duplicate=${duplicate}`
    );

    return { runId: run.id, itemsFetched: result.items.length, itemsLanded: landed, itemsDuplicate: duplicate };
  }

  /**
   * Best-effort extraction of the handful of known raw-* fields off an
   * arbitrary dataset item. Falls back to the generic property-name-guess
   * pipeline for any source without a dedicated parser below — dedicated
   * parsers only need to override the property names/shape that differ
   * from the generic fallback for that particular site's dataset items.
   */
  private extractRawFields(item: Record<string, unknown>, sourceCode: string): RawItemFields {
    const parser = SOURCE_RAW_FIELD_PARSERS[sourceCode] ?? this.extractGenericRawFields;
    return parser(item);
  }

  /** Generic fallback: guesses common property names used by most Apify actors. */
  private extractGenericRawFields = (item: Record<string, unknown>): RawItemFields => {
    const asString = (value: unknown): string | null =>
      value === null || value === undefined ? null : String(value);

    return {
      rawSkuLabel: asString(item.rawSkuLabel ?? item.title ?? item.name),
      rawPriceText: asString(item.rawPriceText ?? item.price),
      rawUnitText: asString(item.rawUnitText ?? item.unit),
      rawLocationText: asString(item.rawLocationText ?? item.location ?? item.district),
      rawAsOfText: asString(item.rawAsOfText ?? item.asOf ?? item.date),
      rawSupplierName: asString(item.rawSupplierName ?? item.supplier),
    };
  };
}

const asString = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

/**
 * Per-source raw-field extractors, keyed by PricingSource.code. Each entry
 * only needs to describe how that particular source's Apify dataset item
 * shape maps onto the generic raw-* fields PricingNormalizationService
 * already knows how to consume — no new normalization logic is required
 * here, only field-name/shape mapping specific to that source's page
 * structure.
 *
 * NOTE: until each source is actually re-scraped against a verified
 * pricing/catalog URL (see sources.json "needsVerification" entries), the
 * exact dataset item shape returned by the shared Apify actor for that
 * source is unconfirmed — these mappings are best-effort based on the
 * generic actor's common output conventions (title/name, price, unit,
 * location, date, supplier) plus each source's known page semantics, and
 * should be revisited once real (non-homepage) scrape output is available.
 */
const SOURCE_RAW_FIELD_PARSERS: Record<string, (item: Record<string, unknown>) => RawItemFields> = {
  // Agni Steels: single state-wide TMT price table — rows keyed by grade/size.
  AGNI_STEELS: (item) => ({
    rawSkuLabel: asString(item.rawSkuLabel ?? item.grade ?? item.size ?? item.title ?? item.name),
    rawPriceText: asString(item.rawPriceText ?? item.price ?? item.rate),
    rawUnitText: asString(item.rawUnitText ?? item.unit ?? "per MT"),
    rawLocationText: asString(item.rawLocationText ?? item.location ?? "Tamil Nadu"),
    rawAsOfText: asString(item.rawAsOfText ?? item.asOf ?? item.date ?? item.updatedOn),
    rawSupplierName: asString(item.rawSupplierName ?? "Agni Steels"),
  }),

  // TNSAND: district quarry-rate cards — one row per sand grade per quarry.
  TNSAND: (item) => ({
    rawSkuLabel: asString(item.rawSkuLabel ?? item.sandType ?? item.material ?? item.title),
    rawPriceText: asString(item.rawPriceText ?? item.rate ?? item.price),
    rawUnitText: asString(item.rawUnitText ?? item.unit ?? "per unit"),
    rawLocationText: asString(item.rawLocationText ?? item.district ?? item.quarry ?? item.location),
    rawAsOfText: asString(item.rawAsOfText ?? item.effectiveDate ?? item.date),
    rawSupplierName: asString(item.rawSupplierName ?? item.quarryName ?? "TN Sand Booking Portal"),
  }),

  // IndiaMART: per-listing marketplace cards — supplier + product listing pairs.
  INDIAMART: (item) => ({
    rawSkuLabel: asString(item.rawSkuLabel ?? item.productName ?? item.title ?? item.name),
    rawPriceText: asString(item.rawPriceText ?? item.price ?? item.priceRange),
    rawUnitText: asString(item.rawUnitText ?? item.unit ?? item.priceUnit),
    rawLocationText: asString(item.rawLocationText ?? item.city ?? item.location ?? item.sellerLocation),
    rawAsOfText: asString(item.rawAsOfText ?? item.postedOn ?? item.date),
    rawSupplierName: asString(item.rawSupplierName ?? item.sellerName ?? item.companyName ?? item.supplier),
  }),

  // Tata Tiscon (TATA_STEEL): "recommended-consumer-prices" page publishes a
  // table of TMT rebar grade/size rows with a recommended retail price per
  // unit. Verified 2026-07-08 (see source-endpoints.json note) — page is a
  // real price table, unlike most of the other newly-verified sources which
  // turned out to be dealer-locator pages. Field names below are still
  // best-effort against the generic Apify Cheerio/price-scraper actor's
  // typical table-row output (title/name + price/rate columns) since no
  // live dataset has been captured yet; revisit once a real run lands.
  TATA_STEEL: (item) => ({
    rawSkuLabel: asString(item.rawSkuLabel ?? item.grade ?? item.size ?? item.product ?? item.title ?? item.name),
    rawPriceText: asString(item.rawPriceText ?? item.price ?? item.rate ?? item.recommendedPrice),
    rawUnitText: asString(item.rawUnitText ?? item.unit ?? "per kg"),
    rawLocationText: asString(item.rawLocationText ?? item.location ?? item.city),
    rawAsOfText: asString(item.rawAsOfText ?? item.asOf ?? item.date ?? item.updatedOn),
    rawSupplierName: asString(item.rawSupplierName ?? "Tata Tiscon (Tata Steel)"),
  }),
};

/**
 * IMPORTANT SCOPE NOTE (2026-07-08 verification pass):
 * Most of the other 21 newly-verified source-endpoints entries resolved to
 * dealer/store-locator pages (UltraTech, Ramco, Dalmia, Shree, Tata Tiscon's
 * secondary dealer-locator URL) rather than published price tables — these
 * pages structurally do not contain SKU/price rows, so no per-source parser
 * is added for them here; running the generic Apify price-scraper actor
 * against a locator page will most likely yield 0 usable price items even
 * once enabled. SAIL's only verified page is a PDF brochure
 * (BROCHURE _PRICED_SEP_2025.pdf) which the current Apify Cheerio/price-
 * scraper actor architecture cannot parse at all — ingesting it would
 * require either (a) a dedicated PDF_PARSE pipeline (already reflected in
 * sources.json's scrapeMethod for SAIL, but not yet implemented in
 * PricingIngestionService, which currently only calls the Apify actor
 * client) or (b) routing PDF sources through a separate ingestion path.
 * This is flagged rather than silently attempted.
 */


