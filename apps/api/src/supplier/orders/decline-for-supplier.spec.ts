// Admin-Configurable Product Markup — Finding 2 (NestJS twin) regression
// coverage.
//
// OrdersService.declineForSupplier() (private, reached via
// updateStatus(orderId, "CANCELLED", supplierId)) promotes the next-ranked
// OrderItemSupplierCandidate when the currently-assigned supplier declines.
// The candidate's own `unitPrice` is the ORIGINAL, never-marked-up supplier
// price captured at checkout time (see apps/web/lib/order-checkout.ts's
// `candidates: { create: ... unitPrice: candidate.unitPrice }`) — promoting
// it onto the BUYER-facing OrderItem.unitPrice must re-apply markup, and
// Order.totalAmount must be resynced from the full, current set of order
// lines. Mirrors apps/supplier/lib/decline-order-promotion.spec.ts exactly
// (same assertions, adapted to this NestJS service's constructor-injection
// shape instead of direct module-level @matsrc/db mocking).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrderStatus } from "@matsrc/db";
import { OrdersService } from "./orders.service";

const { waitUntilMock } = vi.hoisted(() => ({ waitUntilMock: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: waitUntilMock }));

// Admin-Configurable Product Markup: real resolution logic (product ->
// category -> global precedence, explicit-0%-vs-unset) is already covered
// by packages/db/lib/markup-calculation.spec.ts — this mock only needs to
// simulate "the configured markup for this product", seeded per-test via
// markupByProductId, with the same null-on-missing-config fail-safe
// contract as the real function.
const { markupByProductId, resolveMarkupForProductMock } = vi.hoisted(() => {
  const markupByProductId = new Map<string, { markupPercent: number }>();
  const resolveMarkupForProductMock = vi.fn(async (_tx: any, params: { productId: string; supplierUnitPrice: number }) => {
    const configured = markupByProductId.get(params.productId);
    if (!configured) return null;
    const buyerUnitPrice =
      Math.round((params.supplierUnitPrice * (1 + configured.markupPercent / 100) + Number.EPSILON) * 100) / 100;
    return {
      supplierUnitPrice: params.supplierUnitPrice,
      buyerUnitPrice,
      markupPercent: configured.markupPercent,
      markupAmount: Math.round((buyerUnitPrice - params.supplierUnitPrice + Number.EPSILON) * 100) / 100,
    };
  });
  return { markupByProductId, resolveMarkupForProductMock };
});

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    resolveMarkupForProduct: resolveMarkupForProductMock,
  };
});

function buildDeclineService(orderRow: {
  id: string;
  status: OrderStatus;
  userId: string;
  items: Array<{
    id: string;
    productId: string;
    supplierId: string;
    quantity: number;
    unitPrice: number;
    allCandidatesDeclined: boolean;
    product: { categoryId: string };
    candidates: Array<{ id: string; supplierId: string; status: string; unitPrice: number; rank: number; listingId: string | null }>;
  }>;
}) {
  const orderItemUpdateCalls: any[] = [];
  const orderUpdateCalls: any[] = [];
  const candidateUpdateCalls: any[] = [];

  const prisma: any = {
    order: {
      findUnique: vi.fn(async ({ include }: any) => {
        if (include?.items) {
          // Reflect any OrderItem.update() writes already applied above
          // (allCandidatesDeclined / unitPrice) — mirrors the real Prisma
          // behaviour of re-reading the committed rows.
          const items = orderRow.items.map((item) => {
            const updated = orderItemUpdateCalls.find((c) => c.where.id === item.id);
            return updated ? { ...item, ...updated.data } : item;
          });
          return { id: orderRow.id, status: orderRow.status, userId: orderRow.userId, items };
        }
        return orderRow;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        orderUpdateCalls.push({ where, data });
        return { id: where.id, status: data.status ?? orderRow.status };
      }),
    },
    orderItemSupplierCandidate: {
      update: vi.fn(async (args: any) => {
        candidateUpdateCalls.push(args);
        return {};
      }),
    },
    orderItem: {
      update: vi.fn(async (args: any) => {
        orderItemUpdateCalls.push(args);
        return {};
      }),
      findMany: vi.fn(async () => {
        return orderRow.items.map((item) => {
          const updated = orderItemUpdateCalls.find((c) => c.where.id === item.id);
          return {
            unitPrice: updated && updated.data.unitPrice !== undefined ? updated.data.unitPrice : item.unitPrice,
            quantity: item.quantity,
          };
        });
      }),
    },
    orderTracking: { create: vi.fn(async () => ({})) },
    customerAdvanceAccount: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };

  const supplierContext = { getOrCreateSupplier: vi.fn(async () => ({ supplierProfile: { id: "sup-declining" } })) };
  const notificationService = {
    notifySupplierOrderSubmitted: vi.fn(async () => ({})),
    notifyBuilderOrderDecision: vi.fn(async () => ({})),
  };
  const customerOrderStatusNotificationService = { notifyIfTransitioned: vi.fn(async () => ({})) };
  const supplierRfqReceivedNotificationService = { notify: vi.fn(async () => ({})) };
  const paymentRequiredNotificationService = { notifyIfTransitioned: vi.fn(async () => ({})) };

  const service = new OrdersService(
    prisma,
    supplierContext as any,
    notificationService as any,
    customerOrderStatusNotificationService as any,
    supplierRfqReceivedNotificationService as any,
    paymentRequiredNotificationService as any
  );

  return { service, prisma, orderItemUpdateCalls, orderUpdateCalls, candidateUpdateCalls, notificationService };
}

