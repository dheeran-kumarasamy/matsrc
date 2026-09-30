import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrderStatus } from "@matsrc/db";
import { CustomerOrderStatusNotificationService } from "./customer-order-status-notification.service";
import { NotificationEngineService } from "../notification-engine.service";
import { NotificationPolicyService } from "../notification-policy.service";
import { WhatsAppEngineChannel } from "../channels/whatsapp-engine-channel.service";
import { InAppEngineChannel } from "../channels/in-app-engine-channel.service";
import { WhatsappNotificationService } from "./whatsapp-notification.service";
import { WhatsAppEngineConfigService } from "./whatsapp-engine-config.service";

/**
 * End-to-end style tests for the `customer_order_status` WhatsApp
 * notification — deliberately exercises the REAL
 * NotificationEngineService -> NotificationPolicyService ->
 * WhatsAppEngineChannel -> WhatsappNotificationService chain (only Prisma
 * and `fetch` are faked), so these tests prove the full existing
 * Notification Engine pipeline is actually reused end-to-end, not just that
 * `CustomerOrderStatusNotificationService` calls some mock correctly.
 */

const ORDER_STATUS_POLICY = {
  id: "policy-order-status",
  eventType: "ORDER_STATUS_CHANGED",
  channel: "WHATSAPP",
  templateName: "customer_order_status",
  metaTemplateId: "1788249542353441",
  enabled: true,
  priority: "P1",
  maxPerDay: null,
  cooldownMinutes: null,
  businessHoursOnly: false,
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

function buildHarness(options: { globalEnabled?: boolean; mode?: "live" | "dry-run" | "off"; order?: any } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    order: {
      findUnique: vi.fn().mockResolvedValue(options.order ?? makeOrder()),
    },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue(ORDER_STATUS_POLICY),
    },
    notificationGlobalSettings: {
      findUnique: vi.fn().mockResolvedValue({ id: "global", whatsappBusinessEnabled: options.globalEnabled ?? true }),
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    notificationEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => notificationEvents.get(where.dedupeKey) ?? null),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        eventCounter += 1;
        const row = { id: `event-${eventCounter}`, ...data };
        if (data.dedupeKey) notificationEvents.set(data.dedupeKey, row);
        return row;
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsAppMessageLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `log-${eventCounter}`, ...data, metaMessageId: null, errorDetails: null })),
      update: vi.fn().mockImplementation(async ({ data }: any) => data),
    },
  };

  const config = new WhatsAppEngineConfigService();
  vi.spyOn(config, "getMode").mockReturnValue(options.mode ?? "dry-run");
  vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
  vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");

  const whatsappNotificationService = new WhatsappNotificationService(prisma, config);
  const whatsAppChannel = new WhatsAppEngineChannel(whatsappNotificationService);
  const inAppChannel = new InAppEngineChannel(prisma);
  const policy = new NotificationPolicyService(prisma);
  const engine = new NotificationEngineService(prisma, policy, whatsAppChannel, inAppChannel);
  const service = new CustomerOrderStatusNotificationService(prisma, engine);

  return { service, prisma, notificationEvents };
}

describe("CustomerOrderStatusNotificationService.notifyIfTransitioned", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // Test 1 — PLACED -> PROCESSING ("Accepted")
  it("fires one ORDER_STATUS_CHANGED notification for PLACED -> PROCESSING with displayStatus Processing", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "customer_order_status", parameters: ["BH-2026-00452", "Processing"] }) })
    );
  });

  // Test 2 — PROCESSING -> DISPATCHED
  it("fires one new notification for PROCESSING -> DISPATCHED with displayStatus Dispatched", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED });

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parameters: ["BH-2026-00452", "Dispatched"] }) })
    );
  });

  // Test 3 — DISPATCHED -> DELIVERED
  it("fires one new notification for DISPATCHED -> DELIVERED with displayStatus Delivered", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.DISPATCHED, newStatus: OrderStatus.DELIVERED });

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parameters: ["BH-2026-00452", "Delivered"] }) })
    );
  });

  // Test 4 — any valid status -> CANCELLED
  it("fires one notification for PLACED -> CANCELLED", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.CANCELLED });

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parameters: ["BH-2026-00452", "Cancelled"] }) })
    );
  });

  // Test 5 — same status
  it("does NOT notify for DISPATCHED -> DISPATCHED (no real transition)", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.DISPATCHED, newStatus: OrderStatus.DISPATCHED });

    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  // Test 6 — retry/idempotency
  it("does not create a duplicate WhatsApp send when the same transition is retried", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    // The second call's dedupeKey collision is caught by
    // NotificationPolicyService.evaluate() (DUPLICATE_DEDUPE_KEY) before any
    // send is attempted, so only the first transition ever reaches WhatsApp.
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });

  // Test 7 — three distinct transitions
  it("fires two distinct notifications for PLACED -> PROCESSING -> DISPATCHED", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(2);
    const sentStatuses = prisma.whatsAppMessageLog.create.mock.calls.map((call: any) => call[0].data.parameters[1]);
    expect(sentStatuses).toEqual(["Processing", "Dispatched"]);
  });

  // Test 8 — no customer phone
  it("skips WhatsApp send when the customer has no phone/whatsappNumber, without throwing", async () => {
    const { service, prisma } = buildHarness({ order: makeOrder({ user: { id: "user-1", phone: null, whatsappNumber: null } }) });

    await expect(
      service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
  });

  // Test 9 — WhatsApp disabled globally
  it("suppresses the notification when the global WhatsApp kill-switch is off", async () => {
    const { service, prisma } = buildHarness({ globalEnabled: false });

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "CHANNEL_DISABLED_GLOBALLY" }) })
    );
  });

  // Test 10 — dry-run mode
  it("dry-run: creates/logs the notification but never calls Meta (fetch)", async () => {
    const { service, prisma } = buildHarness({ mode: "dry-run" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent" }) })
    );
  });

  // Test 11 — live mode: exactly two template parameters, no button, correct template
  it("live mode: sends exactly two body parameters, no button/header, correct template name and is logged as sent", async () => {
    const { service, prisma } = buildHarness({ mode: "live" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ messages: [{ id: "wamid.ORDER-STATUS-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED });

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
  });

  // Test 12 — Meta failure never crashes / order transition already committed
  it("live mode: a Meta API failure is recorded as failed and never throws", async () => {
    const { service, prisma } = buildHarness({ mode: "live" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: { message: "Internal error", code: 999 } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });

  it("never notifies for the initial null -> PLACED creation (previousStatus null)", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: null, newStatus: OrderStatus.PLACED });

    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("never throws even if the order cannot be found (deleted/invalid id)", async () => {
    const { service, prisma } = buildHarness();
    prisma.order.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.notifyIfTransitioned({ orderId: "missing-order", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("never throws even if the underlying prisma lookup rejects", async () => {
    const { service, prisma } = buildHarness();
    prisma.order.findUnique.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();
  });
});
