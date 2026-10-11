import { describe, expect, it, vi, beforeEach } from "vitest";

const { findIdentityMock } = vi.hoisted(() => ({ findIdentityMock: vi.fn() }));
vi.mock("@matsrc/db", () => ({ findIdentity: findIdentityMock }));

import { InboundTemplateReplyFlow } from "./inbound-template-reply.flow";

// Bare international format (no leading "+") — what every inbound Meta
// webhook `message.from` always looks like (confirmed against Meta's own
// webhook reference AND this environment's real WHATSAPP_DELIVERY_STATUS
// AuditLog rows — see this file's "C41 follow-up" test block below). All
// "happy path" / authorization tests in this file use this bare-digit
// style consistently for the INBOUND phone passed to tryHandle(), while
// varying the STORED phone format (with/without "+") per-test to prove the
// fix is format-agnostic in both directions — never relying on both sides
// coincidentally using the same format, which is the exact blind spot that
// let the original C41 phone-mismatch bug ship undetected.
const SUPPLIER_PHONE = "919876500001";
const BUYER_PHONE = "919876500002";
const OTHER_PHONE = "919876500009";

// The same numbers, "+"-prefixed — used to exercise the opposite stored
// format for each respective number.
const SUPPLIER_PHONE_PLUS = "+919876500001";
const BUYER_PHONE_PLUS = "+919876500002";

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
  it("routes a verified supplier to their own RFQ/OrderItem detail (stored phone has a leading '+', inbound Meta phone does not)", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        // Stored "+"-prefixed, as in the real environment.
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE_PLUS, templateName: "supplier_quote_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "item-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE_PLUS, phone: null }),
        findFirst: vi.fn().mockResolvedValue({
          id: "supplier-user-1",
          whatsappNumber: SUPPLIER_PHONE_PLUS,
          phone: null,
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

    // Inbound Meta phone — bare, no "+".
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
    // Prisma lookup is scoped by id/role only (phone match now happens in
    // JS via phoneNumbersMatch(), not in the where clause).
    expect(prisma.orderItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "item-1", supplierId: "supplier-profile-1" }) })
    );
  });

  it("routes a verified supplier when the STORED phone has no '+' and the inbound Meta phone is passed with one (opposite direction)", async () => {
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
          whatsappNumber: SUPPLIER_PHONE,
          phone: null,
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

    const result = await flow.tryHandle(SUPPLIER_PHONE_PLUS, {
      templateButtonPayload: "Review RFQ",
      templateMessageId: "wamid.RFQ1",
    });

    expect(result?.kind).toBe("text");
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
          whatsappNumber: SUPPLIER_PHONE,
          phone: null,
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
  it("routes a verified supplier to their own PurchaseOrder detail (stored phone has a leading '+', inbound Meta phone does not)", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE_PLUS, templateName: "supplier_po_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "po-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE_PLUS, phone: null }),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "supplier-user-1", whatsappNumber: SUPPLIER_PHONE_PLUS, phone: null, supplierProfile: { id: "supplier-profile-1" } }),
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

  it("routes a verified supplier when the STORED phone has no '+' and the inbound Meta phone is passed with one (opposite direction)", async () => {
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
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "supplier-user-1", whatsappNumber: SUPPLIER_PHONE, phone: null, supplierProfile: { id: "supplier-profile-1" } }),
      },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({ id: "po-1", poNumber: "PO-0001", supplierId: "supplier-profile-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(SUPPLIER_PHONE_PLUS, {
      templateButtonPayload: "View Purchase Order",
      templateMessageId: "wamid.PO1",
    });

    expect(result?.kind).toBe("text");
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
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "supplier-user-1", whatsappNumber: SUPPLIER_PHONE, phone: null, supplierProfile: { id: "supplier-profile-1" } }),
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

  it("never re-authenticates when the inbound phone belongs to a DIFFERENT real number than the recipient's stored phone (not just a format difference)", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: SUPPLIER_PHONE_PLUS, templateName: "supplier_po_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "po-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: SUPPLIER_PHONE_PLUS, phone: null }),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "supplier-user-1", whatsappNumber: SUPPLIER_PHONE_PLUS, phone: null, supplierProfile: { id: "supplier-profile-1" } }),
      },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({ id: "po-1", poNumber: "PO-0001", supplierId: "supplier-profile-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    // This check short-circuits at the tryHandle() correlation gate (log.phoneNumber
    // vs inbound phone) before ever reaching handleSupplierReply().
    const result = await flow.tryHandle(OTHER_PHONE, {
      templateButtonPayload: "View Purchase Order",
      templateMessageId: "wamid.PO1",
    });

    expect(result).toBeNull();
    expect(prisma.notificationEvent.findMany).not.toHaveBeenCalled();
  });
});