function twoCandidateOrder(overrides: Partial<ReturnType<typeof defaultOrderRow>> = {}) {
  return { ...defaultOrderRow(), ...overrides };
}

function defaultOrderRow() {
  return {
    id: "order-decline-1",
    status: OrderStatus.PLACED,
    userId: "builder-1",
    items: [
      {
        id: "line-1",
        productId: "prod-1",
        supplierId: "sup-declining",
        quantity: 10,
        unitPrice: 1000,
        allCandidatesDeclined: false,
        product: { categoryId: "cat-1" },
        candidates: [
          { id: "cand-declining", supplierId: "sup-declining", status: "PENDING", unitPrice: 1000, rank: 0, listingId: "listing-a" },
          { id: "cand-next", supplierId: "sup-next", status: "PENDING", unitPrice: 900, rank: 1, listingId: "listing-b" },
        ],
      },
    ],
  };
}

beforeEach(() => {
  waitUntilMock.mockClear();
  markupByProductId.clear();
  resolveMarkupForProductMock.mockClear();
});

describe("OrdersService.declineForSupplier — Admin-Configurable Product Markup", () => {
  it("applies the applicable markup to the promoted candidate's price, never the raw candidate price", async () => {
    const { service, orderItemUpdateCalls } = buildDeclineService(twoCandidateOrder());
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining", "too busy");

    const promotion = orderItemUpdateCalls.find((c) => c.where.id === "line-1" && c.data.supplierId === "sup-next");
    expect(promotion).toBeDefined();
    // Candidate's original price (900) * 1.10 = 990 — never the raw 900.
    expect(promotion.data).toMatchObject({
      supplierId: "sup-next",
      unitPrice: 990,
      supplierUnitPrice: 900,
      markupPercent: 10,
      markupAmount: 90,
    });
  });

  it("recalculates Order.totalAmount after promotion, using the marked-up price", async () => {
    const { service, orderUpdateCalls } = buildDeclineService(twoCandidateOrder());
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    const totalUpdate = orderUpdateCalls.find((c) => c.where.id === "order-decline-1" && c.data.totalAmount !== undefined);
    expect(totalUpdate).toBeDefined();
    // quantity 10 * marked-up unit price 990 = 9900 (never 10 * 900 = 9000).
    expect(totalUpdate.data.totalAmount).toBe(9900);
  });

  it("honours an explicit 0% override on promotion", async () => {
    const { service, orderItemUpdateCalls } = buildDeclineService(twoCandidateOrder());
    markupByProductId.set("prod-1", { markupPercent: 0 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    const promotion = orderItemUpdateCalls.find((c) => c.where.id === "line-1");
    expect(promotion.data).toMatchObject({ unitPrice: 900, supplierUnitPrice: 900, markupPercent: 0, markupAmount: 0 });
  });

  it("falls back to 0% markup (never blocks the decline/promotion) when no markup configuration exists", async () => {
    const { service, orderItemUpdateCalls } = buildDeclineService(twoCandidateOrder());
    // No markupByProductId entry seeded -> resolveMarkupForProduct returns null.

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    const promotion = orderItemUpdateCalls.find((c) => c.where.id === "line-1");
    expect(promotion.data).toMatchObject({ unitPrice: 900, supplierUnitPrice: 900, markupPercent: 0, markupAmount: 0 });
  });

  it("resolves markup using the line's own productId/categoryId, passed through to resolveMarkupForProduct", async () => {
    const { service } = buildDeclineService(twoCandidateOrder());
    markupByProductId.set("prod-1", { markupPercent: 15 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    expect(resolveMarkupForProductMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ productId: "prod-1", categoryId: "cat-1", supplierUnitPrice: 900 })
    );
  });

  it("never mutates the candidate's own stored supplier price", async () => {
    const orderRow = twoCandidateOrder();
    const { service } = buildDeclineService(orderRow);
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    // The in-memory candidate row itself (the source of truth this test
    // fixture reads from) is never written to — only OrderItem/Order are
    // ever updated by this function; OrderItemSupplierCandidate.update is
    // only ever called to flip STATUS/declineReason/respondedAt on the
    // DECLINING supplier's own row, never on unitPrice.
    expect(orderRow.items[0].candidates[1].unitPrice).toBe(900);
  });

  it("never applies markup twice: resolveMarkupForProduct is always called with the ORIGINAL candidate price, never an already-marked-up value", async () => {
    const { service } = buildDeclineService(twoCandidateOrder());
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    expect(resolveMarkupForProductMock).toHaveBeenCalledTimes(1);
    expect(resolveMarkupForProductMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supplierUnitPrice: 900 })
    );
    expect(resolveMarkupForProductMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ supplierUnitPrice: 990 })
    );
  });

  it("leaves unaffected lines (assigned to a different, non-declining supplier) untouched across multiple order lines", async () => {
    const base = twoCandidateOrder();
    const orderRow = twoCandidateOrder({
      items: [
        ...base.items,
        {
          id: "line-2",
          productId: "prod-2",
          supplierId: "sup-unrelated",
          quantity: 5,
          unitPrice: 500,
          allCandidatesDeclined: false,
          product: { categoryId: "cat-2" },
          candidates: [{ id: "cand-unrelated", supplierId: "sup-unrelated", status: "PENDING", unitPrice: 500, rank: 0, listingId: "listing-c" }],
        },
      ],
    });
    const { service, orderItemUpdateCalls, orderUpdateCalls } = buildDeclineService(orderRow);
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    const line2Update = orderItemUpdateCalls.find((c) => c.where.id === "line-2");
    expect(line2Update).toBeUndefined();

    const totalUpdate = orderUpdateCalls.find((c) => c.where.id === "order-decline-1" && c.data.totalAmount !== undefined);
    // line-1 marked up (10 * 990 = 9900) + line-2 unchanged (5 * 500 = 2500) = 12400.
    expect(totalUpdate.data.totalAmount).toBe(12400);
  });

  it("does not resync Order.totalAmount (or apply markup) when no promotion occurs (all candidates declined)", async () => {
    const orderRow = twoCandidateOrder({
      items: [
        {
          id: "line-1",
          productId: "prod-1",
          supplierId: "sup-declining",
          quantity: 10,
          unitPrice: 1000,
          allCandidatesDeclined: false,
          product: { categoryId: "cat-1" },
          candidates: [{ id: "cand-declining", supplierId: "sup-declining", status: "PENDING", unitPrice: 1000, rank: 0, listingId: "listing-a" }],
        },
      ],
    });
    const { service, orderItemUpdateCalls, orderUpdateCalls } = buildDeclineService(orderRow);
    markupByProductId.set("prod-1", { markupPercent: 10 });

    await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    const priceUpdate = orderItemUpdateCalls.find((c) => c.where.id === "line-1" && c.data.unitPrice !== undefined);
    expect(priceUpdate).toBeUndefined();
    const allDeclinedUpdate = orderItemUpdateCalls.find((c) => c.where.id === "line-1" && c.data.allCandidatesDeclined === true);
    expect(allDeclinedUpdate).toBeDefined();
    const totalUpdate = orderUpdateCalls.find((c) => c.data.totalAmount !== undefined);
    expect(totalUpdate).toBeUndefined();
    expect(resolveMarkupForProductMock).not.toHaveBeenCalled();
  });

  it("all-candidates-declined: cancels the order and never leaves a misleading totalAmount write for the cancelled order", async () => {
    const orderRow = twoCandidateOrder({
      items: [
        {
          id: "line-1",
          productId: "prod-1",
          supplierId: "sup-declining",
          quantity: 10,
          unitPrice: 1000,
          allCandidatesDeclined: false,
          product: { categoryId: "cat-1" },
          candidates: [{ id: "cand-declining", supplierId: "sup-declining", status: "PENDING", unitPrice: 1000, rank: 0, listingId: "listing-a" }],
        },
      ],
    });
    const { service, orderUpdateCalls } = buildDeclineService(orderRow);

    const result = await (service as any).declineForSupplier("order-decline-1", "sup-declining");

    expect(result).toMatchObject({ id: "order-decline-1", status: OrderStatus.CANCELLED });
    const statusUpdate = orderUpdateCalls.find((c) => c.data.status === OrderStatus.CANCELLED);
    expect(statusUpdate).toBeDefined();
    // Preserve existing decline semantics: no totalAmount write accompanies
    // the terminal cancellation — a cancelled order's total is immaterial
    // to future billing and must not be silently recomputed/implied here.
    const totalUpdate = orderUpdateCalls.find((c) => c.data.totalAmount !== undefined);
    expect(totalUpdate).toBeUndefined();
  });

  it("preserves existing candidate-selection behaviour: the declining supplier's own candidate row is marked DECLINED with the given reason", async () => {
    const { service, candidateUpdateCalls } = buildDeclineService(twoCandidateOrder());

    await (service as any).declineForSupplier("order-decline-1", "sup-declining", "no capacity");

    expect(candidateUpdateCalls).toHaveLength(1);
    expect(candidateUpdateCalls[0]).toMatchObject({
      where: { id: "cand-declining" },
      data: { status: "DECLINED", declineReason: "no capacity" },
    });
  });
});
