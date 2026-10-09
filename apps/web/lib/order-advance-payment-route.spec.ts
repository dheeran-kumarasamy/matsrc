// API-level tests for POST/GET /api/builder/orders/[id]/advance-payment —
// Advance Balance Payment Lifecycle fix. Prisma is mocked (same pattern as
// lib/order-cancellation-route.spec.ts) so this runs in the existing
// `lib/**/*.spec.ts` vitest suite with no real database.
//
// Covers the core fix: applying advance now RESERVES money (moves
// AVAILABLE -> RESERVED) instead of immediately/permanently debiting it,
// except when the reservation fully covers the order's outstanding amount,
// in which case it is consumed immediately (no external payment to wait
// for).

import { beforeEach, describe, expect, it, vi } from "vitest";

const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const orderTrackingCreate = vi.fn();
const customerAdvanceAccountFindUnique = vi.fn();
const customerAdvanceTransactionFindMany = vi.fn().mockResolvedValue([]);
const customerAdvanceTransactionCreate = vi.fn();
const customerAdvanceAccountUpdate = vi.fn();
const auditLogCreate = vi.fn().mockResolvedValue({});

// Stateful in-memory reservation store (keyed by orderId) — needed because
// upsertAdvanceReservation's create/update must be visible to the SAME
// request's subsequent consumeAdvanceReservation lookup (full-advance
// settlement case), exactly like a real database row would be within one
// transaction.
let reservationStore = new Map<string, any>();
const advanceReservationFindUnique = vi.fn(async (...args: any[]) => {
  const { where } = args[0];
  return reservationStore.get(where.orderId) ?? null;
});
const advanceReservationCreate = vi.fn(async (...args: any[]) => {
  const { data } = args[0];
  const row = { id: "res-1", consumedAt: null, releasedAt: null, ...data };
  reservationStore.set(data.orderId, row);
  return row;
});
const advanceReservationUpdate = vi.fn(async (...args: any[]) => {
  const { where, data } = args[0];
  const existing = reservationStore.get(where.orderId);
  const updated = { ...existing, ...data };
  reservationStore.set(where.orderId, updated);
  return updated;
});

function makeAccountRow(available: number, reserved: number) {
  return { id: "acct-1", buyerId: "owner", availableBalance: available, reservedBalance: reserved, status: "ACTIVE" };
}

