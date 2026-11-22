import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  closeCompetingSuppliersForOrder,
  GENERIC_ORDER_CLOSURE_REASON,
} from "./competing-supplier-closure";
import { OrderItemCandidateStatus, SupplierQuoteStatus, NotificationChannel } from "@prisma/client";

describe("closeCompetingSuppliersForOrder", () => {
  let mockDb: any;
  let updatedCandidates: any[];
  let updatedQuotes: any[];
  let createdNotifications: any[];
  let existingNotifications: Map<string, any>;

  beforeEach(() => {
    updatedCandidates = [];
    updatedQuotes = [];
    createdNotifications = [];
    existingNotifications = new Map();

    mockDb = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          enquiryId: "EQ/2608/00002",
          orderNumber: "OD/2608/00002",
        }),
      },
      orderItemSupplierCandidate: {
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          updatedCandidates.push({ where, data });
          if (where.supplierId?.$not || where.supplierId?.not) {
            return { count: 3 };
          }
          return { count: 1 };
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return [
            {
              id: "cand-ramesh",
              supplierId: "sup-ramesh",
              supplier: {
                id: "sup-ramesh",
                userId: "user-ramesh",
                companyName: "Ramesh Iron and Steel",
              },
            },
            {
              id: "cand-pioneer",
              supplierId: "sup-pioneer",
              supplier: {
                id: "sup-pioneer",
                userId: "user-pioneer",
                companyName: "Pioneer Steel",
              },
            },
          ];
        }),
      },
      supplierQuote: {
        updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
          updatedQuotes.push({ where, data });
          return { count: 2 };
        }),
        findMany: vi.fn().mockImplementation(async ({ where }) => {
          return [
            {
              supplier: {
                id: "sup-ramesh",
                userId: "user-ramesh",
                companyName: "Ramesh Iron and Steel",
              },
            },
          ];
        }),
      },
      notification: {
        findFirst: vi.fn().mockImplementation(async ({ where }) => {
          return existingNotifications.get(where.idempotencyKey) || null;
        }),
        create: vi.fn().mockImplementation(async ({ data }) => {
          createdNotifications.push(data);
          existingNotifications.set(data.idempotencyKey, { id: `notif-${createdNotifications.length}`, ...data });
          return { id: `notif-${createdNotifications.length}`, ...data };
        }),
      },
    };
  });

  it("marks winning supplier candidate as ACCEPTED and competing candidates as DECLINED with generic reason", async () => {
    const result = await closeCompetingSuppliersForOrder(mockDb, {
      orderId: "order-1",
      winningSupplierId: "sup-hindustan",
    });

    // 1. Winning candidate marked ACCEPTED
    const winUpdate = updatedCandidates.find((u) => u.where.supplierId === "sup-hindustan");
    expect(winUpdate).toBeDefined();
    expect(winUpdate.data.status).toBe(OrderItemCandidateStatus.ACCEPTED);
    expect(winUpdate.data.respondedAt).toBeInstanceOf(Date);

    // 2. Competing candidates marked DECLINED with generic reason
    const competingUpdate = updatedCandidates.find(
      (u) => u.where.supplierId?.not === "sup-hindustan" && u.where.status === OrderItemCandidateStatus.PENDING
    );
    expect(competingUpdate).toBeDefined();
    expect(competingUpdate.data.status).toBe(OrderItemCandidateStatus.DECLINED);
    expect(competingUpdate.data.declineReason).toBe(GENERIC_ORDER_CLOSURE_REASON);
    expect(competingUpdate.data.respondedAt).toBeInstanceOf(Date);
  });

  it("marks competing unselected supplier quotes as REJECTED with generic reason", async () => {
    await closeCompetingSuppliersForOrder(mockDb, {
      orderId: "order-1",
      winningSupplierId: "sup-hindustan",
    });

    const quoteUpdate = updatedQuotes.find(
      (u) => u.where.supplierId?.not === "sup-hindustan" && u.where.enquiryId === "order-1"
    );
    expect(quoteUpdate).toBeDefined();
    expect(quoteUpdate.data.status).toBe(SupplierQuoteStatus.REJECTED);
    expect(quoteUpdate.data.adminNotes).toBe(GENERIC_ORDER_CLOSURE_REASON);
  });

  it("creates in-app notifications for competing suppliers with the generic reason without leaking winner info", async () => {
    const result = await closeCompetingSuppliersForOrder(mockDb, {
      orderId: "order-1",
      winningSupplierId: "sup-hindustan",
      enquiryId: "EQ/2608/00002",
    });

    expect(result.notifiedSupplierIds).toContain("sup-ramesh");
    expect(result.notifiedSupplierIds).toContain("sup-pioneer");
    expect(createdNotifications).toHaveLength(2);

    for (const notif of createdNotifications) {
      expect(notif.audience).toBe("supplier");
      expect(notif.channel).toBe(NotificationChannel.IN_APP);
      expect(notif.title).toContain("EQ/2608/00002");
      expect(notif.body).toContain("is no longer required for fulfilment");
      expect(notif.body).toContain(GENERIC_ORDER_CLOSURE_REASON);
      // Strict privacy: Ensure winner identity or prices are NOT exposed
      expect(notif.body).not.toContain("Hindustan");
      expect(notif.body).not.toContain("₹");
      expect(notif.body).not.toContain("price");
      expect(notif.idempotencyKey).toMatch(/^competing-supplier-closed:order-1:/);
    }
  });

  it("is idempotent: calling twice does not create duplicate notifications", async () => {
    const firstCall = await closeCompetingSuppliersForOrder(mockDb, {
      orderId: "order-1",
      winningSupplierId: "sup-hindustan",
      enquiryId: "EQ/2608/00002",
    });
    expect(firstCall.notifiedSupplierIds).toHaveLength(2);

    // Second call
    const secondCall = await closeCompetingSuppliersForOrder(mockDb, {
      orderId: "order-1",
      winningSupplierId: "sup-hindustan",
      enquiryId: "EQ/2608/00002",
    });
    expect(secondCall.notifiedSupplierIds).toHaveLength(0);
    expect(createdNotifications).toHaveLength(2);
  });
});
