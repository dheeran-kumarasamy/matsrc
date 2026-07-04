import { describe, expect, it } from "vitest";
import { selectLowestValidQuote } from "./best-price-selection.service";

describe("selectLowestValidQuote", () => {
  it("picks the lowest price candidate", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "s1", unitPrice: 5100, leadTimeDays: 3, createdAt: new Date("2026-01-01T10:00:00Z") },
      { supplierId: "s2", unitPrice: 4800, leadTimeDays: 5, createdAt: new Date("2026-01-01T09:00:00Z") },
    ]);

    expect(winner.supplierId).toBe("s2");
    expect(winner.unitPrice).toBe(4800);
  });

  it("breaks price ties by lead time, then timestamp, then supplier id", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "s2", unitPrice: 4800, leadTimeDays: 5, createdAt: new Date("2026-01-01T09:00:00Z") },
      { supplierId: "s3", unitPrice: 4800, leadTimeDays: 2, createdAt: new Date("2026-01-01T09:30:00Z") },
      { supplierId: "s1", unitPrice: 4800, leadTimeDays: 2, createdAt: new Date("2026-01-01T09:30:00Z") },
    ]);

    expect(winner.supplierId).toBe("s1");
  });

  it("handles single quote", () => {
    const winner = selectLowestValidQuote([
      { supplierId: "single", unitPrice: 5000, createdAt: new Date("2026-01-01T00:00:00Z") },
    ]);

    expect(winner.supplierId).toBe("single");
  });

  it("throws when no valid quotes are present", () => {
    expect(() => selectLowestValidQuote([])).toThrow("No candidates available for best-price selection");
  });
});
