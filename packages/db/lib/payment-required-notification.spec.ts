import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import {
  notifyPaymentRequired,
  getPaymentRequiredWhatsAppMode,
  buildPaymentRequiredDedupeKey,
  formatPaymentAmount,
} from "./payment-required-notification";

// End-to-end style tests exercising the REAL policy-evaluation and Meta-send
// logic in this module (only Prisma and `fetch` are faked) — this is the one
// shared implementation both apps/api's NestJS wrapper
// (payment-required-notification.service.ts) and apps/supplier (directly)
// call, so correctness here is correctness for both apps.

const PAYMENT_REQUIRED_POLICY = {
  enabled: true,
  templateName: "payment_required",
  channel: "WHATSAPP",
  priority: "P0",
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

function buildHarness(options: { policyEnabled?: boolean; globalEnabled?: boolean; order?: any } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    order: { findUnique: vi.fn().mockResolvedValue(options.order ?? makeOrder()) },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue({ ...PAYMENT_REQUIRED_POLICY, enabled: options.policyEnabled ?? true }),
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
  };

  return { prisma };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.PAYMENT_DUE_DAYS;
  vi.unstubAllGlobals();
});

describe("getPaymentRequiredWhatsAppMode", () => {
  it("defaults to dry-run when unset", () => {
    expect(getPaymentRequiredWhatsAppMode()).toBe("dry-run");
  });

  it("reads live/off/dry-run case-insensitively, falling back to dry-run for anything else", () => {
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "LIVE";
    expect(getPaymentRequiredWhatsAppMode()).toBe("live");
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "off";
    expect(getPaymentRequiredWhatsAppMode()).toBe("off");
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "garbage";
    expect(getPaymentRequiredWhatsAppMode()).toBe("dry-run");
  });
});

describe("buildPaymentRequiredDedupeKey / formatPaymentAmount", () => {
  it("builds a stable per-order dedupe key", () => {
    expect(buildPaymentRequiredDedupeKey("order-1")).toBe("PAYMENT_REQUIRED:order-1");
    expect(buildPaymentRequiredDedupeKey("order-2")).toBe("PAYMENT_REQUIRED:order-2");
  });

  it("formats the amount with the ₹ / en-IN convention matching apps/web's formatCurrency", () => {
    expect(formatPaymentAmount(50000)).toBe("₹50,000");
    expect(formatPaymentAmount("1234.00")).toBe("₹1,234");
  });
});

describe("notifyPaymentRequired — trigger guard", () => {
  it("never notifies for the initial null -> PLACED creation", async () => {
    const { prisma } = buildHarness();
    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: null, newStatus: OrderStatus.PLACED });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("never notifies for an unrelated transition (PROCESSING -> DISPATCHED)", async () => {
    const { prisma } = buildHarness();
    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PROCESSING, newStatus: OrderStatus.DISPATCHED });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it("never notifies when paymentStatus is already PAID (admin payment-approval path)", async () => {
    const { prisma } = buildHarness({ order: makeOrder({ paymentStatus: PaymentStatus.PAID }) });
    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("never throws even if the order cannot be found", async () => {
    const { prisma } = buildHarness();
    prisma.order.findUnique.mockResolvedValueOnce(null);
    await expect(
      notifyPaymentRequired(prisma, { orderId: "missing", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();
  });

  it("never throws even if the underlying prisma lookup rejects", async () => {
    const { prisma } = buildHarness();
    prisma.order.findUnique.mockRejectedValueOnce(new Error("DB down"));
    await expect(
      notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();
  });
});

describe("notifyPaymentRequired — policy suppression", () => {
  it("suppresses (and never calls Meta) when the NotificationEventPolicy row is disabled", async () => {
    const { prisma } = buildHarness({ policyEnabled: false });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "TEMPLATE_DISABLED" }) })
    );
  });

  it("suppresses when the global WhatsApp business kill-switch is off", async () => {
    const { prisma } = buildHarness({ globalEnabled: false });
    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "CHANNEL_DISABLED_GLOBALLY" }) })
    );
  });

  it("does not create a duplicate WhatsApp send when the same order's transition is retried", async () => {
    const { prisma } = buildHarness();
    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });

  it("skips WhatsApp send when the customer has no phone/whatsappNumber, without throwing", async () => {
    const { prisma } = buildHarness({ order: makeOrder({ user: { id: "user-1", phone: null, whatsappNumber: null } }) });
    await expect(
      notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });
});

describe("notifyPaymentRequired — dry-run mode", () => {
  it("creates the event and a WhatsAppMessageLog row, simulates success, and never calls fetch", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "payment_required", mode: "dry-run" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "sent" } })
    );
  });
});

describe("notifyPaymentRequired — live mode (Meta Cloud API)", () => {
  it("calls Meta exactly once with the correct template name, exactly 3 body parameters, and no header/buttons", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.PAYMENT-REQUIRED-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING });

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
      notifyPaymentRequired(prisma, { orderId: "order-1", previousStatus: OrderStatus.PLACED, newStatus: OrderStatus.PROCESSING })
    ).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });
});
