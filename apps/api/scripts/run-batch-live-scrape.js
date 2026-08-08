/**
 * Batch ad-hoc script: enable a set of newly-seeded PricingSourceEndpoints
 * with a real Apify actor, then trigger a live ingestion run for each via
 * the existing PricingIngestionService -- fulfilling the explicit
 * "add these URLs and perform the scraping" request. This does NOT add any
 * new permanent scheduling; it's a manual, one-time invocation, mirroring
 * the precedent set by scripts/run-live-scrape.js (Agni Steels).
 *
 * Runs against the already-compiled dist/ output (produced by
 * `pnpm --filter @matsrc/api build`) so no ts-node/tsx dependency is
 * required.
 *
 * Usage: pnpm --filter @matsrc/api build && node scripts/run-batch-live-scrape.js
 */
require("reflect-metadata");
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("../dist/app.module");
const { PrismaService } = require("../dist/prisma/prisma.service");
const { PricingIngestionService } = require("../dist/pricing/pricing-ingestion.service");

const ACTOR_ID = "s-r/price-scraper---extract-prices-availability-from-any-url";

// The newly-added source codes from this batch request (excludes sources
// already covered by the existing one-off script / seed pilot, though
// re-including them here is harmless since ingestEndpoint is idempotent
// per dedupe hash).
const SOURCE_CODES = [
  "JSW_STEEL",
  "TATA_STEEL",
  "SAIL",
  "JINDAL_PANTHER",
  "VIZAG_STEEL",
  "ULTRATECH_CEMENT",
  "RAMCO_CEMENTS",
  "ACC_CEMENT",
  "AMBUJA_CEMENT",
  "DALMIA_CEMENT",
  "SHREE_CEMENT",
  "BIRLA_A1",
  "RDC_CONCRETE",
  "PRISM_JOHNSON",
  "GEM_PORTAL",
  "MSTC_ECOMMERCE",
  "OFBUSINESS",
  "INFRA_MARKET",
  "MCX_INDIA",
  "NCDEX",
  "PORTER_LOGISTICS",
  "BLACKBUCK_LOGISTICS",
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["log", "warn", "error"] });

  const results = [];

  try {
    const prisma = app.get(PrismaService);
    const ingestion = app.get(PricingIngestionService);

    for (const sourceCode of SOURCE_CODES) {
      try {
        const source = await prisma.pricingSource.findUnique({ where: { code: sourceCode } });
        if (!source) {
          results.push({ sourceCode, status: "SKIPPED", reason: "source not found" });
          continue;
        }

        const endpoints = await prisma.pricingSourceEndpoint.findMany({ where: { sourceId: source.id } });
        if (endpoints.length === 0) {
          results.push({ sourceCode, status: "SKIPPED", reason: "no endpoints found" });
          continue;
        }

        console.log(`\nEnabling source ${sourceCode} + ${endpoints.length} endpoint(s) for this one-off live run...`);

        await prisma.pricingSource.update({
          where: { id: source.id },
          data: { apifyActorId: ACTOR_ID, isEnabled: true },
        });

        for (const endpoint of endpoints) {
          await prisma.pricingSourceEndpoint.update({
            where: { id: endpoint.id },
            data: { isEnabled: true },
          });

          try {
            console.log(`  Triggering ingestEndpoint(${endpoint.id}) for ${sourceCode} (${endpoint.url})...`);
            const result = await ingestion.ingestEndpoint(endpoint.id, "manual:bulk-scrape-request");
            console.log(`  -> fetched=${result.itemsFetched} landed=${result.itemsLanded} duplicate=${result.itemsDuplicate}`);
            results.push({ sourceCode, url: endpoint.url, status: "OK", ...result });
          } catch (err) {
            console.error(`  -> FAILED: ${err instanceof Error ? err.message : String(err)}`);
            results.push({
              sourceCode,
              url: endpoint.url,
              status: "FAILED",
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        console.error(`Source ${sourceCode} failed entirely: ${err instanceof Error ? err.message : String(err)}`);
        results.push({ sourceCode, status: "FAILED", error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    await app.close();
  }

  console.log("\n\n=== Batch live-scrape summary ===");
  console.table(
    results.map((r) => ({
      source: r.sourceCode,
      url: r.url ?? "-",
      status: r.status,
      fetched: r.itemsFetched ?? "-",
      landed: r.itemsLanded ?? "-",
      duplicate: r.itemsDuplicate ?? "-",
      note: r.reason ?? r.error ?? "",
    }))
  );
}

main().catch((err) => {
  console.error("run-batch-live-scrape failed:", err);
  process.exitCode = 1;
});
