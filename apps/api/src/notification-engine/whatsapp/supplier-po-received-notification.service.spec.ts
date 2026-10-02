import { describe, expect, it, vi, beforeEach } from "vitest";
import { SupplierPoReceivedNotificationService } from "./supplier-po-received-notification.service";
import { NotificationEngineService } from "../notification-engine.service";
import { NotificationPolicyService } from "../notification-policy.service";
import { WhatsAppEngineChannel } from "../channels/whatsapp-engine-channel.service";
import { InAppEngineChannel } from "../channels/in-app-engine-channel.service";
import { WhatsappNotificationService } from "./whatsapp-notification.service";
import { WhatsAppEngineConfigService } from "./whatsapp-engine-config.service";

/**
 * End-to-end style tests for the `supplier_po_alert` WhatsApp
 * notification — deliberately exercises the REAL
 * NotificationEngineService -> NotificationPolicyService ->
 * WhatsAppEngineChannel -> WhatsappNotificationService chain (only Prisma
 * and `fetch` are faked), mirroring
 * supplier-rfq-received-notification.service.spec.ts exactly.
 */

const PO_POLICY = {
  id: "policy-po-received",
  eventType: "SUPPLIER_PO_RECEIVED",
  channel: "WHATSAPP",
  templateName: "supplier_po_alert",
  metaTemplateId: "1999605497419495",
  enabled: true,
  priority: "P0",
  maxPerDay: null,
  cooldownMinutes: null,
  businessHoursOnly: false,
};

function makePurchaseOrder(overrides: Partial<any> = {}) {
  return {
    id: "po-1",
    poNumber: "PO-2026-00001",
    orderId: "order-1",
    supplierId: "sup-1",
    status: "ISSUED",
    lineItems: [{ id: "li-1", quantity: 50, product: { name: "TMT Bar 12mm", unit: "BAG" } }],
    supplier: { id: "sup-1", user: { id: "user-sup-1", phone: "919876543210", whatsappNumber: null } },
    ...overrides,
  };
}

function buildHarness(options: { globalEnabled?: boolean; mode?: "live" | "dry-run" | "off"; po?: any; policyEnabled?: boolean } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    purchaseOrder: { findUnique: vi.fn().mockResolvedValue(options.po ?? makePurchaseOrder()) },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue({ ...PO_POLICY, enabled: options.policyEnabled ?? true }),
    },
    notificationGlobalSettings: {
      findUnique: vi.fn().mockResolvedValue({ id: "global", whatsappBusinessEnabled: options.globalEnabled ?? true }),
    },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
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
  const service = new SupplierPoReceivedNotificationService(prisma, engine);

  return { service, prisma, notificationEvents };
}

describe("SupplierPoReceivedNotificationService.notify", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires one SUPPLIER_PO_RECEIVED notification with the correct 3 template variables", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("po-1");

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          templateName: "supplier_po_alert",
          parameters: ["PO-2026-00001", "TMT Bar 12mm", "50 BAG"],
        }),
      })
    );
  });

  it("resolves the PurchaseOrder's supplier as recipient", async () => {
    const { service, prisma } = buildHarness();
    await service.notify("po-1");
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientId: "user-sup-1", recipientType: "supplier" }) })
    );
  });

  it("does NOT notify for a DRAFT purchase order", async () => {
    const { service, prisma } = buildHarness({ po: makePurchaseOrder({ status: "DRAFT" }) });
    await service.notify("po-1");
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("does not send twice for the same purchaseOrder+supplier (dedupe)", async () => {
    const { service, prisma } = buildHarness();
    await service.notify("po-1");
    await service.notify("po-1");
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });

  it("suppresses when the policy is disabled, and never crashes", async () => {
    const { service, prisma } = buildHarness({ policyEnabled: false });
    await expect(service.notify("po-1")).resolves.toBeUndefined();
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
  });

  it("never throws when the purchaseOrder has no supplier/user on file", async () => {
    const { service } = buildHarness({ po: makePurchaseOrder({ supplier: null }) });
    await expect(service.notify("po-1")).resolves.toBeUndefined();
  });

  it("never throws when the underlying prisma lookup rejects", async () => {
    const { service, prisma } = buildHarness();
    prisma.purchaseOrder.findUnique.mockRejectedValueOnce(new Error("DB down"));
    await expect(service.notify("po-1")).resolves.toBeUndefined();
  });
});
