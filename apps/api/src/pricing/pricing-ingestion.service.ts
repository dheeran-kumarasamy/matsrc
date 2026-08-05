import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { PricingConfigService } from "./pricing-config.service";
import { APIFY_ACTOR_CLIENT, ApifyActorClient } from "./apify-actor-client";

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
    @Inject(APIFY_ACTOR_CLIENT) private readonly actorClient: ApifyActorClient
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

    let result;
    try {
      result = await this.actorClient.runActor({
        actorId: endpoint.source.apifyActorId ?? endpoint.source.scrapeMethod,
        url: endpoint.url,
        input: (endpoint.apifyInput as Record<string, unknown> | null) ?? undefined,
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
      const fields = this.extractRawFields(item);
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

  /** Best-effort extraction of the handful of known raw-* fields off an arbitrary dataset item. */
  private extractRawFields(item: Record<string, unknown>): RawItemFields {
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
  }
}
