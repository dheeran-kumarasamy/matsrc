// Server-side "live market intelligence" module (§3.6 of the price-report
// feature). Calls the Anthropic Messages API with the web_search tool,
// scoped to a material category + region, and returns a structured
// summary of current market drivers. This is deliberately the ONLY module
// in the price-report feature that hits an external LLM — and it is always
// read through `getOrRefreshMarketInsight`, which enforces the 12h TTL
// cache (MarketInsightCache) so a live web-search call is never triggered
// per page view. Manual refresh (forceRefreshMarketInsight) is separately
// rate-limited to once per 10 minutes.
//
// Unrelated to (and must never be conflated with) the public listings
// route's no-store/dynamic caching rule — that route intentionally has NO
// caching because stale SKUs caused a production incident; this module
// intentionally DOES cache because it fronts a slow/costly external
// LLM+web-search call, not first-party live inventory.

import { prisma } from "@/lib/builder-db";

const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const MANUAL_REFRESH_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";

export type MarketDriver = {
  title: string;
  detail: string;
};

export type MarketSource = {
  name: string;
  url: string;
};

export type MarketInsight = {
  category: string;
  region: string;
  drivers: MarketDriver[];
  outlook: string;
  sources: MarketSource[];
  generatedAt: string;
  expiresAt: string;
  stale: boolean;
};

type CacheRow = {
  category: string;
  region: string;
  driversJson: unknown;
  outlook: string;
  sources: unknown;
  generatedAt: Date;
  expiresAt: Date;
};

function cacheRowToInsight(row: CacheRow, stale: boolean): MarketInsight {
  return {
    category: row.category,
    region: row.region,
    drivers: Array.isArray(row.driversJson) ? (row.driversJson as MarketDriver[]) : [],
    outlook: row.outlook,
    sources: Array.isArray(row.sources) ? (row.sources as MarketSource[]) : [],
    generatedAt: row.generatedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    stale,
  };
}

/**
 * Calls the Anthropic Messages API (with the server-side web_search tool)
 * to produce a structured market-intelligence summary for the given
 * material category + region. Throws on failure — callers are responsible
 * for falling back to the last cached row.
 */
async function fetchLiveMarketInsight(category: string, region: string): Promise<{
  drivers: MarketDriver[];
  outlook: string;
  sources: MarketSource[];
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const prompt = `You are a construction-materials market analyst. Using web search, find the current (last 2-4 weeks) market context for "${category}" pricing in the "${region}" region of India.

Respond with ONLY a single JSON object (no prose, no markdown fences) with this exact shape:
{
  "drivers": [ { "title": string, "detail": string } ],  // 3 to 5 short market drivers (e.g. raw material cost, demand/season, government policy, freight/logistics)
  "outlook": string,  // one short paragraph (2-3 sentences), paraphrased in your own words, never a verbatim quote from any source
  "sources": [ { "name": string, "url": string } ]  // the real sources you used, with working URLs
}`;

  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    tools: [{ type: "web_search_20250305", name: "web_search" } as any],
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find((block: any) => block.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  if (!textBlock) {
    throw new Error("No text content returned from market insight model");
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Market insight model did not return parseable JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const drivers: MarketDriver[] = Array.isArray(parsed.drivers)
    ? parsed.drivers
        .filter((d: any) => d && typeof d.title === "string")
        .map((d: any) => ({ title: d.title, detail: typeof d.detail === "string" ? d.detail : "" }))
        .slice(0, 5)
    : [];
  const outlook = typeof parsed.outlook === "string" ? parsed.outlook : "";
  const sources: MarketSource[] = Array.isArray(parsed.sources)
    ? parsed.sources
        .filter((s: any) => s && typeof s.url === "string")
        .map((s: any) => ({ name: typeof s.name === "string" ? s.name : s.url, url: s.url }))
    : [];

  if (drivers.length === 0 && !outlook) {
    throw new Error("Market insight model returned an empty result");
  }

  return { drivers, outlook, sources };
}

/**
 * Reads the cached MarketInsightCache row for (category, region). Returns
 * null if no row exists yet (caller should treat this as "not generated
 * yet", not an error). Never calls the live LLM.
 */
export async function getCachedMarketInsight(category: string, region: string): Promise<MarketInsight | null> {
  const row = await prisma.marketInsightCache.findUnique({ where: { category_region: { category, region } } });
  if (!row) return null;
  const stale = row.expiresAt.getTime() < Date.now();
  return cacheRowToInsight(row, stale);
}

async function refreshAndCache(category: string, region: string, existing: CacheRow | null): Promise<MarketInsight | null> {
  try {
    const live = await fetchLiveMarketInsight(category, region);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);
    const saved = await prisma.marketInsightCache.upsert({
      where: { category_region: { category, region } },
      update: {
        driversJson: live.drivers as any,
        outlook: live.outlook,
        sources: live.sources as any,
        generatedAt: now,
        expiresAt,
      },
      create: {
        category,
        region,
        driversJson: live.drivers as any,
        outlook: live.outlook,
        sources: live.sources as any,
        generatedAt: now,
        expiresAt,
      },
    });
    return cacheRowToInsight(saved, false);
  } catch (error) {
    console.error(`Market insight live refresh failed for ${category}/${region}:`, error);
    if (existing) {
      return cacheRowToInsight(existing, true);
    }
    return null;
  }
}

/**
 * Returns the cached insight if fresh; otherwise attempts a live refresh
 * and upserts the new result. On live-call failure, falls back to the
 * last cached row (marked stale) rather than surfacing an error to the
 * builder — a slow/broken external API should never break the report page.
 */
export async function getOrRefreshMarketInsight(category: string, region: string): Promise<MarketInsight | null> {
  const existing = await prisma.marketInsightCache.findUnique({ where: { category_region: { category, region } } });

  if (existing && existing.expiresAt.getTime() > Date.now()) {
    return cacheRowToInsight(existing, false);
  }

  return refreshAndCache(category, region, existing);
}

/** Result of a manual (builder-initiated) refresh attempt. */
export type ManualRefreshResult =
  | { rateLimited: true; retryAfterMs: number; insight: MarketInsight | null }
  | { rateLimited: false; insight: MarketInsight | null };

/**
 * Manual "Refresh" button entry point (module 7.6's rate-limited refresh).
 * Bypasses the 12h TTL check but enforces its own 10-minute cooldown since
 * the last generatedAt, so a builder cannot spam the external LLM call.
 * Reuses MarketInsightCache.generatedAt as the cooldown clock instead of
 * introducing a new rate-limit table.
 */
export async function forceRefreshMarketInsight(category: string, region: string): Promise<ManualRefreshResult> {
  const existing = await prisma.marketInsightCache.findUnique({ where: { category_region: { category, region } } });

  if (existing) {
    const elapsed = Date.now() - existing.generatedAt.getTime();
    if (elapsed < MANUAL_REFRESH_COOLDOWN_MS) {
      return {
        rateLimited: true,
        retryAfterMs: MANUAL_REFRESH_COOLDOWN_MS - elapsed,
        insight: cacheRowToInsight(existing, existing.expiresAt.getTime() < Date.now()),
      };
    }
  }

  const insight = await refreshAndCache(category, region, existing);
  return { rateLimited: false, insight };
}
