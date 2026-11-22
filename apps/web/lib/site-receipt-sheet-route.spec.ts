// Route-level tests for GET /api/builder/orders/[id]/site-receipt-sheet/pdf.
// Placed under lib/ to match vitest.config.ts's include pattern ("lib/**/*.spec.ts").

import { describe, expect, it } from "vitest";
import { GET } from "../app/api/builder/orders/[id]/site-receipt-sheet/pdf/route";

describe("GET /api/builder/orders/[id]/site-receipt-sheet/pdf (Buyer Access Restriction)", () => {
  it("1. Returns 403 Forbidden indicating Delivery Challan is accessible only by administrators", async () => {
    const res = await GET();

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Delivery Challan is accessible only by administrators.");
  });
});
