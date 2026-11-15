import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";

// Mock delegates for testing checkout optimizations and concurrency
const cartItemFindMany = vi.fn();
const cartItemDeleteMany = vi.fn();
const siteFindFirst = vi.fn();
const userFindUnique = vi.fn();
const productFindMany = vi.fn();
const orderCreate = vi.fn();
const orderItemSupplierCandidateCreateMany = vi.fn();
const priceSnapshotCreateMany = vi.fn();
const markupSettingFindMany = vi.fn();
const cartIdempotencyFindUnique = vi.fn();
const cartIdempotencyCreate = vi.fn();

let sequenceValue = 0;
const businessSequenceUpsert = vi.fn();
const businessSequenceUpdate = vi.fn(async ({ where, data }: any) => {
  const inc = data.value?.increment ?? 1;
  sequenceValue += inc;
  return { value: sequenceValue };
});

const queryRaw = vi.fn(async (strings: any, ...values: any[]) => {
  const sql = Array.isArray(strings) ? strings.join(" ") : String(strings);
  if (sql.includes("CartItem")) {
    return [
      { id: "cart-item-1", quantity: 150 },
      { id: "cart-item-2", quantity: 100 },
    ];
  }
  return [{ value: sequenceValue }];
});

vi.mock("@/lib/builder-db", () => ({
  prisma: {
    cartItem: {
      findMany: (...args: unknown[]) => cartItemFindMany(...args),
      deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
    },
    site: { findFirst: (...args: unknown[]) => siteFindFirst(...args) },
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    product: { findMany: (...args: unknown[]) => productFindMany(...args) },
    order: { create: (...args: unknown[]) => orderCreate(...args) },
    orderItemSupplierCandidate: {
      createMany: (...args: unknown[]) => orderItemSupplierCandidateCreateMany(...args),
    },
    priceSnapshot: {
      createMany: (...args: unknown[]) => priceSnapshotCreateMany(...args),
    },
    markupSetting: { findMany: (...args: unknown[]) => markupSettingFindMany(...args) },
    cartIdempotency: {
      findUnique: (...args: unknown[]) => cartIdempotencyFindUnique(...args),
      create: (...args: unknown[]) => cartIdempotencyCreate(...args),
    },
    businessSequence: {
      upsert: (...args: any[]) => (businessSequenceUpsert as any)(...args),
      update: (...args: any[]) => (businessSequenceUpdate as any)(...args),
    },
    $queryRaw: (...args: any[]) => (queryRaw as any)(...args),
    $transaction: async (callback: any, options?: any) => {
      const tx = {
        order: { create: orderCreate },
        orderItemSupplierCandidate: {
          createMany: orderItemSupplierCandidateCreateMany,
        },
        cartItem: {
          findMany: (...args: unknown[]) => cartItemFindMany(...args),
          deleteMany: (...args: unknown[]) => cartItemDeleteMany(...args),
        },
        cartIdempotency: {
          create: cartIdempotencyCreate,
        },
        businessSequence: {
          upsert: businessSequenceUpsert,
          update: businessSequenceUpdate,
        },
        $queryRaw: (...args: any[]) => (queryRaw as any)(...args),
      };
      return callback(tx);
    },
  },
  resolveUnitPrice: () => -1,
}));

const notifySupplierOrderSubmitted = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/notify", () => ({
  notifySupplierOrderSubmitted: (...args: unknown[]) => notifySupplierOrderSubmitted(...args),
}));

const notifySupplierRfqReceived = vi.fn().mockResolvedValue(undefined);
vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    notifySupplierRfqReceived: (...args: unknown[]) => notifySupplierRfqReceived(...args),
  };
});

import { createOrdersFromCart } from "./order-checkout";

