// Regression coverage for the checkout 500 bug: an unparseable
// `deliveryDate` string reached `new Date(options.deliveryDate)` in
// order-checkout.ts, silently producing an Invalid Date object that Prisma
// only rejected deep inside the per-supplier-group $transaction — surfacing
// to the customer as a generic 500 ("Failed to create order") instead of a
// clean, actionable validation error, and only after cart/site resolution
// and listing re-fetch had already run.
//
// Mocking pattern mirrors order-checkout-independence.spec.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const orderCreate = vi.fn();
const priceSnapshotCreate = vi.fn();

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    cartItem: {
      findMany: (...args: unknown[]) => cartItemFindMany(...args),
      deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
    },
    site: { findFirst: (...args: unknown[]) => siteFindFirst(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    order: { create: (...args: unknown[]) => orderCreate(...args) },
    priceSnapshot: { create: (...args: unknown[]) => priceSnapshotCreate(...args) },
    $transaction: (callback: any) => callback({ order: { create: orderCreate } }),
  },
  resolveUnitPrice: () => 100,
}));

const notifySupplierOrderSubmitted = vi.fn();
vi.mock("@/lib/notify", () => ({
  notifySupplierOrderSubmitted: (...args: unknown[]) => notifySupplierOrderSubmitted(...args),
}));

const generateEnquiryId = vi.fn();
const notifySupplierRfqReceived = vi.fn();
vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    generateEnquiryId: (...args: unknown[]) => generateEnquiryId(...args),
    notifySupplierRfqReceived: (...args: unknown[]) => notifySupplierRfqReceived(...args),
  };
});

const USER_ID = "builder-1";

beforeEach(() => {
  cartItemFindMany.mockReset();
  cartItemDeleteMany.mockReset();
  siteFindFirst.mockReset();
  userFindUnique.mockReset();
  orderCreate.mockReset();
  priceSnapshotCreate.mockReset();
  priceSnapshotCreate.mockResolvedValue({});
  cartItemDeleteMany.mockResolvedValue({ count: 1 });
  notifySupplierOrderSubmitted.mockReset();
  notifySupplierOrderSubmitted.mockResolvedValue(undefined);
  generateEnquiryId.mockReset();
  generateEnquiryId.mockResolvedValue("NEW-SITE01-000002");
  notifySupplierRfqReceived.mockReset();
  notifySupplierRfqReceived.mockImplementation(async (_tx: any, _params: any, onLog?: (msg: string) => void) => {
    onLog?.("ok");
  });

  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, headers: { get: () => "application/json" } })
  );

  cartItemFindMany.mockResolvedValue([
    {
      productId: "product-1",
      quantity: 2,
      product: {
        supplierId: "supplier-1",
        canonicalProductId: null,
        basePrice: 100,
        supplier: { companyName: "Acme Supplier" },
        pricingTiers: [],
      },
    },
  ]);

  siteFindFirst.mockResolvedValue({ id: "site-1" });
  userFindUnique.mockResolvedValue({ name: "Builder", email: "builder@example.com" });

  orderCreate.mockResolvedValue({
    id: "order-new",
    enquiryId: "NEW-SITE01-000002",
    status: "PLACED",
    totalAmount: 200,
    items: [{ id: "item-1" }],
  });
});

describe("createOrdersFromCart — deliveryDate validation", () => {
  it("rejects an unparseable deliveryDate with a clean 400 instead of letting an Invalid Date reach Prisma", async () => {
    const { createOrdersFromCart } = await import("./order-checkout");

    const result = await createOrdersFromCart(USER_ID, {
      siteId: "site-1",
      requireSiteId: true,
      deliveryDate: "not-a-date",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/delivery date/i);

    // No order/cart side effects occurred — the invalid date is caught
    // before any write.
    expect(orderCreate).not.toHaveBeenCalled();
    expect(cartItemDeleteMany).not.toHaveBeenCalled();
  });

  it("accepts a valid ISO deliveryDate and proceeds to create the order", async () => {
    const { createOrdersFromCart } = await import("./order-checkout");

    const result = await createOrdersFromCart(USER_ID, {
      siteId: "site-1",
      requireSiteId: true,
      deliveryDate: "2026-11-01",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it("treats a null/omitted deliveryDate as no delivery date (existing behaviour unchanged)", async () => {
    const { createOrdersFromCart } = await import("./order-checkout");

    const result = await createOrdersFromCart(USER_ID, { siteId: "site-1", requireSiteId: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });
});
