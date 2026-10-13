import { describe, expect, it, vi, beforeEach } from "vitest";
import { SupplierRfqReceivedNotificationService } from "./supplier-rfq-received-notification.service";
import { NotificationEngineService } from "../notification-engine.service";
import { NotificationPolicyService } from "../notification-policy.service";
import { WhatsAppEngineChannel } from "../channels/whatsapp-engine-channel.service";
import { InAppEngineChannel } from "../channels/in-app-engine-channel.service";
import { WhatsappNotificationService } from "./whatsapp-notification.service";
import { WhatsAppEngineConfigService } from "./whatsapp-engine-config.service";

/**
 * End-to-end style tests for the `supplier_quote_alert` WhatsApp
 * notification — deliberately exercises the REAL
 * NotificationEngineService -> NotificationPolicyService ->
 * WhatsAppEngineChannel -> WhatsappNotificationService chain (only Prisma
 * and `fetch` are faked), mirroring
 * customer-order-status-notification.service.spec.ts exactly.
 */

const RFQ_POLICY = {
  id: "policy-rfq-received",
  eventType: "SUPPLIER_RFQ_RECEIVED",
  channel: "WHATSAPP",
  templateName: "supplier_quote_alert",
  metaTemplateId: "2046949149261282",
  enabled: true,
  priority: "P1",
  maxPerDay: null,
  cooldownMinutes: null,
  businessHoursOnly: false,
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

function buildHarness(options: { globalEnabled?: boolean; mode?: "live" | "dry-run" | "off"; orderItem?: any; policyEnabled?: boolean } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    orderItem: { findUnique: vi.fn().mockResolvedValue(options.orderItem ?? makeOrderItem()) },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue({ ...RFQ_POLICY, enabled: options.policyEnabled ?? true }),
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
  const service = new SupplierRfqReceivedNotificationService(prisma, engine);

  return { service, prisma, notificationEvents };
}

describe("SupplierRfqReceivedNotificationService.notify", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires one SUPPLIER_RFQ_RECEIVED notification with the correct 4 template variables", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("item-1");

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          templateName: "supplier_quote_alert",
          parameters: ["TMT Bar 12mm", "50 BAG", "123 Site Road, Chennai", "02 Jan"],
        }),
      })
    );
  });

  it("resolves the OrderItem's current supplier as recipient", async () => {
    const { service, prisma } = buildHarness();
    await service.notify("item-1");
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientId: "user-sup-1", recipientType: "supplier" }) })
    );
  });

  it("does not send twice for the same orderItem+supplier (dedupe)", async () => {
    const { service, prisma } = buildHarness();
    await service.notify("item-1");
    await service.notify("item-1");
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });

  it("suppresses when the policy is disabled, and never crashes", async () => {
    const { service, prisma } = buildHarness({ policyEnabled: false });
    await expect(service.notify("item-1")).resolves.toBeUndefined();
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
  });

  it("never throws when the orderItem has no supplier/user on file", async () => {
    const { service } = buildHarness({ orderItem: makeOrderItem({ supplier: null }) });
    await expect(service.notify("item-1")).resolves.toBeUndefined();
  });

  it("never throws when the underlying prisma lookup rejects", async () => {
    const { service, prisma } = buildHarness();
    prisma.orderItem.findUnique.mockRejectedValueOnce(new Error("DB down"));
    await expect(service.notify("item-1")).resolves.toBeUndefined();
  });

  it("live mode: sends a dynamic URL button with the parent Order id (never the OrderItem id), body unchanged", async () => {
    const { service, prisma } = buildHarness({ mode: "live" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ messages: [{ id: "wamid.RFQ-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await service.notify("item-1");

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.name).toBe("supplier_quote_alert");

    const bodyComponent = sentBody.template.components.find((c: any) => c.type === "body");
    expect(bodyComponent.parameters).toEqual([
      { type: "text", text: "TMT Bar 12mm" },
      { type: "text", text: "50 BAG" },
      { type: "text", text: "123 Site Road, Chennai" },
      { type: "text", text: "02 Jan" },
    ]);

    // Dynamic URL button — Meta's approved fixed prefix is
    // https://supplier.buildohub.in/orders/{{1}}, so only the bare parent
    // Order id (orderItem.orderId, NEVER item-1's own OrderItem id) is sent,
    // and NO query-string/`respond` suffix is ever included.
    const buttonComponent = sentBody.template.components.find((c: any) => c.type === "button");
    expect(buttonComponent).toEqual({
      type: "button",
      sub_type: "url",
      index: 0,
      parameters: [{ type: "text", text: "order-1" }],
    });
    expect(buttonComponent.parameters[0].text).not.toBe("item-1");
    expect(buttonComponent.parameters[0].text).not.toContain("?");
    expect(buttonComponent.parameters[0].text).not.toContain("respond");
    expect(sentBody.template.components.some((c: any) => c.type === "header")).toBe(false);
  });

  it("resolves to the correct supplier order page for a representative order id, with no duplicated path segment or query string", async () => {
    const { service } = buildHarness({
      mode: "live",
      orderItem: makeOrderItem({ orderId: "order-abc123" }),
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ messages: [{ id: "wamid.RFQ-2" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await service.notify("item-1");

    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    const buttonText = sentBody.template.components.find((c: any) => c.type === "button").parameters[0].text;
    const resolvedUrl = `https://supplier.buildohub.in/orders/${buttonText}`;
    expect(resolvedUrl).toBe("https://supplier.buildohub.in/orders/order-abc123");
    expect(resolvedUrl).not.toContain("orders/orders");
    expect(resolvedUrl).not.toContain("?");
  });
});
