// Route-level tests for GET/PATCH /api/supplier/notifications and
// PATCH /api/supplier/notifications/[id] — the Supplier Portal Alerts bell
// (components/supplier/NotificationBell.tsx). @matsrc/db and the auth
// session are mocked; no real database/network calls. Mirrors
// supplier-rfq-pdf-route.spec.ts's exact structure/conventions.

import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
  user: { email: "supplier@example.com" },
}));
const notificationFindMany = vi.fn();
const notificationCount = vi.fn();
const notificationFindFirst = vi.fn();
const notificationUpdate = vi.fn();
const notificationUpdateMany = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => authMock(),
}));

vi.mock("@matsrc/db", async () => {
  const actual = await vi.importActual<typeof import("@matsrc/db")>("@matsrc/db");
  return {
    ...actual,
    prisma: {
      notification: {
        findMany: (args: unknown) => notificationFindMany(args),
        count: (args: unknown) => notificationCount(args),
        findFirst: (args: unknown) => notificationFindFirst(args),
        update: (args: unknown) => notificationUpdate(args),
        updateMany: (args: unknown) => notificationUpdateMany(args),
      },
    },
  };
});

vi.mock("@/lib/supplier-data", () => ({
  ensureSupplierContext: vi.fn(async () => ({
    user: { id: "user-1" },
    supplierProfile: { id: "supplier-profile-1" },
  })),
}));

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { email: "supplier@example.com" } });
});

describe("GET /api/supplier/notifications", () => {
  it("returns 401 when there is no authenticated session", async () => {
    authMock.mockResolvedValue(null);

    const { GET } = await import("@/app/api/supplier/notifications/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/notifications"));

    expect(res.status).toBe(401);
    expect(notificationFindMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the authenticated supplier's own userId", async () => {
    notificationFindMany.mockResolvedValue([]);
    notificationCount.mockResolvedValue(0);

    const { GET } = await import("@/app/api/supplier/notifications/route");
    await GET(makeRequest("https://supplier.example.com/api/supplier/notifications"));

    expect(notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
    expect(notificationCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", read: false } })
    );
  });

  it("returns items + unreadCount, surfacing orderId parsed from variables", async () => {
    notificationFindMany.mockResolvedValue([
      {
        id: "notif-1",
        title: "New RFQ Received",
        body: "New quotation request",
        read: false,
        createdAt: new Date("2026-01-15"),
        variables: JSON.stringify({ orderId: "order-1" }),
      },
      {
        id: "notif-2",
        title: "Purchase Order generated",
        body: "PO ready",
        read: true,
        createdAt: new Date("2026-01-14"),
        variables: null,
      },
    ]);
    notificationCount.mockResolvedValue(1);

    const { GET } = await import("@/app/api/supplier/notifications/route");
    const res = await GET(makeRequest("https://supplier.example.com/api/supplier/notifications"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unreadCount).toBe(1);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].orderId).toBe("order-1");
    expect(body.items[1].orderId).toBeNull();
  });
});

describe("PATCH /api/supplier/notifications", () => {
  it("returns 401 when there is no authenticated session", async () => {
    authMock.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/supplier/notifications/route");
    const res = await PATCH(
      makeRequest("https://supplier.example.com/api/supplier/notifications", {
        method: "PATCH",
        body: JSON.stringify({ all: true }),
      })
    );

    expect(res.status).toBe(401);
    expect(notificationUpdateMany).not.toHaveBeenCalled();
  });

  it("marks every unread notification for this supplier as read when { all: true }", async () => {
    notificationUpdateMany.mockResolvedValue({ count: 3 });

    const { PATCH } = await import("@/app/api/supplier/notifications/route");
    const res = await PATCH(
      makeRequest("https://supplier.example.com/api/supplier/notifications", {
        method: "PATCH",
        body: JSON.stringify({ all: true }),
      })
    );

    expect(res.status).toBe(200);
    expect(notificationUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", read: false },
      data: { read: true },
    });
  });

  it("returns 400 for an unsupported PATCH body", async () => {
    const { PATCH } = await import("@/app/api/supplier/notifications/route");
    const res = await PATCH(
      makeRequest("https://supplier.example.com/api/supplier/notifications", {
        method: "PATCH",
        body: JSON.stringify({}),
      })
    );

    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/supplier/notifications/[id]", () => {
  it("returns 401 when there is no authenticated session", async () => {
    authMock.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/supplier/notifications/[id]/route");
    const res = await PATCH(
      makeRequest("https://supplier.example.com/api/supplier/notifications/notif-1", { method: "PATCH" }),
      { params: { id: "notif-1" } }
    );

    expect(res.status).toBe(401);
    expect(notificationFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 (never another user's notification) when no matching row belongs to this supplier", async () => {
    notificationFindFirst.mockResolvedValue(null);

    const { PATCH } = await import("@/app/api/supplier/notifications/[id]/route");
    const res = await PATCH(
      makeRequest("https://supplier.example.com/api/supplier/notifications/notif-1", { method: "PATCH" }),
      { params: { id: "notif-1" } }
    );

    expect(res.status).toBe(404);
    expect(notificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "notif-1", userId: "user-1" } })
    );
  });

  it("marks the matching notification as read", async () => {
    notificationFindFirst.mockResolvedValue({ id: "notif-1" });
    notificationUpdate.mockResolvedValue({ id: "notif-1", read: true });

    const { PATCH } = await import("@/app/api/supplier/notifications/[id]/route");
    const res = await PATCH(
      makeRequest("https://supplier.example.com/api/supplier/notifications/notif-1", { method: "PATCH" }),
      { params: { id: "notif-1" } }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.read).toBe(true);
    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: "notif-1" },
      data: { read: true },
      select: { id: true, read: true },
    });
  });
});
