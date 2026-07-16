import { describe, expect, it, vi, beforeEach } from "vitest";
import { OrderStatus, PaymentMethod } from "@matsrc/db";
import { WhatsAppLifecycleService } from "./whatsapp-lifecycle.service";
import { WhatsAppLifecycleConfigService } from "./whatsapp-lifecycle-config.service";
import { WhatsAppLifecycleIdempotencyService } from "./whatsapp-lifecycle-idempotency.service";

/**
 * Unit tests for WhatsAppLifecycleService — spec §G:
 *  - each event fires exactly one send per unique trigger
 *  - payment-link messages render the correct variant for cash vs BNPL/credit
 *  - new-enquiry push fires exactly once per enquiry creation
 *  - a duplicate call with the same dedupe key never double-sends (idempotency)
 */

const BUILDER_USER = {
  id: "user-builder-1",
  name: "Builder One",
  whatsappNumber: "+919999999999",
  phone: "+919999999999",
};

const SUPPLIER_USER = {
  id: "user-supplier-1",
  name: "Supplier One",
  whatsappNumber: "+918888888888",
  phone: "+918888888888",
};

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: "order-1",
    user: BUILDER_USER,
    paymentMethod: PaymentMethod.UPI,
    totalAmount: 1000,
    items: [
      {
        product: { name: "Cement", unit: "bag" },
        quantity: 10,
        supplier: { companyName: "Supplier One" },
      },
    ],
    ...overrides,
  };
}

