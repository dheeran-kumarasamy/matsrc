import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrderStatus, PaymentStatus } from "@matsrc/db";
import { PaymentRequiredNotificationService } from "./payment-required-notification.service";
import { NotificationEngineService } from "../notification-engine.service";
import { NotificationPolicyService } from "../notification-policy.service";
import { WhatsAppEngineChannel } from "../channels/whatsapp-engine-channel.service";
import { InAppEngineChannel } from "../channels/in-app-engine-channel.service";
import { WhatsappNotificationService } from "./whatsapp-notification.service";
import { WhatsAppEngineConfigService } from "./whatsapp-engine-config.service";

/**
 * End-to-end style tests for the `payment_required` WhatsApp notification —
 * deliberately exercises the REAL NotificationEngineService ->
 * NotificationPolicyService -> WhatsAppEngineChannel ->
 * WhatsappNotificationService chain (only Prisma and `fetch` are faked),
 * mirroring customer-order-status-notification.service.spec.ts exactly.
 */

const PAYMENT_REQUIRED_POLICY = {
  id: "policy-payment-required",
  eventType: "PAYMENT_REQUIRED",
  channel: "WHATSAPP",
  templateName: "payment_required",
  metaTemplateId: "1457666726425273",
  enabled: true,
  priority: "P0",
  maxPerDay: null,
  cooldownMinutes: null,
  businessHoursOnly: false,
};

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-1",
    userId: "user-1",
    enquiryId: "BH-2026-00452",
    totalAmount: 50000,
    paymentStatus: PaymentStatus.PENDING,
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
      findUnique: vi.fn().mockResolvedValue(PAYMENT_REQUIRED_POLICY),
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
  const service = new PaymentRequiredNotificationService(prisma, engine);

  return { service, prisma };
}

describe("PaymentRequiredNotificationService.notifyIfTransitioned", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // A. Correct trigger
  it("fires one PAYMENT_REQUIRED notification for PLACED -> PROCESSING while paymentStatus is PENDING", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "payment_required" }) })
    );
    const params = prisma.whatsAppMessageLog.create.mock.calls[0][0].data.parameters;
    expect(params).toHaveLength(3);
    expect(params[0]).toBe("BH-2026-00452");
    expect(params[1]).toBe("₹50,000");
  });

  it("does NOT notify when the order is already PAID (e.g. admin payment-approval path)", async () => {
    const { service, prisma } = buildHarness({ order: makeOrder({ paymentStatus: PaymentStatus.PAID }) });

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("does NOT notify for an unrelated transition (e.g. PROCESSING -> DISPATCHED)", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED });

    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("does NOT notify for initial order creation (previousStatus null)", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: null, newStatus: OrderStatus.PLACED });

    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });
});

describe("PaymentRequiredNotificationService — dedupe / recipient / policy / Meta", () => {
  // F. Deduplication
  it("does not create a duplicate WhatsApp send when the same transition is retried", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });

  it("a different order gets its own independent notification", async () => {
    const { service, prisma } = buildHarness();

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    prisma.order.findUnique.mockResolvedValueOnce(makeOrder({ id: "order-2", enquiryId: "BH-2026-00453" }));
    await service.notifyIfTransitioned({ orderId: "order-2", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(2);
  });

  // B. Recipient
  it("skips WhatsApp send when the customer has no phone/whatsappNumber, without throwing", async () => {
    const { service, prisma } = buildHarness({ order: makeOrder({ user: { id: "user-1", phone: null, whatsappNumber: null } }) });

    await expect(
      service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });

  // G. Policy
  it("suppresses (and never calls Meta) when the global WhatsApp business kill-switch is off", async () => {
    const { service, prisma } = buildHarness({ globalEnabled: false });

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "CHANNEL_DISABLED_GLOBALLY" }) })
    );
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
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

describe("PaymentRequiredNotificationService — live Meta payload / failure handling", () => {
  // D/E. Template variables + amount, live mode
  it("live mode: sends exactly three body parameters, no header, correct template name, no button component (static Make Payment button rendered by Meta)", async () => {
    const { service, prisma } = buildHarness({ mode: "live" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ messages: [{ id: "wamid.PAYMENT-REQUIRED-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await service.notifyIfTransitioned({ orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.name).toBe("payment_required");
    expect(sentBody.template.components).toHaveLength(1);
    expect(sentBody.template.components[0].type).toBe("body");
    expect(sentBody.template.components[0].parameters).toHaveLength(3);
    expect(sentBody.template.components[0].parameters[0]).toEqual({ type: "text", text: "BH-2026-00452" });
    expect(sentBody.template.components[0].parameters[1]).toEqual({ type: "text", text: "₹50,000" });
    expect(sentBody.template.components.some((c: any) => c.type === "button")).toBe(false);
    expect(sentBody.template.components.some((c: any) => c.type === "header")).toBe(false);
    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent", metaMessageId: "wamid.PAYMENT-REQUIRED-1" }) })
    );
  });

  // H. Meta failure
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
});
