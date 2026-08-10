import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  NativeHttpExtractorClient,
  parseJindalPantherHtml,
  parseAgniSteelsHtml,
  hasNativeParserForUrl,
} from "./native-http-extractor-client";

describe("parseJindalPantherHtml", () => {
  it("extracts real per-piece prices from the price-table, skipping '-' cells", () => {
    const html = `
      <table class="price-table">
        <tr><td>6 mm (500D)</td><td>226</td><td>-</td><td>-</td></tr>
        <tr><td>8 mm</td><td>384</td><td>406</td><td>392</td></tr>
      </table>
    `;
    const items = parseJindalPantherHtml(html);
    // Row1 (6mm): only 550D has a real value ("-" cells skipped) -> 1 item.
    // Row2 (8mm): all three grades have real values -> 3 items. Total: 4.
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ rawSkuLabel: "TMT Fe 550D 6 mm (500D)", rawPriceText: "226" });
  });

  it("returns an empty array when no price-table marker is present", () => {
    expect(parseJindalPantherHtml("<html><body>no table here</body></html>")).toEqual([]);
  });
});

describe("parseAgniSteelsHtml", () => {
  it("pairs prices with grade mentions in document order", () => {
    const html = "Fe 550 costs ₹ 72730 per MT. Also Fe 550 at ₹ 73930.";
    const items = parseAgniSteelsHtml(html);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ rawSkuLabel: "TMT Fe 550", rawPriceText: "72730" });
    expect(items[1]).toMatchObject({ rawSkuLabel: "TMT Fe 550", rawPriceText: "73930" });
  });

  it("returns an empty array when no ₹ prices exist", () => {
    expect(parseAgniSteelsHtml("<html>Fe 550 grade info, no prices</html>")).toEqual([]);
  });

  it("never fabricates a price for an unmatched grade mention", () => {
    const html = "Fe 550 Fe 600 ₹ 50000"; // 2 grades, 1 price -> only 1 item
    const items = parseAgniSteelsHtml(html);
    expect(items).toHaveLength(1);
  });
});

describe("hasNativeParserForUrl", () => {
  it("returns true for registered hostnames (with or without www.)", () => {
    expect(hasNativeParserForUrl("https://www.jindalpanther.com/recommended-consumer-price")).toBe(true);
    expect(hasNativeParserForUrl("https://agnisteels.com/pricing.php")).toBe(true);
  });

  it("returns false for unregistered hostnames", () => {
    expect(hasNativeParserForUrl("https://www.jswsteel.in")).toBe(false);
  });

  it("returns false for an invalid URL rather than throwing", () => {
    expect(hasNativeParserForUrl("not-a-url")).toBe(false);
  });
});

describe("NativeHttpExtractorClient.runActor", () => {
  const client = new NativeHttpExtractorClient();

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "Fe 550 ₹ 72730",
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns FAILED with no items for a hostname with no registered parser (no silent fallback)", async () => {
    const result = await client.runActor({ actorId: "x", url: "https://www.jswsteel.in" });
    expect(result.status).toBe("FAILED");
    expect(result.items).toEqual([]);
    expect(result.errorMessage).toMatch(/no native parser/i);
  });

  it("returns SUCCEEDED with extracted items for a registered hostname", async () => {
    const result = await client.runActor({ actorId: "x", url: "https://agnisteels.com/pricing.php" });
    expect(result.status).toBe("SUCCEEDED");
    expect(result.items).toHaveLength(1);
  });

  it("returns FAILED when the HTTP response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, text: async () => "" }))
    );
    const result = await client.runActor({ actorId: "x", url: "https://agnisteels.com/pricing.php" });
    expect(result.status).toBe("FAILED");
    expect(result.errorMessage).toMatch(/404/);
  });
});
