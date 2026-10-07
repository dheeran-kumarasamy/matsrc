import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrderStatus } from "@prisma/client";
import {
  notifyCustomerOrderStatusChanged,
  getCustomerOrderStatusWhatsAppMode,
} from "./customer-order-status-notification";

// End-to-end style tests exercising the REAL policy-evaluation and Meta-send
// logic in this module (only Prisma and `fetch` are faked) — this is the one
// shared implementation both apps/api's NestJS wrapper
// (customer-order-status-notification.service.ts) and apps/supplier
// (directly) call, so correctness here is correctness for both apps.

const ORDER_STATUS_POLICY = {
  enabled: true,
  templateName: "customer_order_status",
  channel: "WHATSAPP",
  priority: "P1",
};

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-1",
    userId: "user-1",
    enquiryId: "BH-2026-00452",
    user: { id: "user-1", phone: "919876543210", whatsappNumber: null },
    ...overrides,
  };
}

function buildHarness(options: { policyEnabled?: boolean; globalEnabled?: boolean; order?: any } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    order: { findUnique: vi.fn().mockResolvedValue(options.order ?? makeOrder()) },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue({ ...ORDER_STATUS_POLICY, enabled: options.policyEnabled ?? true }),
    },
    notificationGlobalSettings: {
      findUnique: vi.fn().mockResolvedValue({ whatsappBusinessEnabled: options.globalEnabled ?? true }),
    },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    notificationEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => notificationEvents.get(where.dedupeKey) ?? null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        eventCounter += 1;
        const row = { id: `event-${eventCounter}`, ...data };
        if (data.dedupeKey) notificationEvents.set(data.dedupeKey, row);
        return row;
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsAppMessageLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `log-${eventCounter}`, ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => data),
    },
    notification: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "in-app-notification-1", ...data })),
    },
  };

  return { prisma };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  vi.unstubAllGlobals();
});

describe("getCustomerOrderStatusWhatsAppMode", () => {
  it("defaults to dry-run when unset", () => {
    expect(getCustomerOrderStatusWhatsAppMode()).toBe("dry-run");
  });

  it("reads live/off/dry-run case-insensitively, falling back to dry-run for anything else", () => {
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "LIVE";
    expect(getCustomerOrderStatusWhatsAppMode()).toBe("live");
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "off";
    expect(getCustomerOrderStatusWhatsAppMode()).toBe("off");
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "garbage";
    expect(getCustomerOrderStatusWhatsAppMode()).toBe("dry-run");
  });
});

describe("notifyCustomerOrderStatusChanged — transition guard", () => {
  it("never notifies for the initial null -> PLACED creation", async () => {
    const { prisma } = buildHarness();
    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: null, newStatus: OrderStatus.PLACED });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("never notifies for a same-status no-op (PLACED -> PLACED)", async () => {
    const { prisma } = buildHarness();
    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PLACED });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("never throws even if the order cannot be found", async () => {
    const { prisma } = buildHarness();
    prisma.order.findUnique.mockResolvedValueOnce(null);
    await expect(
      notifyCustomerOrderStatusChanged(prisma, { orderId: "missing", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();
  });

  it("never throws even if the underlying prisma lookup rejects", async () => {
    const { prisma } = buildHarness();
    prisma.order.findUnique.mockRejectedValueOnce(new Error("DB down"));
    await expect(
      notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();
  });
});

// In-app Alerts bell — regression coverage for the bug where the Meta
// WhatsApp Cloud API migration (which replaced the old
// apps/supplier/lib/notify.ts notifyBuilderOrderStatusUpdate) dropped the
// Notification-table write that powers apps/web's builder Alerts bell.
describe("notifyCustomerOrderStatusChanged — in-app Alerts bell", () => {
  it("writes a Notification row for a real, builder-facing transition", async () => {
    const { prisma } = buildHarness();

    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          audience: "builder",
          title: "Enquiry confirmed",
          idempotencyKey: "builder-order-status:order-1:PROCESSING",
        }),
      })
    );
  });

  it("is idempotent per (order, status) — a retried transition never creates a second row", async () => {
    const { prisma } = buildHarness();
    prisma.notification.findFirst.mockResolvedValueOnce({ id: "in-app-notification-1" });

    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED });

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("never writes a Notification row for the initial PLACED creation", async () => {
    const { prisma } = buildHarness();

    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: null, newStatus: OrderStatus.PLACED });

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("never throws, and still attempts the WhatsApp send, when the Notification write fails", async () => {
    const { prisma } = buildHarness();
    prisma.notification.create.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(prisma.notificationEvent.create).toHaveBeenCalled();
  });
});

// Test 9 — notification disabled via the existing policy system
describe("notifyCustomerOrderStatusChanged — policy suppression", () => {
  it("suppresses (and never calls Meta) when the NotificationEventPolicy row is disabled", async () => {
    const { prisma } = buildHarness({ policyEnabled: false });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "TEMPLATE_DISABLED" }) })
    );
  });

  it("suppresses when the global WhatsApp business kill-switch is off", async () => {
    const { prisma } = buildHarness({ globalEnabled: false });
    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "CHANNEL_DISABLED_GLOBALLY" }) })
    );
  });
});

// Test 8 — missing customer phone number
describe("notifyCustomerOrderStatusChanged — missing phone", () => {
  it("never calls Meta/Twilio and marks the event failed (without crashing) when the customer has no phone/whatsappNumber", async () => {
    const { prisma } = buildHarness({ order: makeOrder({ user: { id: "user-1", phone: null, whatsappNumber: null } }) });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });
});

// Test 5 — dry-run: event created, logged, Meta NOT called
describe("notifyCustomerOrderStatusChanged — dry-run mode", () => {
  it("creates the event and a WhatsAppMessageLog row, simulates success, and never calls fetch", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "customer_order_status", mode: "dry-run" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "sent" } })
    );
  });
});

// Test 6 — live Meta: exactly 2 variables, no buttons, correct template usage
describe("notifyCustomerOrderStatusChanged — live mode (Meta Cloud API)", () => {
  it("calls Meta exactly once with the correct template name, exactly 2 body parameters, and no header/buttons", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.ORDER-STATUS-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.name).toBe("customer_order_status");
    expect(sentBody.template.components).toHaveLength(1);
    expect(sentBody.template.components[0].type).toBe("body");
    expect(sentBody.template.components[0].parameters).toEqual([
      { type: "text", text: "BH-2026-00452" },
      { type: "text", text: "Dispatched" },
    ]);
    expect(sentBody.template.components.some((c: any) => c.type === "button")).toBe(false);
    expect(sentBody.template.components.some((c: any) => c.type === "header")).toBe(false);
    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent", metaMessageId: "wamid.ORDER-STATUS-1" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "sent" } })
    );
  });

  // Test 7 — Meta failure never crashes; order transition already committed
  it("records a Meta failure as failed and never throws", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: { message: "Internal error", code: 999 } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });

  it("never calls fetch when WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN are missing, and records a failure", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });
});

// Test 15 — duplicate prevention via the existing dedupe-key mechanism
describe("notifyCustomerOrderStatusChanged — duplicate prevention", () => {
  it("a single transition generates exactly one Meta call; retrying the SAME transition sends no second message", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const params = { orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED } as const;
    await notifyCustomerOrderStatusChanged(prisma, params);
    await notifyCustomerOrderStatusChanged(prisma, params);

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A later, distinct transition (DISPATCHED -> DELIVERED) must still send.
    await notifyCustomerOrderStatusChanged(prisma, { orderId: "order-1", previousStatus: OrderStatus.DISPATCHED, newStatus: OrderStatus.DELIVERED });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
