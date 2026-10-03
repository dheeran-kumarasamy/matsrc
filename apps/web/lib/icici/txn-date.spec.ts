import { describe, expect, it } from "vitest";
import { formatIciciTxnDate } from "./txn-date";

describe("formatIciciTxnDate", () => {
  it("formats as 'yyyy-MM-dd HH:mm:ss' with no milliseconds/timezone designator", () => {
    const date = new Date("2026-10-03T18:59:24.826Z");
    const formatted = formatIciciTxnDate(date);
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("converts UTC input to IST (UTC+5:30), not the server's local time", () => {
    // 18:59:24 UTC -> 00:29:24 IST the next day (UTC+5:30).
    const date = new Date("2026-10-03T18:59:24.826Z");
    expect(formatIciciTxnDate(date)).toBe("2026-10-04 00:29:24");
  });

  it("handles a time that does not cross a day boundary in IST", () => {
    // 04:00:00 UTC -> 09:30:00 IST same day.
    const date = new Date("2026-01-15T04:00:00.000Z");
    expect(formatIciciTxnDate(date)).toBe("2026-01-15 09:30:00");
  });

  it("zero-pads single-digit month/day/hour/minute/second components", () => {
    // 2026-01-01T00:01:00Z -> 2026-01-01 05:31:00 IST.
    const date = new Date("2026-01-01T00:01:00.000Z");
    expect(formatIciciTxnDate(date)).toBe("2026-01-01 05:31:00");
  });
});