describe("Matsrc Checkout Performance & Concurrency Hardening (P0 & P1)", () => {
  const USER_ID = "builder-perf-1";
  const SITE_ID = "site-perf-1";

  const PRODUCT_A = {
    id: "prod-a",
    name: "TMT Rebars 16mm",
    supplierId: "supplier-1",
    categoryId: "cat-steel",
    canonicalProductId: "canon-tmt-16",
    basePrice: 50,
    stock: 5000,
    maxServiceableQty: 5000,
    isActive: true,
    supplier: { companyName: "Apex Steel Ltd" },
    pricingTiers: [
      { minQty: 1, maxQty: 100, tierPrice: 50 },
      { minQty: 101, maxQty: 5000, tierPrice: 48 },
    ],
  };

  const PRODUCT_B = {
    id: "prod-b",
    name: "Portland Pozzolana Cement",
    supplierId: "supplier-2",
    categoryId: "cat-cement",
    canonicalProductId: "canon-ppc-50kg",
    basePrice: 350,
    stock: 1000,
    maxServiceableQty: 1000,
    isActive: true,
    supplier: { companyName: "Bharat Cement Corp" },
    pricingTiers: [
      { minQty: 1, maxQty: 50, tierPrice: 350 },
      { minQty: 51, maxQty: 1000, tierPrice: 330 },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    sequenceValue = 0;

    cartItemFindMany.mockResolvedValue([
      {
        id: "cart-item-1",
        productId: "prod-a",
        quantity: 150,
        product: {
          supplierId: "supplier-1",
          canonicalProductId: "canon-tmt-16",
          categoryId: "cat-steel",
          basePrice: 50,
          supplier: { companyName: "Apex Steel Ltd" },
          pricingTiers: PRODUCT_A.pricingTiers,
        },
      },
      {
        id: "cart-item-2",
        productId: "prod-b",
        quantity: 100,
        product: {
          supplierId: "supplier-2",
          canonicalProductId: "canon-ppc-50kg",
          categoryId: "cat-cement",
          basePrice: 350,
          supplier: { companyName: "Bharat Cement Corp" },
          pricingTiers: PRODUCT_B.pricingTiers,
        },
      },
    ]);

    productFindMany.mockResolvedValue([PRODUCT_A, PRODUCT_B]);
    siteFindFirst.mockResolvedValue({ id: SITE_ID });
    userFindUnique.mockResolvedValue({ name: "Ramesh Builder", email: "ramesh@example.com" });
    markupSettingFindMany.mockResolvedValue([]);
    cartItemDeleteMany.mockResolvedValue({ count: 2 });
    cartIdempotencyFindUnique.mockResolvedValue(null);
    cartIdempotencyCreate.mockResolvedValue({ id: "idemp-row-1" });

    let orderCounter = 0;
    orderCreate.mockImplementation(async ({ data }: any) => {
      orderCounter++;
      return {
        id: `order-db-${orderCounter}`,
        enquiryId: data.enquiryId,
        status: data.status,
        totalAmount: data.totalAmount,
        items: data.items.create.map((item: any, idx: number) => ({
          id: `order-item-db-${orderCounter}-${idx + 1}`,
          productId: item.productId,
        })),
      };
    });

    orderItemSupplierCandidateCreateMany.mockResolvedValue({ count: 2 });
    priceSnapshotCreateMany.mockResolvedValue({ count: 2 });
  });

  describe("P0: BusinessSequence Lock Decoupling & Batch Allocation", () => {
    it("allocates distinct enquiry IDs for multi-supplier groups using isolated sequence allocation", async () => {
      const result = await createOrdersFromCart(USER_ID, {
        siteId: SITE_ID,
        requireSiteId: true,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Cart had items from 2 suppliers -> 2 distinct orders created
      expect(result.orders).toHaveLength(2);

      const [order1, order2] = result.orders;
      expect(order1.enquiryId).toMatch(/^EQ\/\d{4}\/\d{5}$/);
      expect(order2.enquiryId).toMatch(/^EQ\/\d{4}\/\d{5}$/);

      // Enquiry numbers must be strictly distinct and monotonic
      expect(order1.enquiryId).not.toBe(order2.enquiryId);
    });

    it("prevents global sequence lock contention across concurrent checkout submissions", async () => {
      // Simulate two concurrent checkout invocations from different users
      const checkout1 = createOrdersFromCart("user-1", { siteId: SITE_ID, requireSiteId: true });
      const checkout2 = createOrdersFromCart("user-2", { siteId: SITE_ID, requireSiteId: true });

      const [res1, res2] = await Promise.all([checkout1, checkout2]);

      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);

      if (!res1.ok || !res2.ok) return;

      const allEnquiryIds = [...res1.orders.map((o) => o.enquiryId), ...res2.orders.map((o) => o.enquiryId)];
      expect(allEnquiryIds).toHaveLength(4);

      // Every enquiry ID across both concurrent checkouts must be unique
      const uniqueIds = new Set(allEnquiryIds);
      expect(uniqueIds.size).toBe(4);
    });
  });

  describe("P0: Batch Supplier Candidate Inserts", () => {
    it("batches candidate supplier inserts using createMany without skipDuplicates", async () => {
      const result = await createOrdersFromCart(USER_ID, {
        siteId: SITE_ID,
        requireSiteId: true,
      });

      expect(result.ok).toBe(true);

      // Verify orderItemSupplierCandidate.createMany was called instead of individual N+1 inserts
      expect(orderItemSupplierCandidateCreateMany).toHaveBeenCalledTimes(1);

      const batchCall = orderItemSupplierCandidateCreateMany.mock.calls[0][0];
      expect(batchCall).toHaveProperty("data");
      expect(Array.isArray(batchCall.data)).toBe(true);
      expect(batchCall.data.length).toBeGreaterThanOrEqual(2);

      // Verify candidates contain correct rank and foreign keys
      const candidate1 = batchCall.data[0];
      expect(candidate1).toHaveProperty("orderItemId");
      expect(candidate1).toHaveProperty("supplierId");
      expect(candidate1).toHaveProperty("rank");
      expect(candidate1.rank).toBe(0);

      // Verify no skipDuplicates is used to hide data integrity issues
      expect(batchCall).not.toHaveProperty("skipDuplicates");
    });
  });

  describe("P0: Duplicate Submission & Cart Idempotency Protection", () => {
    it("records idempotency key atomically upon successful order creation", async () => {
      const idempotencyKey = "uuid-checkout-attempt-1";

      const result = await createOrdersFromCart(USER_ID, {
        siteId: SITE_ID,
        requireSiteId: true,
        idempotencyKey,
      });

      expect(result.ok).toBe(true);
      expect(cartIdempotencyCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_ID,
            key: idempotencyKey,
            responseStatus: 201,
          }),
        })
      );
    });

    it("replays cached order summary for identical retry without creating duplicate orders", async () => {
      const idempotencyKey = "uuid-checkout-retry-1";
      const expectedFingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            userId: USER_ID,
            siteId: SITE_ID,
            itemIds: ["cart-item-1", "cart-item-2"],
            deliveryDate: null,
          })
        )
        .digest("hex");

      // Mock that this key was previously completed with matching fingerprint
      cartIdempotencyFindUnique.mockResolvedValue({
        userId: USER_ID,
        key: idempotencyKey,
        requestFingerprint: expectedFingerprint,
        responseStatus: 201,
        responsePayload: {
          orders: [
            {
              id: "cached-order-1",
              enquiryId: "EQ/2604/00088",
              supplierName: "Apex Steel Ltd",
              total: 7200,
              itemCount: 1,
              status: "PLACED",
              itemIds: ["cached-item-1"],
            },
          ],
        },
      });

      // Synchronously match fingerprint
      const result = await createOrdersFromCart(USER_ID, {
        siteId: SITE_ID,
        requireSiteId: true,
        idempotencyKey,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.orders).toHaveLength(1);
      expect(result.orders[0].enquiryId).toBe("EQ/2604/00088");

      // Verify no new orders were created in database
      expect(orderCreate).not.toHaveBeenCalled();
      expect(cartItemDeleteMany).not.toHaveBeenCalled();
    });

    it("rejects request if idempotency key is reused with mismatched payload (409)", async () => {
      const idempotencyKey = "uuid-conflict-key";

      cartIdempotencyFindUnique.mockResolvedValue({
        userId: USER_ID,
        key: idempotencyKey,
        requestFingerprint: "fingerprint-for-different-cart-items",
        responseStatus: 201,
        responsePayload: { orders: [] },
      });

      const result = await createOrdersFromCart(USER_ID, {
        siteId: SITE_ID,
        requireSiteId: true,
        idempotencyKey,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.status).toBe(409);
      expect(result.error).toContain("Idempotency key was previously used with a different request payload");
    });
  });

  describe("P1: Post-Checkout Bounded Concurrency & Connection Pool Protection", () => {
    it("batches price snapshots using createMany instead of individual serial writes", async () => {
      const result = await createOrdersFromCart(USER_ID, {
        siteId: SITE_ID,
        requireSiteId: true,
      });

      expect(result.ok).toBe(true);
      expect(priceSnapshotCreateMany).toHaveBeenCalledTimes(1);

      const snapshotCall = priceSnapshotCreateMany.mock.calls[0][0];
      expect(snapshotCall.data).toHaveLength(2);
      expect(snapshotCall.data[0].source).toBe("ORDER");
    });

    it("safely isolates notification failures without failing the checkout response", async () => {
      // Simulate supplier WhatsApp notification rejecting with a network error
      notifySupplierOrderSubmitted.mockRejectedValueOnce(new Error("Twilio network timeout"));

      const result = await createOrdersFromCart(USER_ID, {
        siteId: SITE_ID,
        requireSiteId: true,
      });

      // Checkout response must still succeed 100%
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.orders).toHaveLength(2);
    });
  });
});
