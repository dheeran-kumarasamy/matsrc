import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  notifySupplierPoReceived,
  getSupplierPoReceivedWhatsAppMode,
  buildSupplierPoReceivedDedupeKey,
  buildPurchaseOrderButtonUrlSuffix,
  summarizePoMaterials,
  summarizePoQuantities,
} from "./supplier-po-received-notification";

// End-to-end style tests exercising the REAL policy-evaluation and Meta-send
// logic in this module (only Prisma and `fetch` are faked) — mirrors
// supplier-rfq-received-notification.spec.ts's harness style exactly, since
// this is the shared implementation apps/api's NestJS wrapper
// (SupplierPoReceivedNotificationService) and apps/web (the PO approval
// route) both route through.

const PO_POLICY = {
  enabled: true,
  templateName: "supplier_po_alert",
  channel: "WHATSAPP",
  priority: "P0",
};

function makePurchaseOrder(overrides: Partial<any> = {}) {
  return {
    id: "po-1",
    poNumber: "PO-2026-00001",
    orderId: "order-1",
    supplierId: "sup-1",
    status: "ISSUED",
    lineItems: [{ id: "li-1", quantity: 42, product: { name: "TMT Bar 12mm", unit: "BAG" } }],
    supplier: { id: "sup-1", user: { id: "user-sup-1", phone: "919876543210", whatsappNumber: null } },
    ...overrides,
  };
}

function buildHarness(options: { policyEnabled?: boolean; globalEnabled?: boolean; po?: any } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    purchaseOrder: { findUnique: vi.fn().mockResolvedValue(options.po ?? makePurchaseOrder()) },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue({ ...PO_POLICY, enabled: options.policyEnabled ?? true }),
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
  vi.unstubAllGlobals();
});

describe("getSupplierPoReceivedWhatsAppMode", () => {
  it("defaults to dry-run when unset", () => {
    expect(getSupplierPoReceivedWhatsAppMode()).toBe("dry-run");
  });
});

describe("buildSupplierPoReceivedDedupeKey", () => {
  it("builds a key distinguishing purchaseOrderId + supplierId", () => {
    expect(buildSupplierPoReceivedDedupeKey("po-1", "sup-1")).toBe("SUPPLIER_PO_RECEIVED:po-1:sup-1");
    expect(buildSupplierPoReceivedDedupeKey("po-1", "sup-2")).not.toBe(buildSupplierPoReceivedDedupeKey("po-1", "sup-1"));
  });
});

