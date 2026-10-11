import { describe, expect, it, vi, beforeEach } from "vitest";

const { findIdentityMock } = vi.hoisted(() => ({ findIdentityMock: vi.fn() }));
vi.mock("@matsrc/db", () => ({ findIdentity: findIdentityMock }));

import { InboundTemplateReplyFlow } from "./inbound-template-reply.flow";

const SUPPLIER_PHONE = "919876500001";
const BUYER_PHONE = "919876500002";
const OTHER_PHONE = "919876500009";

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    whatsAppMessageLog: {
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.whatsAppMessageLog,
    },
    notificationEvent: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.notificationEvent,
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.user,
    },
    orderItem: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.orderItem,
    },
    purchaseOrder: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.purchaseOrder,
    },
    order: {
      findFirst: vi.fn().mockResolvedValue(null),
      ...overrides.order,
    },
  };
}

beforeEach(() => {
  findIdentityMock.mockReset();
});

describe("InboundTemplateReplyFlow — URL buttons and unrecognized payloads are safe no-ops", () => {
  it("returns null when no templateMessageId is provided (e.g. a plain text message or URL-button tap, which generates no context.id)", async () => {
    const prisma = makePrisma();
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, { templateButtonPayload: "Copy code" });

    expect(result).toBeNull();
    expect(prisma.whatsAppMessageLog.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the templateMessageId cannot be correlated to any WhatsAppMessageLog", async () => {
    const prisma = makePrisma({ whatsAppMessageLog: { findUnique: vi.fn().mockResolvedValue(null) } });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, {
      templateButtonPayload: "Review RFQ",
      templateMessageId: "wamid.UNKNOWN",
    });

    expect(result).toBeNull();
  });

  it("returns null for a template this flow does not handle (e.g. supplier_rfq_reminder — no implemented business trigger)", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE, templateName: "supplier_rfq_reminder" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, {
      templateButtonPayload: "Submit Quote",
      templateMessageId: "wamid.REMINDER1",
    });

    expect(result).toBeNull();
  });

  it("returns null when the inbound phone does not match the WhatsAppMessageLog's phoneNumber (spoofed context.id)", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE, templateName: "supplier_quote_alert" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(OTHER_PHONE, {
      templateButtonPayload: "Review RFQ",
      templateMessageId: "wamid.RFQ1",
    });

    expect(result).toBeNull();
  });
});

describe("InboundTemplateReplyFlow — supplier_quote_alert (Review RFQ)", () => {
  it("routes a verified supplier to their own RFQ/OrderItem detail", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE, templateName: "supplier_quote_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "item-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE, phone: null }),
        findFirst: vi.fn().mockResolvedValue({
          id: "supplier-user-1",
          supplierProfile: { id: "supplier-profile-1" },
        }),
      },
      orderItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          orderId: "order-1",
          quantity: 25,
          supplierId: "supplier-profile-1",
          order: { enquiryId: "EQ/2607/00001" },
          product: { name: "ACC Cement", unit: "BAG" },
        }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, {
      templateButtonPayload: "Review RFQ",
      templateMessageId: "wamid.RFQ1",
    });

    expect(result).not.toBeNull();
    expect(result?.kind).toBe("text");
    if (result?.kind === "text") {
      expect(result.text).toContain("ACC Cement");
      expect(result.text).toContain("EQ/2607/00001");
      expect(result.text).toContain("/orders/order-1");
    }
    expect(prisma.orderItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "item-1", supplierId: "supplier-profile-1" }) })
    );
  });

  it("never returns another supplier's RFQ detail when the OrderItem belongs to a different supplier", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE, templateName: "supplier_quote_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "item-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE, phone: null }),
        findFirst: vi.fn().mockResolvedValue({
          id: "supplier-user-1",
          supplierProfile: { id: "supplier-profile-1" },
        }),
      },
      // The OrderItem actually belongs to a DIFFERENT supplier — the
      // where-clause filter means this never resolves, mirroring real
      // Prisma behavior for a mismatched supplierId filter.
      orderItem: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, {
      templateButtonPayload: "Review RFQ",
      templateMessageId: "wamid.RFQ1",
    });

    expect(result).toBeNull();
  });

  it("never re-authenticates as supplier when the phone belongs to no SUPPLIER-role User", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE, templateName: "supplier_quote_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "item-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE, phone: null }),
        findFirst: vi.fn().mockResolvedValue(null), // not found as SUPPLIER
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, {
      templateButtonPayload: "Review RFQ",
      templateMessageId: "wamid.RFQ1",
    });

    expect(result).toBeNull();
  });
});

