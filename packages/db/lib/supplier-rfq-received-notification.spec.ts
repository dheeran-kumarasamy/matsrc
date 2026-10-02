import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  notifySupplierRfqReceived,
  getSupplierRfqReceivedWhatsAppMode,
  buildSupplierRfqReceivedDedupeKey,
  resolveSupplierQuoteDeadline,
} from "./supplier-rfq-received-notification";

// End-to-end style tests exercising the REAL policy-evaluation and Meta-send
// logic in this module (only Prisma and `fetch` are faked) — mirrors
// customer-order-status-notification.spec.ts's harness style exactly, since
// this is the shared implementation apps/api's NestJS wrapper
// (SupplierRfqReceivedNotificationService), apps/web (order-checkout.ts),
// and apps/supplier (candidate-promotion decline cascade) all route through.

const RFQ_POLICY = {
  enabled: true,
  templateName: "supplier_quote_alert",
  channel: "WHATSAPP",
  priority: "P1",
};

function makeOrderItem(overrides: Partial<any> = {}) {
  return {
    id: "item-1",
    orderId: "order-1",
    supplierId: "sup-1",
    quantity: 50,
    product: { name: "TMT Bar 12mm", unit: "BAG" },
    order: { id: "order-1", deliveryAddress: "123 Site Road, Chennai", createdAt: new Date("2026-01-01T00:00:00Z") },
    supplier: { id: "sup-1", user: { id: "user-sup-1", phone: "919876543210", whatsappNumber: null } },
    ...overrides,
  };
}

function buildHarness(options: { policyEnabled?: boolean; globalEnabled?: boolean; orderItem?: any } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    orderItem: { findUnique: vi.fn().mockResolvedValue(options.orderItem ?? makeOrderItem()) },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue({ ...RFQ_POLICY, enabled: options.policyEnabled ?? true }),
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
  delete process.env.QUOTE_DEADLINE_MINUTES;
  vi.unstubAllGlobals();
});

describe("getSupplierRfqReceivedWhatsAppMode", () => {
  it("defaults to dry-run when unset", () => {
    expect(getSupplierRfqReceivedWhatsAppMode()).toBe("dry-run");
  });
});

describe("buildSupplierRfqReceivedDedupeKey", () => {
  it("builds a key distinguishing orderItemId + supplierId", () => {
    expect(buildSupplierRfqReceivedDedupeKey("item-1", "sup-1")).toBe("SUPPLIER_RFQ_RECEIVED:item-1:sup-1");
    expect(buildSupplierRfqReceivedDedupeKey("item-1", "sup-2")).not.toBe(buildSupplierRfqReceivedDedupeKey("item-1", "sup-1"));
  });
});

describe("resolveSupplierQuoteDeadline", () => {
  it("falls back to the existing 24-hour RFQ response window when QUOTE_DEADLINE_MINUTES is unset", () => {
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const deadline = resolveSupplierQuoteDeadline(createdAt);
    expect(deadline.getTime() - createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("uses QUOTE_DEADLINE_MINUTES when configured", () => {
    process.env.QUOTE_DEADLINE_MINUTES = "120";
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const deadline = resolveSupplierQuoteDeadline(createdAt);
    expect(deadline.getTime() - createdAt.getTime()).toBe(120 * 60 * 1000);
  });
});

// Test A — correct trigger / recipient
describe("notifySupplierRfqReceived — trigger and recipient resolution", () => {
  it("never throws and skips cleanly when the orderItem cannot be found", async () => {
    const { prisma } = buildHarness();
    prisma.orderItem.findUnique.mockResolvedValueOnce(null);
    await expect(notifySupplierRfqReceived(prisma, { orderItemId: "missing" })).resolves.toBeUndefined();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("never throws even if the underlying prisma lookup rejects", async () => {
    const { prisma } = buildHarness();
    prisma.orderItem.findUnique.mockRejectedValueOnce(new Error("DB down"));
    await expect(notifySupplierRfqReceived(prisma, { orderItemId: "item-1" })).resolves.toBeUndefined();
  });

  it("resolves the correct supplier (the OrderItem's current supplierId's user) as recipient", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientId: "user-sup-1", recipientType: "supplier" }) })
    );
  });
});

