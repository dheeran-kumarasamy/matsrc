import { describe, expect, it } from "vitest";
import { parseDailyPriceReplyInput } from "./whatsapp.utils";

describe("parseDailyPriceReplyInput", () => {
  it("parses a multi-line colon-separated price list", () => {
    const result = parseDailyPriceReplyInput("TMT 10mm: 56000\nTMT 12mm: 57500\nM-Sand: 2100");
    expect(result).toEqual([
      { product: "TMT 10mm", price: "56000" },
      { product: "TMT 12mm", price: "57500" },
      { product: "M-Sand", price: "2100" },
    ]);
  });

  it("parses a dash-separated price list with surrounding whitespace variations", () => {
    const result = parseDailyPriceReplyInput("TMT 10mm - 56000\nTMT 12mm  -  57500\nM-Sand - 2100");
    expect(result).toEqual([
      { product: "TMT 10mm", price: "56000" },
      { product: "TMT 12mm", price: "57500" },
      { product: "M-Sand", price: "2100" },
    ]);
  });

  it("handles a product name that itself contains a hyphen when using the colon separator", () => {
    const result = parseDailyPriceReplyInput("M-Sand: 2100");
    expect(result).toEqual([{ product: "M-Sand", price: "2100" }]);
  });

  it("supports a partial reply (fewer lines than required products)", () => {
    const result = parseDailyPriceReplyInput("TMT 10mm: 56000\nM-Sand: 2100");
    expect(result).toEqual([
      { product: "TMT 10mm", price: "56000" },
      { product: "M-Sand", price: "2100" },
    ]);
  });

  it("returns an empty array for plain conversational text with no parseable lines", () => {
    expect(parseDailyPriceReplyInput("hi there, how are you?")).toEqual([]);
    expect(parseDailyPriceReplyInput("MENU")).toEqual([]);
  });

  it("still parses an invalid (non-numeric) price token — validation is the caller's responsibility", () => {
    const result = parseDailyPriceReplyInput("TMT 10mm: abc");
    expect(result).toEqual([{ product: "TMT 10mm", price: "abc" }]);
  });

  it("ignores blank lines", () => {
    const result = parseDailyPriceReplyInput("TMT 10mm: 56000\n\nM-Sand: 2100\n");
    expect(result).toEqual([
      { product: "TMT 10mm", price: "56000" },
      { product: "M-Sand", price: "2100" },
    ]);
  });
});