describe("InboundTemplateReplyFlow — supplier_po_alert (View Purchase Order)", () => {
  it("routes a verified supplier to their own PurchaseOrder detail", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE, templateName: "supplier_po_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "po-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE, phone: null }),
        findFirst: vi.fn().mockResolvedValue({ id: "supplier-user-1", supplierProfile: { id: "supplier-profile-1" } }),
      },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({ id: "po-1", poNumber: "PO-0001", supplierId: "supplier-profile-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, {
      templateButtonPayload: "View Purchase Order",
      templateMessageId: "wamid.PO1",
    });

    expect(result?.kind).toBe("text");
    if (result?.kind === "text") {
      expect(result.text).toContain("PO-0001");
      expect(result.text).toContain("/purchase-orders/po-1");
    }
    expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "po-1", supplierId: "supplier-profile-1" }) })
    );
  });

  it("never returns another supplier's PO when the PurchaseOrder belongs to a different supplier", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE, templateName: "supplier_po_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "po-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE, phone: null }),
        findFirst: vi.fn().mockResolvedValue({ id: "supplier-user-1", supplierProfile: { id: "supplier-profile-1" } }),
      },
      purchaseOrder: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE, {
      templateButtonPayload: "View Purchase Order",
      templateMessageId: "wamid.PO1",
    });

    expect(result).toBeNull();
  });

describe("InboundTemplateReplyFlow — payment_required (Make Payment) — payment safety", () => {
  it("replies with a deep link to the authenticated payment page and never marks the order paid", async () => {
    findIdentityMock.mockResolvedValue({ id: "identity-1", userId: "buyer-user-1" });
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: BUYER_PHONE, templateName: "payment_required" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: BUYER_PHONE, phone: null }),
      },
      order: {
        findFirst: vi.fn().mockResolvedValue({ id: "order-1", enquiryId: "EQ/2607/00009", userId: "buyer-user-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(BUYER_PHONE, {
      templateButtonPayload: "Make Payment",
      templateMessageId: "wamid.PAY1",
    });

    expect(result?.kind).toBe("text");
    if (result?.kind === "text") {
      expect(result.text).toContain("/orders/order-1/payment");
      expect(result.text).toContain("EQ/2607/00009");
      expect(result.text.toLowerCase()).not.toContain("payment successful");
      expect(result.text.toLowerCase()).not.toContain("marked as paid");
    }
    expect(prisma.order.findFirst).toHaveBeenCalledTimes(1);
    expect((prisma.order as any).update).toBeUndefined();
  });

  it("never returns another buyer's order/payment details", async () => {
    findIdentityMock.mockResolvedValue({ id: "identity-1", userId: "buyer-user-2" });
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: BUYER_PHONE, templateName: "payment_required" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ whatsappNumber: BUYER_PHONE, phone: null }) },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(BUYER_PHONE, {
      templateButtonPayload: "Make Payment",
      templateMessageId: "wamid.PAY1",
    });

    expect(result).toBeNull();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it("returns null when the phone cannot be resolved to any BUILDER AuthIdentity", async () => {
    findIdentityMock.mockResolvedValue(null);
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: BUYER_PHONE, templateName: "payment_required" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ whatsappNumber: BUYER_PHONE, phone: null }) },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(BUYER_PHONE, {
      templateButtonPayload: "Make Payment",
      templateMessageId: "wamid.PAY1",
    });

    expect(result).toBeNull();
  });
});

describe("InboundTemplateReplyFlow — quote_received (View Quote)", () => {
  it("routes a verified buyer to their own enquiry/quote detail", async () => {
    findIdentityMock.mockResolvedValue({ id: "identity-1", userId: "buyer-user-1" });
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: BUYER_PHONE, templateName: "quote_received" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ whatsappNumber: BUYER_PHONE, phone: null }) },
      order: {
        findFirst: vi.fn().mockResolvedValue({ id: "order-1", enquiryId: "EQ/2607/00010", userId: "buyer-user-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(BUYER_PHONE, {
      templateButtonPayload: "View Quote",
      templateMessageId: "wamid.QUOTE1",
    });

    expect(result?.kind).toBe("text");
    if (result?.kind === "text") {
      expect(result.text).toContain("EQ/2607/00010");
      expect(result.text).toContain("/orders/order-1");
    }
  });
});

});