describe("buildPurchaseOrderButtonUrlSuffix", () => {
  it("builds the bare purchaseOrderId suffix, never a full URL or the poNumber", () => {
    expect(buildPurchaseOrderButtonUrlSuffix("po-1")).toBe("po-1");
    expect(buildPurchaseOrderButtonUrlSuffix("po-1")).not.toMatch(/^https?:\/\//);
    expect(buildPurchaseOrderButtonUrlSuffix("po-1")).not.toContain("buildohub.in");
    expect(buildPurchaseOrderButtonUrlSuffix("po-1")).not.toContain("purchase-orders/");
  });

  it("resolves to the correct destination URL for a representative PO id, with no duplicated path segment", () => {
    const suffix = buildPurchaseOrderButtonUrlSuffix("abc123");
    const resolvedUrl = `https://supplier.buildohub.in/purchase-orders/${suffix}`;
    expect(resolvedUrl).toBe("https://supplier.buildohub.in/purchase-orders/abc123");
    expect(resolvedUrl).not.toContain("purchase-orders/purchase-orders");
  });
});

describe("summarizePoMaterials / summarizePoQuantities", () => {
  it("formats a single line item without truncation", () => {
    const lineItems = [{ quantity: 42, product: { name: "TMT Bar 12mm", unit: "BAG" } }];
    expect(summarizePoMaterials(lineItems)).toBe("TMT Bar 12mm");
    expect(summarizePoQuantities(lineItems)).toBe("42 BAG");
  });

  it("truncates to 3 items with a +N more suffix, keeping material/quantity ordering aligned", () => {
    const lineItems = [
      { quantity: 1, product: { name: "Cement", unit: "bag" } },
      { quantity: 2, product: { name: "Sand", unit: "ton" } },
      { quantity: 3, product: { name: "Bricks", unit: "pcs" } },
      { quantity: 4, product: { name: "Steel", unit: "kg" } },
    ];
    expect(summarizePoMaterials(lineItems)).toBe("Cement, Sand, Bricks, +1 more");
    expect(summarizePoQuantities(lineItems)).toBe("1 bag, 2 ton, 3 pcs, +1 more");
  });
});

// Test A — correct trigger / recipient
describe("notifySupplierPoReceived — trigger and recipient resolution", () => {
  it("never throws and skips cleanly when the purchaseOrder cannot be found", async () => {
    const { prisma } = buildHarness();
    prisma.purchaseOrder.findUnique.mockResolvedValueOnce(null);
    await expect(notifySupplierPoReceived(prisma, { purchaseOrderId: "missing" })).resolves.toBeUndefined();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("never throws even if the underlying prisma lookup rejects", async () => {
    const { prisma } = buildHarness();
    prisma.purchaseOrder.findUnique.mockRejectedValueOnce(new Error("DB down"));
    await expect(notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" })).resolves.toBeUndefined();
  });

  it("does NOT notify for a DRAFT purchase order — only ISSUED triggers the notification", async () => {
    const { prisma } = buildHarness({ po: makePurchaseOrder({ status: "DRAFT" }) });
    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
  });

  it("does not notify for ACKNOWLEDGED/FULFILLED statuses either — only the DRAFT->ISSUED transition", async () => {
    const { prisma: prismaAck } = buildHarness({ po: makePurchaseOrder({ status: "ACKNOWLEDGED" }) });
    await notifySupplierPoReceived(prismaAck, { purchaseOrderId: "po-1" });
    expect(prismaAck.notificationEvent.create).not.toHaveBeenCalled();

    const { prisma: prismaFulfilled } = buildHarness({ po: makePurchaseOrder({ status: "FULFILLED" }) });
    await notifySupplierPoReceived(prismaFulfilled, { purchaseOrderId: "po-1" });
    expect(prismaFulfilled.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("notifies for an ISSUED purchase order, resolving the PO's supplier user as recipient", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientId: "user-sup-1", recipientType: "supplier" }) })
    );
  });
});

// Test B — exact template variable values
describe("notifySupplierPoReceived — template variables", () => {
  it("passes exactly {{1}} PO number, {{2}} material, {{3}} quantity", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.PO-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.components[0].parameters.map((p: any) => p.text)).toEqual([
      "PO-2026-00001",
      "TMT Bar 12mm",
      "42 BAG",
    ]);
  });

  it("uses PurchaseOrder.poNumber (not an invented ID) as the {{1}} value, falling back to id only if poNumber is missing", async () => {
    const { prisma } = buildHarness({ po: makePurchaseOrder({ poNumber: null }) });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ parameters: ["po-1", "TMT Bar 12mm", "42 BAG"] }) })
    );
  });
});

// Test E — recipient without WhatsApp number must never break PO processing
describe("notifySupplierPoReceived — supplier without a WhatsApp number", () => {
  it("creates a failed NotificationEvent (no WhatsAppMessageLog) and never throws when the supplier has no phone/whatsappNumber on file", async () => {
    const { prisma } = buildHarness({
      po: makePurchaseOrder({ supplier: { id: "sup-1", user: { id: "user-sup-1", phone: null, whatsappNumber: null } } }),
    });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";

    await expect(notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" })).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });

  it("never throws when the purchaseOrder has no supplier/user on file", async () => {
    const { prisma } = buildHarness({ po: makePurchaseOrder({ supplier: null }) });
    await expect(notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" })).resolves.toBeUndefined();
  });
});

// Test F — deduplication
describe("notifySupplierPoReceived — deduplication", () => {
  it("sends exactly once for the same purchaseOrder+supplier; a retry (e.g. duplicate approval request) is a no-op", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.A" }] }) })
    );

    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });
    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });
});