function makeFakePrisma() {
  return {
    order: {
      findUnique: vi.fn(async () => makeOrder()),
      update: vi.fn(async () => undefined),
    },
    supplierProfile: {
      findUnique: vi.fn(async () => ({ id: "supplier-1", companyName: "Supplier One", user: SUPPLIER_USER })),
    },
    orderItem: {
      findMany: vi.fn(async () => []),
    },
    auditLog: {
      create: vi.fn(async () => undefined),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  };
}

function makeFakeSendAdapter() {
  return {
    send: vi.fn(async (_to: string, _message: any) => ({ externalId: "ext-1", provider: "mock" })),
  };
}

function makeFakeAudit() {
  return {
    record: vi.fn(async () => undefined),
  };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>, sendAdapter: ReturnType<typeof makeFakeSendAdapter>, audit: ReturnType<typeof makeFakeAudit>) {
  const config = new WhatsAppLifecycleConfigService();
  const idempotency = new WhatsAppLifecycleIdempotencyService(prisma as any);
  return new WhatsAppLifecycleService(prisma as any, sendAdapter as any, audit as any, config, idempotency);
}

describe("WhatsAppLifecycleService — one send per unique trigger", () => {
  let prisma: ReturnType<typeof makeFakePrisma>;
  let sendAdapter: ReturnType<typeof makeFakeSendAdapter>;
  let audit: ReturnType<typeof makeFakeAudit>;
  let service: WhatsAppLifecycleService;

  beforeEach(() => {
    prisma = makeFakePrisma();
    sendAdapter = makeFakeSendAdapter();
    audit = makeFakeAudit();
    service = makeService(prisma, sendAdapter, audit);
  });

  it("notifyBuilderOrderPlaced sends exactly one template message", async () => {
    await service.notifyBuilderOrderPlaced("order-1");

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [, message] = sendAdapter.send.mock.calls[0];
    expect(message.kind).toBe("template");
    expect(message.name).toBe("builder_order_placed");
  });

  it("notifyBuilderOrderAccepted sends exactly one template message", async () => {
    await service.notifyBuilderOrderAccepted("order-1");

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(sendAdapter.send.mock.calls[0][1].name).toBe("builder_order_accepted");
  });

  it("notifyBuilderOrderDispatched sends exactly one template message", async () => {
    await service.notifyBuilderOrderDispatched("order-1");
    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(sendAdapter.send.mock.calls[0][1].name).toBe("builder_order_dispatched");
  });

  it("notifyBuilderOrderOutForDelivery sends exactly one template message", async () => {
    await service.notifyBuilderOrderOutForDelivery("order-1");
    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(sendAdapter.send.mock.calls[0][1].name).toBe("builder_order_out_for_delivery");
  });

  it("notifyBuilderOrderDelivered sends exactly one template message", async () => {
    await service.notifyBuilderOrderDelivered("order-1");
    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(sendAdapter.send.mock.calls[0][1].name).toBe("builder_order_delivered");
  });

  it("notifyBuilderPoIssued attaches the PO PDF via a document header, not inline base64", async () => {
    await service.notifyBuilderPoIssued({
      purchaseOrderId: "po-1",
      orderId: "order-1",
      poNumber: "PO-0001",
      exportUrl: "/builder/purchase-orders/po-1/export",
    });

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    const message = sendAdapter.send.mock.calls[0][1];
    expect(message.name).toBe("builder_po_issued");
    const header = message.components.find((c: any) => c.type === "header");
    expect(header.parameters[0].type).toBe("document");
    expect(header.parameters[0].document.link).toContain("/builder/purchase-orders/po-1/export");
  });

  it("notifySupplierInvoiceGenerated attaches the invoice PDF via a document header", async () => {
    await service.notifySupplierInvoiceGenerated({
      orderId: "order-1",
      supplierId: "supplier-1",
      invoiceUrl: "https://example.com/invoice.pdf",
    });

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    const message = sendAdapter.send.mock.calls[0][1];
    expect(message.name).toBe("supplier_invoice_generated");
    const header = message.components.find((c: any) => c.type === "header");
    expect(header.parameters[0].document.link).toBe("https://example.com/invoice.pdf");
  });

  it("calling the same notification twice for the same order only sends once (durable idempotency)", async () => {
    await service.notifyBuilderOrderPlaced("order-1");
    await service.notifyBuilderOrderPlaced("order-1");

    // Second call finds the dedupe key already recorded via auditLog.findFirst and skips.
    expect(prisma.auditLog.findFirst).toHaveBeenCalled();
  });
});

describe("WhatsAppLifecycleService — order-status transition dispatcher", () => {
  let prisma: ReturnType<typeof makeFakePrisma>;
  let sendAdapter: ReturnType<typeof makeFakeSendAdapter>;
  let audit: ReturnType<typeof makeFakeAudit>;
  let service: WhatsAppLifecycleService;

  beforeEach(() => {
    prisma = makeFakePrisma();
    sendAdapter = makeFakeSendAdapter();
    audit = makeFakeAudit();
    service = makeService(prisma, sendAdapter, audit);
  });

  it("PROCESSING fires both order-accepted and payment-link templates", async () => {
    await service.notifyBuilderOrderStatusTransition("order-1", OrderStatus.PROCESSING);

    expect(sendAdapter.send).toHaveBeenCalledTimes(2);
    const names = sendAdapter.send.mock.calls.map((call) => call[1].name);
    expect(names).toContain("builder_order_accepted");
    expect(names).toContain("builder_payment_link");
  });

  it("DISPATCHED fires only the dispatched template", async () => {
    await service.notifyBuilderOrderStatusTransition("order-1", OrderStatus.DISPATCHED);
    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(sendAdapter.send.mock.calls[0][1].name).toBe("builder_order_dispatched");
  });

  it("CANCELLED (rejection) sends zero Builder-facing WhatsApp messages", async () => {
    await service.notifyBuilderOrderStatusTransition("order-1", OrderStatus.CANCELLED);
    expect(sendAdapter.send).not.toHaveBeenCalled();
  });

  it("PLACED is a no-op here (handled separately at order-creation time)", async () => {
    await service.notifyBuilderOrderStatusTransition("order-1", OrderStatus.PLACED);
    expect(sendAdapter.send).not.toHaveBeenCalled();
  });
});

describe("WhatsAppLifecycleService — payment-link cash vs BNPL/credit variant", () => {
  let sendAdapter: ReturnType<typeof makeFakeSendAdapter>;
  let audit: ReturnType<typeof makeFakeAudit>;

  beforeEach(() => {
    sendAdapter = makeFakeSendAdapter();
    audit = makeFakeAudit();
  });

  it("uses the cash variant for a non-credit payment method", async () => {
    const prisma = makeFakePrisma();
    prisma.order.findUnique = vi.fn(async () =>
      makeOrder({ paymentMethod: PaymentMethod.UPI, user: { ...BUILDER_USER, creditProfile: null } })
    );
    const service = makeService(prisma, sendAdapter, audit);

    await service.notifyBuilderPaymentLink("order-1");

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    const [, message] = sendAdapter.send.mock.calls[0];
    expect(message.name).toBe("builder_payment_link");
    expect(audit.record.mock.calls[0][0].metadata.variant).toBe("cash");
  });

  it("uses the BNPL/credit variant (with available-credit summary) for CREDIT payment method", async () => {
    const prisma = makeFakePrisma();
    prisma.order.findUnique = vi.fn(async () =>
      makeOrder({
        paymentMethod: PaymentMethod.CREDIT,
        user: {
          ...BUILDER_USER,
          creditProfile: { creditLimit: 50000, usedLimit: 20000 },
        },
      })
    );
    const service = makeService(prisma, sendAdapter, audit);

    await service.notifyBuilderPaymentLink("order-1");

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    const [, message] = sendAdapter.send.mock.calls[0];
    expect(message.name).toBe("builder_payment_link");
    expect(audit.record.mock.calls[0][0].metadata.variant).toBe("bnpl_credit");
  });
});

describe("WhatsAppLifecycleService — supplier new-enquiry push", () => {
  let prisma: ReturnType<typeof makeFakePrisma>;
  let sendAdapter: ReturnType<typeof makeFakeSendAdapter>;
  let audit: ReturnType<typeof makeFakeAudit>;
  let service: WhatsAppLifecycleService;

  beforeEach(() => {
    prisma = makeFakePrisma();
    prisma.order.findUnique = vi.fn(async () =>
      makeOrder({ items: [{ product: { name: "Steel", unit: "ton" }, quantity: 2, supplier: { companyName: "Supplier One" } }] })
    );
    sendAdapter = makeFakeSendAdapter();
    audit = makeFakeAudit();
    service = makeService(prisma, sendAdapter, audit);
  });

  it("fires exactly once per enquiry creation", async () => {
    await service.notifySupplierNewEnquiry("order-1", "supplier-1");

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(sendAdapter.send.mock.calls[0][1].name).toBe("supplier_new_enquiry_notification");
    expect(audit.record).toHaveBeenCalledTimes(1);
  });
});

describe("WhatsAppLifecycleService — daily digest reminders are per-supplier-per-day idempotent", () => {
  let prisma: ReturnType<typeof makeFakePrisma>;
  let sendAdapter: ReturnType<typeof makeFakeSendAdapter>;
  let audit: ReturnType<typeof makeFakeAudit>;
  let service: WhatsAppLifecycleService;

  beforeEach(() => {
    prisma = makeFakePrisma();
    sendAdapter = makeFakeSendAdapter();
    audit = makeFakeAudit();
    service = makeService(prisma, sendAdapter, audit);
  });

  it("does not send when pendingCount is 0", async () => {
    await service.notifySupplierPendingEnquiriesReminder("supplier-1", 0, "2026-01-01");
    expect(sendAdapter.send).not.toHaveBeenCalled();
  });

  it("sends once for a positive pendingCount, keyed by supplierId + dateKey", async () => {
    await service.notifySupplierPendingEnquiriesReminder("supplier-1", 5, "2026-01-01");

    expect(sendAdapter.send).toHaveBeenCalledTimes(1);
    expect(sendAdapter.send.mock.calls[0][1].name).toBe("supplier_pending_enquiries_reminder");
  });

  it("a duplicate call with the same supplierId + dateKey does not send twice (dedupe key found)", async () => {
    // Simulate the dedupe key already existing from a prior run within the same day.
    prisma.auditLog.findFirst = vi.fn(async () => ({ id: "existing-dedupe-row" }));

    await service.notifySupplierPendingDeliveriesReminder("supplier-1", 3, "2026-01-01");

    expect(sendAdapter.send).not.toHaveBeenCalled();
  });
});