vi.mock("@/lib/builder-db", () => {
  const prisma: any = {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      findUnique: (...args: unknown[]) => orderFindFirst(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
    },
    orderTracking: { create: (...args: unknown[]) => orderTrackingCreate(...args) },
    customerAdvanceAccount: {
      findUnique: (...args: unknown[]) => customerAdvanceAccountFindUnique(...args),
      update: (...args: unknown[]) => customerAdvanceAccountUpdate(...args),
    },
    customerAdvanceTransaction: {
      findMany: (...args: unknown[]) => customerAdvanceTransactionFindMany(...args),
      create: (...args: unknown[]) => customerAdvanceTransactionCreate(...args),
    },
    advanceReservation: {
      findUnique: (...args: unknown[]) => advanceReservationFindUnique(...args),
      create: (...args: unknown[]) => advanceReservationCreate(...args),
      update: (...args: unknown[]) => advanceReservationUpdate(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditLogCreate(...args) },
    $queryRaw: vi.fn(),
  };
  prisma.$transaction = (callback: (tx: unknown) => unknown) => callback(prisma);

  return {
    prisma,
    getOrCreateBuilder: async (userId: string) => ({ id: userId }),
    getUserCtx: (request: Request) => {
      const headers = request.headers;
      const userId = headers.get("X-User-Id");
      const email = headers.get("X-User-Email");
      if (!userId || !email) throw new Error("UNAUTHENTICATED");
      return { userId, email, name: headers.get("X-User-Name") || "Builder" };
    },
  };
});

const ORDER_ID = "order-1";

function makeRequest(amount: number) {
  return new Request(`http://localhost/api/builder/orders/${ORDER_ID}/advance-payment`, {
    method: "POST",
    headers: { "X-User-Id": "owner", "X-User-Email": "owner@example.com", "Content-Type": "application/json" },
    body: JSON.stringify({ amount }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  reservationStore = new Map();
  customerAdvanceTransactionFindMany.mockResolvedValue([]);
  auditLogCreate.mockResolvedValue({});

  orderFindFirst.mockResolvedValue({
    id: ORDER_ID,
    paymentStatus: "PENDING",
    status: "PROCESSING",
    enquiryId: "EQ/2601/00001",
    orderNumber: null,
    totalAmount: 120000,
  });
  customerAdvanceAccountFindUnique.mockResolvedValue({ id: "acct-1", status: "ACTIVE" });
  customerAdvanceTransactionCreate.mockImplementation(async ({ data }: any) => ({ id: "tx-1", ...data }));
  customerAdvanceAccountUpdate.mockImplementation(async ({ data }: any) => data);
});

describe("POST /api/builder/orders/[id]/advance-payment — partial reservation (core fix)", () => {
  it("reserves money instead of permanently debiting it, and keeps the order PENDING", async () => {
    const prismaModule: any = await import("@/lib/builder-db");
    prismaModule.prisma.$queryRaw.mockResolvedValue([makeAccountRow(100000, 0)]);

    const { POST } = await import("../app/api/builder/orders/[id]/advance-payment/route");
    const response = await POST(makeRequest(50000), { params: { id: ORDER_ID } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settled).toBe(false);
    expect(body.remainingOutstanding).toBe(70000);

    // The core fix: an ADVANCE_RESERVATION entry is written — NEVER an
    // immediate ORDER_PAYMENT debit for a partial reservation.
    expect(customerAdvanceTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ADVANCE_RESERVATION", amount: 50000 }) })
    );
    expect(orderUpdate).not.toHaveBeenCalled(); // order must stay PENDING — not marked PAID yet
  });

  it("is idempotent — reposting the exact same amount does not create a second reservation or move money again", async () => {
    const prismaModule: any = await import("@/lib/builder-db");
    prismaModule.prisma.$queryRaw.mockResolvedValue([makeAccountRow(100000, 0)]);

    const { POST } = await import("../app/api/builder/orders/[id]/advance-payment/route");
    await POST(makeRequest(50000), { params: { id: ORDER_ID } });

    // The reservationStore now holds an ACTIVE res-1 (amount 50000) from the
    // first call above — reflect the resulting account balances for the
    // retry, exactly like a real re-read inside the row-locked transaction.
    prismaModule.prisma.$queryRaw.mockResolvedValue([makeAccountRow(50000, 50000)]);
    customerAdvanceTransactionCreate.mockClear();

    const second = await POST(makeRequest(50000), { params: { id: ORDER_ID } });
    const body = await second.json();

    expect(second.status).toBe(200);
    expect(body.remainingOutstanding).toBe(70000);
    expect(customerAdvanceTransactionCreate).not.toHaveBeenCalled(); // true no-op
  });

  it("rejects an amount exceeding the available balance", async () => {
    const prismaModule: any = await import("@/lib/builder-db");
    prismaModule.prisma.$queryRaw.mockResolvedValue([makeAccountRow(10000, 0)]);

    const { POST } = await import("../app/api/builder/orders/[id]/advance-payment/route");
    const response = await POST(makeRequest(50000), { params: { id: ORDER_ID } });

    expect(response.status).toBe(400);
    expect(customerAdvanceTransactionCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/builder/orders/[id]/advance-payment — full advance settlement", () => {
  it("consumes the reservation immediately and marks the order PAID when advance covers the full outstanding amount", async () => {
    orderFindFirst.mockResolvedValue({
      id: ORDER_ID,
      paymentStatus: "PENDING",
      status: "PROCESSING",
      enquiryId: "EQ/2601/00001",
      orderNumber: null,
      totalAmount: 50000,
    });
    const prismaModule: any = await import("@/lib/builder-db");
    prismaModule.prisma.$queryRaw.mockResolvedValue([makeAccountRow(75000, 0)]);

    const { POST } = await import("../app/api/builder/orders/[id]/advance-payment/route");
    const response = await POST(makeRequest(50000), { params: { id: ORDER_ID } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settled).toBe(true);
    expect(body.remainingOutstanding).toBe(0);

    expect(customerAdvanceTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ADVANCE_RESERVATION" }) })
    );
    expect(customerAdvanceTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "ORDER_PAYMENT" }) })
    );
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ORDER_ID }, data: { paymentStatus: "PAID" } })
    );
  });
});

describe("POST /api/builder/orders/[id]/advance-payment — authorization/validation", () => {
  it("returns 404 for another buyer's order", async () => {
    orderFindFirst.mockResolvedValue(null);
    const { POST } = await import("../app/api/builder/orders/[id]/advance-payment/route");

    const response = await POST(makeRequest(10000), { params: { id: ORDER_ID } });
    expect(response.status).toBe(404);
  });

  it("rejects a negative amount", async () => {
    const { POST } = await import("../app/api/builder/orders/[id]/advance-payment/route");
    const response = await POST(makeRequest(-1), { params: { id: ORDER_ID } });
    expect(response.status).toBe(400);
  });

  it("rejects applying advance to an already-PAID order", async () => {
    orderFindFirst.mockResolvedValue({
      id: ORDER_ID,
      paymentStatus: "PAID",
      status: "PROCESSING",
      enquiryId: "EQ/2601/00001",
      orderNumber: null,
      totalAmount: 50000,
    });
    const { POST } = await import("../app/api/builder/orders/[id]/advance-payment/route");
    const response = await POST(makeRequest(10000), { params: { id: ORDER_ID } });
    expect(response.status).toBe(400);
  });
});