// Test G — policy enabled/disabled
describe("notifySupplierPoReceived — policy", () => {
  it("suppresses (and never calls Meta) when the NotificationEventPolicy row is disabled", async () => {
    const { prisma } = buildHarness({ policyEnabled: false });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "TEMPLATE_DISABLED" }) })
    );
  });

  it("suppresses when the global WhatsApp channel is disabled", async () => {
    const { prisma } = buildHarness({ globalEnabled: false });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suppressReason: "CHANNEL_DISABLED_GLOBALLY" }) })
    );
  });

  it("allows send when policy is enabled and global WhatsApp channel is enabled", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalled();
  });
});

// Test H — Meta failure never crashes the PO operation
describe("notifySupplierPoReceived — Meta failure handling", () => {
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

    await expect(notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" })).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });
});

// Test I — dry-run mode
describe("notifySupplierPoReceived — dry-run mode", () => {
  it("creates the event and a WhatsAppMessageLog row, simulates success, and never calls fetch", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "supplier_po_alert", mode: "dry-run" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "sent" } })
    );
  });
});

// Test J — live mode: Meta adapter receives the correct template, variables, and button
describe("notifySupplierPoReceived — live mode (Meta Cloud API)", () => {
  it("calls Meta exactly once with templateName supplier_po_alert, exactly 3 (unchanged) body parameters, and the approved dynamic View Purchase Order URL button", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.PO-LIVE-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-1" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.name).toBe("supplier_po_alert");
    expect(sentBody.template.components).toHaveLength(2);

    const bodyComponent = sentBody.template.components.find((c: any) => c.type === "body");
    // Body parameters are UNCHANGED — still 3, same order, same meanings
    // (PO/order display ID, material, quantity).
    expect(bodyComponent.parameters).toHaveLength(3);
    expect(bodyComponent.parameters[0]).toEqual({ type: "text", text: "PO-2026-00001" });

    // Dynamic URL button — Meta's approved fixed prefix is
    // https://supplier.buildohub.in/purchase-orders/{{1}}, so only the bare
    // purchaseOrderId (po.id) is ever sent, never a full URL or poNumber.
    const buttonComponent = sentBody.template.components.find((c: any) => c.type === "button");
    expect(buttonComponent).toEqual({
      type: "button",
      sub_type: "url",
      index: 0,
      parameters: [{ type: "text", text: "po-1" }],
    });
    expect(sentBody.template.components.some((c: any) => c.type === "header")).toBe(false);
    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent", metaMessageId: "wamid.PO-LIVE-1" }) })
    );
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "sent" } })
    );
  });

  it("uses the triggering PurchaseOrder's own id for the button suffix, never its poNumber or a different PO", async () => {
    const { prisma } = buildHarness({ po: makePurchaseOrder({ id: "po-55", poNumber: "PO-2026-00777" }) });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.PO-LIVE-2" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-55" });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const buttonComponent = sentBody.template.components.find((c: any) => c.type === "button");
    expect(buttonComponent.parameters[0].text).toBe("po-55");
    expect(buttonComponent.parameters[0].text).not.toBe("PO-2026-00777");
    expect(buttonComponent.parameters[0].text).not.toMatch(/^https?:\/\//);
    expect(buttonComponent.parameters[0].text).not.toContain("buildohub.in");
    expect(buttonComponent.parameters[0].text).not.toContain("purchase-orders/");
  });

  it("resolves to the correct supplier purchase-order page for a representative PO id, with no duplicated path segment", async () => {
    const { prisma } = buildHarness({ po: makePurchaseOrder({ id: "po-abc123" }) });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.PO-LIVE-3" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await notifySupplierPoReceived(prisma, { purchaseOrderId: "po-abc123" });

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const buttonText = sentBody.template.components.find((c: any) => c.type === "button").parameters[0].text;
    const resolvedUrl = `https://supplier.buildohub.in/purchase-orders/${buttonText}`;
    expect(resolvedUrl).toBe("https://supplier.buildohub.in/purchase-orders/po-abc123");
    expect(resolvedUrl).not.toContain("purchase-orders/purchase-orders");
  });
});
