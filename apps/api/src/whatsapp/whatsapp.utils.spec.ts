import { describe, expect, it } from "vitest";
import {
  isSameKeyword,
  parseDailyPriceReplyInput,
  parseSelectedSerials,
  parseSerialPriceInput,
} from "./whatsapp.utils";

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

describe("parseSelectedSerials", () => {
  it("parses comma-separated numbers", () => {
    expect(parseSelectedSerials("2, 3")).toEqual([2, 3]);
    expect(parseSelectedSerials("1,2,3")).toEqual([1, 2, 3]);
    expect(parseSelectedSerials("  4 ,  5  ")).toEqual([4, 5]);
  });

  it("parses space-separated numbers", () => {
    expect(parseSelectedSerials("2 3")).toEqual([2, 3]);
    expect(parseSelectedSerials("1 2 5")).toEqual([1, 2, 5]);
  });

  it("parses a single number", () => {
    expect(parseSelectedSerials("2")).toEqual([2]);
    expect(parseSelectedSerials("  12  ")).toEqual([12]);
  });

  it("ignores non-numeric noise and duplicates", () => {
    expect(parseSelectedSerials("update 2, 3 please")).toEqual([2, 3]);
    expect(parseSelectedSerials("2, 2, 3")).toEqual([2, 3]);
    expect(parseSelectedSerials("none")).toEqual([]);
  });
});

describe("parseSerialPriceInput", () => {
  it("parses dash-separated serial and price", () => {
    expect(parseSerialPriceInput("2 - 1520")).toEqual([{ serial: 2, price: 1520 }]);
    expect(parseSerialPriceInput("2 - 1520\n3 - 64500")).toEqual([
      { serial: 2, price: 1520 },
      { serial: 3, price: 64500 },
    ]);
  });

  it("parses colon-separated and equals-separated serial and price", () => {
    expect(parseSerialPriceInput("2: 1520, 3: 64500")).toEqual([
      { serial: 2, price: 1520 },
      { serial: 3, price: 64500 },
    ]);
    expect(parseSerialPriceInput("2 = 1520")).toEqual([{ serial: 2, price: 1520 }]);
  });

  it("parses space-separated serial and price", () => {
    expect(parseSerialPriceInput("2 1520")).toEqual([{ serial: 2, price: 1520 }]);
  });

  it("cleans currency symbol and commas from prices", () => {
    expect(parseSerialPriceInput("2 - ₹1,520")).toEqual([{ serial: 2, price: 1520 }]);
    expect(parseSerialPriceInput("3: ₹64,500.50")).toEqual([{ serial: 3, price: 64500.5 }]);
  });

  it("filters by expectedSerials when supplied", () => {
    expect(parseSerialPriceInput("1 - 400, 2 - 1520, 3 - 64500", [2, 3])).toEqual([
      { serial: 2, price: 1520 },
      { serial: 3, price: 64500 },
    ]);
  });

  it("supports 'and' and semicolon separators with mixed spacing", () => {
    expect(parseSerialPriceInput("4 -300 and 5-299", [4, 5])).toEqual([
      { serial: 4, price: 300 },
      { serial: 5, price: 299 },
    ]);
    expect(parseSerialPriceInput("1: 400; 2 = 1520")).toEqual([
      { serial: 1, price: 400 },
      { serial: 2, price: 1520 },
    ]);
  });
});

describe("isSameKeyword", () => {
  it("identifies SAME variants", () => {
    expect(isSameKeyword("SAME")).toBe(true);
    expect(isSameKeyword("same")).toBe(true);
    expect(isSameKeyword("ALL SAME")).toBe(true);
    expect(isSameKeyword("NO CHANGE")).toBe(true);
    expect(isSameKeyword("UNCHANGED")).toBe(true);
    expect(isSameKeyword("  no change  ")).toBe(true);
  });

  it("returns false for non-SAME inputs", () => {
    expect(isSameKeyword("2, 3")).toBe(false);
    expect(isSameKeyword("2 - 1500")).toBe(false);
    expect(isSameKeyword("DIFFERENT")).toBe(false);
  });
});