// Test B — exact template variable values
describe("notifySupplierRfqReceived — template variables", () => {
  it("passes exactly {{1}} material, {{2}} quantity, {{3}} delivery location, {{4}} quote deadline", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.RFQ-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.name).toBe("supplier_quote_alert");
    const params = sentBody.template.components[0].parameters.map((p: any) => p.text);
    expect(params[0]).toBe("TMT Bar 12mm");
    expect(params[1]).toBe("50 BAG");
    expect(params[2]).toBe("123 Site Road, Chennai");
    expect(params[3]).toBe("02 Jan");
  });

  it("falls back to 'See order for delivery details' when the Order has no deliveryAddress", async () => {
    const { prisma } = buildHarness({
      orderItem: makeOrderItem({ order: { id: "order-1", deliveryAddress: null, createdAt: new Date("2026-01-01T00:00:00Z") } }),
    });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parameters: expect.arrayContaining(["See order for delivery details"]) }) })
    );
  });
});

// Test C — template registration
describe("notifySupplierRfqReceived — template registration", () => {
  it("uses templateName supplier_quote_alert from the NotificationEventPolicy row", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "supplier_quote_alert" }) })
    );
  });
});

// Test D — recipient resolution (with / without WhatsApp number)
describe("notifySupplierRfqReceived — recipient phone resolution", () => {
  it("sends to whatsappNumber when present, falling back to phone otherwise", async () => {
    const { prisma } = buildHarness({
      orderItem: makeOrderItem({ supplier: { id: "sup-1", user: { id: "user-sup-1", phone: "919000000000", whatsappNumber: "918888888888" } } }),
    });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phoneNumber: "918888888888" }) })
    );
  });

  it("fails safely (never crashes) and marks the event failed when the supplier has no phone/whatsappNumber", async () => {
    const { prisma } = buildHarness({
      orderItem: makeOrderItem({ supplier: { id: "sup-1", user: { id: "user-sup-1", phone: null, whatsappNumber: null } } }),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(notifySupplierRfqReceived(prisma, { orderItemId: "item-1" })).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });
});

// Test E — deduplication
describe("notifySupplierRfqReceived — deduplication", () => {
  it("sends exactly once for the same (orderItem, supplier) assignment; a retry is a no-op", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.RFQ-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends a NEW notification when a different supplier is promoted onto the same OrderItem", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.RFQ-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    prisma.orderItem.findUnique.mockResolvedValueOnce(
      makeOrderItem({ supplierId: "sup-2", supplier: { id: "sup-2", user: { id: "user-sup-2", phone: "919111111111", whatsappNumber: null } } })
    );
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// Test F — policy enabled/disabled
describe("notifySupplierRfqReceived — policy", () => {
  it("suppresses (and never calls Meta) when the NotificationEventPolicy row is disabled", async () => {
    const { prisma } = buildHarness({ policyEnabled: false });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "TEMPLATE_DISABLED" }) })
    );
  });

  it("allows send when policy is enabled and global WhatsApp channel is enabled", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "created" }) })
    );
  });

  it("suppresses when the global WhatsApp business kill-switch is off", async () => {
    const { prisma } = buildHarness({ globalEnabled: false });
    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "CHANNEL_DISABLED_GLOBALLY" }) })
    );
  });
});

// Test G — Meta failure never crashes the RFQ operation
describe("notifySupplierRfqReceived — Meta failure handling", () => {
  it("records a Meta failure as failed and never throws", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Internal error", code: 999 } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(notifySupplierRfqReceived(prisma, { orderItemId: "item-1" })).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });
});

// Test H — dry-run mode
describe("notifySupplierRfqReceived — dry-run mode", () => {
  it("creates the event and a WhatsAppMessageLog row, simulates success, and never calls fetch", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "supplier_quote_alert", mode: "dry-run" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "sent" } })
    );
  });
});

// Test I — live mode: Meta adapter receives the correct template and variables
describe("notifySupplierRfqReceived — live mode (Meta Cloud API)", () => {
  it("calls Meta exactly once with templateName supplier_quote_alert and exactly 4 body parameters, no header/buttons", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.RFQ-LIVE-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierRfqReceived(prisma, { orderItemId: "item-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.name).toBe("supplier_quote_alert");
    expect(sentBody.template.components).toHaveLength(1);
    expect(sentBody.template.components[0].parameters).toHaveLength(4);
    expect(sentBody.template.components.some((c: any) => c.type === "button")).toBe(false);
    expect(sentBody.template.components.some((c: any) => c.type === "header")).toBe(false);
    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent", metaMessageId: "wamid.RFQ-LIVE-1" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "sent" } })
    );
  });
});