describe("InboundTemplateReplyFlow — payment_required (Make Payment) — payment safety", () => {
  it("replies with a deep link to the authenticated payment page and never marks the order paid (stored phone has a leading '+', inbound Meta phone does not)", async () => {
    findIdentityMock.mockResolvedValue({ id: "identity-1", userId: "buyer-user-1" });
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: BUYER_PHONE_PLUS, templateName: "payment_required" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: BUYER_PHONE_PLUS, phone: null }),
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

  it("replies correctly when the STORED phone has no '+' and the inbound Meta phone is passed with one (opposite direction)", async () => {
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

    const result = await flow.tryHandle(BUYER_PHONE_PLUS, {
      templateButtonPayload: "Make Payment",
      templateMessageId: "wamid.PAY1",
    });

    expect(result?.kind).toBe("text");
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
  it("routes a verified buyer to their own enquiry/quote detail (stored phone has a leading '+', inbound Meta phone does not)", async () => {
    findIdentityMock.mockResolvedValue({ id: "identity-1", userId: "buyer-user-1" });
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: BUYER_PHONE_PLUS, templateName: "quote_received" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ whatsappNumber: BUYER_PHONE_PLUS, phone: null }) },
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

  it("routes a verified buyer when the STORED phone has no '+' and the inbound Meta phone is passed with one (opposite direction)", async () => {
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

    const result = await flow.tryHandle(BUYER_PHONE_PLUS, {
      templateButtonPayload: "View Quote",
      templateMessageId: "wamid.QUOTE1",
    });

    expect(result?.kind).toBe("text");
  });

  it("never re-authenticates when the inbound phone is a genuinely DIFFERENT number than the recipient's stored phone (not just a format difference)", async () => {
    findIdentityMock.mockResolvedValue({ id: "identity-1", userId: "buyer-user-1" });
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi.fn().mockResolvedValue({ phoneNumber: BUYER_PHONE_PLUS, templateName: "quote_received" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ whatsappNumber: BUYER_PHONE_PLUS, phone: null }) },
      order: {
        findFirst: vi.fn().mockResolvedValue({ id: "order-1", enquiryId: "EQ/2607/00010", userId: "buyer-user-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(OTHER_PHONE, {
      templateButtonPayload: "View Quote",
      templateMessageId: "wamid.QUOTE1",
    });

    expect(result).toBeNull();
    expect(prisma.notificationEvent.findMany).not.toHaveBeenCalled();
  });
});

// C41 follow-up — real-world phone number FORMAT MISMATCH, now FIXED.
//
// Confirmed root cause (production/UAT database evidence, recorded at
// investigation time): User.whatsappNumber and User.phone are stored WITH a
// leading "+" in this environment (E.164, e.g. "+918870519167"), and the
// outbound senders (PaymentRequiredNotificationService /
// SupplierPoReceivedNotificationService / WhatsappNotificationService)
// write that exact value straight into WhatsAppMessageLog.phoneNumber
// (also "+918870519167" — confirmed via a real WhatsAppMessageLog row for
// payment_required and supplier_po_alert).
//
// Meta's inbound webhook `message.from` (and `statuses[].recipient_id`,
// confirmed via real AuditLog WHATSAPP_DELIVERY_STATUS rows for the SAME
// recipient) is the bare international number WITHOUT a leading "+"
// (e.g. "918870519167" — matches Meta's own documented webhook reference).
//
// FIX: every phone comparison in inbound-template-reply.flow.ts now goes
// through normalizeWhatsAppPhone()/phoneNumbersMatch() instead of a raw
// string `===`/`!==`, so a "+"-prefixed stored value and a bare inbound
// Meta value are correctly recognized as the same number in BOTH
// directions. These tests use the EXACT real phone number recorded during
// the investigation to prove the fix against the real data shape, not an
// invented one.
describe("InboundTemplateReplyFlow — C41 follow-up: real-world phone format mismatch (fix verification)", () => {
  const REAL_SHAPE_PHONE_WITH_PLUS = "+918870519167";
  const REAL_SHAPE_INBOUND_PHONE_NO_PLUS = "918870519167";

  it("FIX VERIFIED: payment_required 'Make Payment' now succeeds when WhatsAppMessageLog.phoneNumber has a leading '+' but the inbound Meta phone does not (real production/UAT data shape)", async () => {
    findIdentityMock.mockResolvedValue({ id: "identity-1", userId: "buyer-user-1" });
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ phoneNumber: REAL_SHAPE_PHONE_WITH_PLUS, templateName: "payment_required" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "buyer-user-1", entityId: "order-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: REAL_SHAPE_PHONE_WITH_PLUS, phone: null }),
      },
      order: {
        findFirst: vi.fn().mockResolvedValue({ id: "order-1", enquiryId: "EQ/2607/00001", userId: "buyer-user-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(REAL_SHAPE_INBOUND_PHONE_NO_PLUS, {
      templateButtonPayload: "Make Payment",
      templateMessageId: "wamid.PAY-REAL-1",
    });

    // FIXED: the legitimate, correctly-authorized buyer now gets the real
    // payment deep-link reply instead of `null` — the "+" prefix mismatch
    // no longer blocks correlation.
    expect(result?.kind).toBe("text");
    if (result?.kind === "text") {
      expect(result.text).toContain("/orders/order-1/payment");
      expect(result.text).toContain("EQ/2607/00001");
    }
    expect(prisma.notificationEvent.findMany).toHaveBeenCalledTimes(1);
  });

  it("FIX VERIFIED: supplier_po_alert 'View Purchase Order' now succeeds for the exact same reason, since the supplier genuinely owns the PO", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ phoneNumber: REAL_SHAPE_PHONE_WITH_PLUS, templateName: "supplier_po_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "po-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: REAL_SHAPE_PHONE_WITH_PLUS, phone: null }),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "supplier-user-1", whatsappNumber: REAL_SHAPE_PHONE_WITH_PLUS, phone: null, supplierProfile: { id: "supplier-profile-1" } }),
      },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({ id: "po-1", poNumber: "PO-2026-00001", supplierId: "supplier-profile-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    const result = await flow.tryHandle(REAL_SHAPE_INBOUND_PHONE_NO_PLUS, {
      templateButtonPayload: "View Purchase Order",
      templateMessageId: "wamid.PO-REAL-1",
    });

    // FIXED: the supplier genuinely owns po-1, and now correctly receives
    // the PO detail reply instead of `null`.
    expect(result?.kind).toBe("text");
    if (result?.kind === "text") {
      expect(result.text).toContain("PO-2026-00001");
    }
    expect(prisma.purchaseOrder.findFirst).toHaveBeenCalledTimes(1);
  });

  it("control: the SAME scenario also succeeds when the inbound phone matches WhatsAppMessageLog.phoneNumber's stored format exactly (both-'+' case)", async () => {
    const prisma = makePrisma({
      whatsAppMessageLog: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ phoneNumber: REAL_SHAPE_PHONE_WITH_PLUS, templateName: "supplier_po_alert" }),
      },
      notificationEvent: {
        findMany: vi.fn().mockResolvedValue([
          { recipientId: "supplier-user-1", entityId: "po-1", payload: {}, createdAt: new Date(), status: "sent" },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ whatsappNumber: REAL_SHAPE_PHONE_WITH_PLUS, phone: null }),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: "supplier-user-1", whatsappNumber: REAL_SHAPE_PHONE_WITH_PLUS, phone: null, supplierProfile: { id: "supplier-profile-1" } }),
      },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({ id: "po-1", poNumber: "PO-2026-00001", supplierId: "supplier-profile-1" }),
      },
    });
    const flow = new InboundTemplateReplyFlow(prisma as any);

    // Passing the phone in the SAME "+"-prefixed shape as WhatsAppMessageLog
    // succeeds end-to-end — confirming the rest of the correlation/
    // authorization chain is otherwise correct and this was always a pure
    // format-mismatch bug, not a deeper logic defect.
    const result = await flow.tryHandle(REAL_SHAPE_PHONE_WITH_PLUS, {
      templateButtonPayload: "View Purchase Order",
      templateMessageId: "wamid.PO-REAL-1",
    });

    expect(result?.kind).toBe("text");
    if (result?.kind === "text") {
      expect(result.text).toContain("PO-2026-00001");
    }
  });
});
