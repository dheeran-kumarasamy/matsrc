import { Injectable, Logger } from "@nestjs/common";
import type { ApifyActorClient, ApifyRunResult } from "./apify-actor-client";

/**
 * Phase 6E-3 Batch D-3: native (non-Apify) extraction client for sources
 * whose scrapeMethod is APIFY_CHEERIO but whose pages are plain,
 * server-rendered HTML that the generic Apify actor
 * (s-r/price-scraper---extract-prices-availability-from-any-url) cannot
 * parse — confirmed via live testing in Batch D/D-2: that actor is built
 * for e-commerce "product search result" pages and returns zero items
 * even against pages containing unambiguous, real, server-rendered prices.
 *
 * This client uses only Node's built-in `fetch` (no new dependency — see
 * docs/pricing/extraction-architecture-evaluation-batch-d2.md) plus a small,
 * per-source regex/string parser keyed by hostname. It implements the same
 * `ApifyActorClient` interface so `PricingIngestionService`'s landing logic
 * (dedupe hashing, PricingRawObservation creation, PricingScrapeRun
 * bookkeeping) is completely unchanged — only the source of `result.items`
 * differs. Every produced item is already shaped with the raw-* field names
 * PricingNormalizationService expects (rawSkuLabel/rawPriceText/...), so no
 * changes to the existing per-source SOURCE_RAW_FIELD_PARSERS mapping table
 * in pricing-ingestion.service.ts are required either — those parsers
 * already read `item.rawSkuLabel ?? ...` first.
 *
 * Only JINDAL_PANTHER and AGNI_STEELS have a registered parser today (the
 * two sources whose pages were proven, by hand and via live re-run, to
 * contain genuine extractable prices in Batch B/C/D). Any other hostname
 * returns an explicit FAILED result with a clear errorMessage — there is
 * deliberately no silent fallback to "0 items, status SUCCEEDED".
 */

interface NativeRawItem {
  rawSkuLabel: string | null;
  rawPriceText: string | null;
  rawUnitText: string | null;
  rawLocationText: string | null;
  rawAsOfText: string | null;
  rawSupplierName: string | null;
}

type NativeParser = (html: string) => NativeRawItem[];

/**
 * JINDAL_PANTHER: /recommended-consumer-price publishes a real
 * server-rendered `<table class="price-table">` of TMT rebar size/grade
 * rows (verified in Batch B/C/D-2). Each row's cells are, in order:
 * [size, price-550D, price-550D-CRS, price-600] (a "-" cell means that
 * grade/size combination isn't offered and is skipped, never fabricated).
 */
export function parseJindalPantherHtml(html: string): NativeRawItem[] {
  const idx = html.toLowerCase().indexOf("price-table");
  if (idx < 0) return [];

  const tableHtml = html.slice(idx, idx + 8000);
  const cells = [...tableHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
    .filter((c) => c.length > 0);

  const grades = ["550D", "550D-CRS", "600"];
  const items: NativeRawItem[] = [];

  for (let i = 0; i < cells.length - 3; i++) {
    if (!/^\d+\s*mm/i.test(cells[i])) continue;
    const size = cells[i];
    for (let g = 0; g < grades.length; g++) {
      const price = cells[i + 1 + g];
      if (!price || price === "-") continue;
      items.push({
        rawSkuLabel: `TMT Fe ${grades[g]} ${size}`,
        rawPriceText: price,
        rawUnitText: "per piece",
        rawLocationText: "Delhi",
        rawAsOfText: null,
        rawSupplierName: "Jindal Panther",
      });
    }
  }

  return items;
}

/**
 * AGNI_STEELS: /pricing.php (redirects to /tmt-steel-pricing/) publishes
 * real ₹ amounts and "Fe 550" grade labels directly in the raw HTML text
 * (no table structure needed to find them — verified in Batch B/C/D-2).
 * Pairs the Nth price with the Nth grade mention in document order; if the
 * counts don't match, only the overlapping prefix is used (never guesses a
 * pairing beyond what both lists actually contain).
 */
export function parseAgniSteelsHtml(html: string): NativeRawItem[] {
  const priceMatches = [...html.matchAll(/₹\s?([0-9,]+)/g)];
  const gradeMatches = [...html.matchAll(/Fe\s?(\d{3})/gi)];
  const count = Math.min(priceMatches.length, gradeMatches.length);

  const items: NativeRawItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      rawSkuLabel: `TMT Fe ${gradeMatches[i][1]}`,
      rawPriceText: priceMatches[i][1],
      rawUnitText: "per MT",
      rawLocationText: "Tamil Nadu",
      rawAsOfText: null,
      rawSupplierName: "Agni Steels",
    });
  }
  return items;
}

const NATIVE_PARSERS_BY_HOSTNAME: Record<string, NativeParser> = {
  "jindalpanther.com": parseJindalPantherHtml,
  "agnisteels.com": parseAgniSteelsHtml,
};

/**
 * Exported so PricingIngestionService can decide, per-URL, whether to route
 * through this native client instead of the Apify actor client — without
 * repurposing the PricingSource.scrapeMethod enum value (which stays
 * APIFY_CHEERIO for these two sources; scrapeMethod continues to describe
 * "what kind of page this is", not "which internal client object handles
 * it", so no seed/DB change is required to enable this dispatch).
 */
export function hasNativeParserForUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname in NATIVE_PARSERS_BY_HOSTNAME;
  } catch {
    return false;
  }
}

@Injectable()
export class NativeHttpExtractorClient implements ApifyActorClient {
  private readonly logger = new Logger(NativeHttpExtractorClient.name);

  async runActor(params: {
    actorId: string;
    url: string | string[];
    input?: Record<string, unknown> | null;
  }): Promise<ApifyRunResult> {
    const url = Array.isArray(params.url) ? params.url[0] : params.url;
    let hostname: string;
    try {
      hostname = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return this.failed(`Invalid URL: "${url}"`);
    }

    const parser = NATIVE_PARSERS_BY_HOSTNAME[hostname];
    if (!parser) {
      return this.failed(`No native parser registered for hostname "${hostname}" — refusing silent fallback.`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MatsrcPricingBot/1.0)" },
      });
    } catch (error) {
      return this.failed(`Fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!response.ok) {
      return this.failed(`HTTP ${response.status} fetching ${url}`);
    }

    const html = await response.text();
    const items = parser(html);

    this.logger.log(`NativeHttpExtractorClient: ${hostname} -> ${items.length} item(s) extracted from ${url}`);

    return {
      apifyRunId: `native_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      apifyDatasetId: "",
      items: items as unknown as Record<string, unknown>[],
      status: "SUCCEEDED",
    };
  }

  private failed(message: string): ApifyRunResult {
    this.logger.warn(message);
    return {
      apifyRunId: `native_failed_${Date.now()}`,
      apifyDatasetId: "",
      items: [],
      status: "FAILED",
      errorMessage: message,
    };
  }
}

export const NATIVE_EXTRACTOR_CLIENT = "NATIVE_EXTRACTOR_CLIENT";
