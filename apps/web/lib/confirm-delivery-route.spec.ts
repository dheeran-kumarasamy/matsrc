import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus } from "@matsrc/db";

const orderFindFirst = vi.fn();
const orderUpdate = vi.fn();
const orderTrackingCreate = vi.fn();
const notificationCreate = vi.fn();

vi.mock("@/lib/builder-db", () => {
  const prisma: any = {
    order: {
      findFirst: (...args: unknown[]) => orderFindFirst(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
    },
    orderTracking: {
      create: (...args: unknown[]) => orderTrackingCreate(...args),
    },
    notification: {
      create: (...args: unknown[]) => notificationCreate(...args),
    },
  };
  prisma.$transaction = async (callback: (tx: any) => Promise<unknown>) => callback(prisma);

  return {
    prisma,
    getUserCtx: () => ({ userId: "builder-user-1", email: "builder@example.com", name: "Builder One" }),
    getOrCreateBuilder: async () => ({ id: "builder-db-1", email: "builder@example.com", name: "Builder One" }),
  };
});

const notifyCustomerOrderStatusChanged = vi.fn().mockResolvedValue(undefined);
vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<any>("@matsrc/db");
  return {
    ...actual,
    notifyCustomerOrderStatusChanged: (...args: unknown[]) => notifyCustomerOrderStatusChanged(...args),
  };
});

import { POST } from "@/app/api/builder/orders/[id]/confirm-delivery/route";

describe("POST /api/builder/orders/[id]/confirm-delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("successfully transitions DISPATCHED order to DELIVERED and records verification tracking", async () => {
    orderFindFirst.mockResolvedValue({
      id: "order-101",
      userId: "builder-db-1",
      status: OrderStatus.DISPATCHED,
      orderNumber: "OD/2608/00001",
      enquiryId: "EQ/2608/00001",
      selectedSupplier: { id: "sup-1", userId: "sup-user-1", companyName: "Ramesh Iron" },
    });
    orderUpdate.mockResolvedValue({
      id: "order-101",
      status: OrderStatus.DELIVERED,
      orderNumber: "OD/2608/00001",
      enquiryId: "EQ/2608/00001",
    });
    orderTrackingCreate.mockResolvedValue({ id: "track-1" });

    const request = new Request("http://localhost:3000/api/builder/orders/order-101/confirm-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receivedDate: "22/11/2026",
        receivedBy: "Site Engineer Dave",
        notes: "All 5 bundles verified and undamaged",
      }),
    });

    const response = await POST(request, { params: { id: "order-101" } });
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.status).toBe(OrderStatus.DELIVERED);

    // Verify order status updated to DELIVERED
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "order-101" },
        data: expect.objectContaining({ status: OrderStatus.DELIVERED }),
      })
    );

    // Verify tracking entry recorded with site receiver and remarks
    expect(orderTrackingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orderId: "order-101",
          status: OrderStatus.DELIVERED,
          note: expect.stringContaining("Received by: Site Engineer Dave on 22/11/2026"),
        }),
      })
    );

    // Verify customer status notification scheduled
    expect(notifyCustomerOrderStatusChanged).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orderId: "order-101",
        previousStatus: OrderStatus.DISPATCHED,
        newStatus: OrderStatus.DELIVERED,
      })
    );
  });

  it("rejects delivery confirmation if order is not DISPATCHED (e.g. PROCESSING)", async () => {
    orderFindFirst.mockResolvedValue({
      id: "order-102",
      userId: "builder-db-1",
      status: OrderStatus.PROCESSING,
    });

    const request = new Request("http://localhost:3000/api/builder/orders/order-102/confirm-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request, { params: { id: "order-102" } });
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error).toMatch(/only be confirmed for dispatched orders/i);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 if order does not belong to the authenticated buyer", async () => {
    orderFindFirst.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/builder/orders/order-103/confirm-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request, { params: { id: "order-103" } });
    expect(response.status).toBe(404);
    expect(orderUpdate).not.toHaveBeenCalled();
  });
});

