import { describe, expect, it, vi, beforeEach } from "vitest";
import { QuoteReceivedNotificationService } from "./quote-received-notification.service";
import { NotificationEngineService } from "../notification-engine.service";
import { NotificationPolicyService } from "../notification-policy.service";
import { WhatsAppEngineChannel } from "../channels/whatsapp-engine-channel.service";
import { InAppEngineChannel } from "../channels/in-app-engine-channel.service";
import { WhatsappNotificationService } from "./whatsapp-notification.service";
import { WhatsAppEngineConfigService } from "./whatsapp-engine-config.service";

/**
 * End-to-end style tests for the `quote_received` WhatsApp notification —
 * deliberately exercises the REAL NotificationEngineService ->
 * NotificationPolicyService -> WhatsAppEngineChannel ->
 * WhatsappNotificationService chain (only Prisma and `fetch` are faked),
 * mirroring payment-required-notification.service.spec.ts exactly.
 */

const QUOTE_RECEIVED_POLICY = {
  id: "policy-quote-received",
  eventType: "QUOTE_RECEIVED",
  channel: "WHATSAPP",
  templateName: "quote_received",
  metaTemplateId: "1055000930652376",
  enabled: true,
  priority: "P1",
  maxPerDay: null,
  cooldownMinutes: null,
  businessHoursOnly: false,
};

function makeOrder(overrides: Partial<any> = {}) {
  return {
    id: "enq-1",
    userId: "builder-1",
    enquiryId: "BH-2026-00452",
    user: { id: "builder-1", phone: "919876543210", whatsappNumber: null },
    ...overrides,
  };
}

function makeQuote(overrides: Partial<any> = {}) {
  return {
    id: "sq-1",
    enquiryId: "enq-1",
    supplierId: "sup-1",
    lineItemId: "line-1",
    lineItem: { quantity: 10, product: { name: "TMT 10mm Steel", unit: "MT" } },
    ...overrides,
  };
}

function buildHarness(options: { globalEnabled?: boolean; mode?: "live" | "dry-run" | "off"; order?: any; quotes?: any[] } = {}) {
  const notificationEvents = new Map<string, any>();
  let eventCounter = 0;

  const prisma: any = {
    order: {
      findUnique: vi.fn().mockResolvedValue(options.order ?? makeOrder()),
    },
    supplierQuote: {
      findMany: vi.fn().mockResolvedValue(options.quotes ?? [makeQuote()]),
    },
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue(QUOTE_RECEIVED_POLICY),
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
  const service = new QuoteReceivedNotificationService(prisma, engine);

  return { service, prisma };
}

describe("QuoteReceivedNotificationService.notify — correct trigger", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires one QUOTE_RECEIVED notification for a successfully-committed submission", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: "quote_received" }) })
    );
  });

  it("is a no-op (never looks up the order) when no quoteIds are passed — e.g. a draft/empty submission", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("enq-1", "sup-1", []);

    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("never throws and never notifies when the enquiry cannot be found", async () => {
    const { service, prisma } = buildHarness();
    prisma.order.findUnique.mockResolvedValueOnce(null);

    await expect(service.notify("missing-enq", "sup-1", ["sq-1"])).resolves.toBeUndefined();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("never throws and never notifies when the SupplierQuote rows cannot be found (e.g. a rolled-back transaction)", async () => {
    const { service, prisma } = buildHarness({ quotes: [] });

    await expect(service.notify("enq-1", "sup-1", ["sq-missing"])).resolves.toBeUndefined();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });

  it("never throws even if the underlying prisma lookup rejects", async () => {
    const { service, prisma } = buildHarness();
    prisma.order.findUnique.mockRejectedValueOnce(new Error("DB down"));

    await expect(service.notify("enq-1", "sup-1", ["sq-1"])).resolves.toBeUndefined();
  });
});

describe("QuoteReceivedNotificationService.notify — recipient resolution", () => {
  it("resolves the builder/customer who owns the Order, never the submitting supplier", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ recipientId: "builder-1", recipientType: "builder" }) })
    );
  });

  it("skips WhatsApp send when the builder has no phone/whatsappNumber, without throwing", async () => {
    const { service, prisma } = buildHarness({ order: makeOrder({ user: { id: "builder-1", phone: null, whatsappNumber: null } }) });

    await expect(service.notify("enq-1", "sup-1", ["sq-1"])).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "failed" } })
    );
  });
});

describe("QuoteReceivedNotificationService.notify — multiple suppliers / deduplication", () => {
  it("does not create a duplicate WhatsApp send when the same supplier's identical submission is retried", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("enq-1", "sup-1", ["sq-1"]);
    await service.notify("enq-1", "sup-1", ["sq-1"]);

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });

  it("a SECOND supplier quoting the SAME enquiry gets its own independent notification (not suppressed as a duplicate)", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    prisma.supplierQuote.findMany.mockResolvedValueOnce([
      makeQuote({ id: "sq-2", supplierId: "sup-2", lineItemId: "line-1" }),
    ]);
    await service.notify("enq-1", "sup-2", ["sq-2"]);

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(2);
  });

  it("the SAME supplier later quoting a DIFFERENT line item for the same enquiry is treated as a new submission", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    prisma.supplierQuote.findMany.mockResolvedValueOnce([
      makeQuote({ id: "sq-3", supplierId: "sup-1", lineItemId: "line-2" }),
    ]);
    await service.notify("enq-1", "sup-1", ["sq-3"]);

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(2);
  });

  it("the same supplier resubmitting the SAME line item(s) (a revision) does not re-notify", async () => {
    const { service, prisma } = buildHarness();

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    // A revision creates a brand-new SupplierQuote row (new id), but for the
    // identical line item — the dedupe key is content-based, not id-based.
    prisma.supplierQuote.findMany.mockResolvedValueOnce([
      makeQuote({ id: "sq-1-revised", supplierId: "sup-1", lineItemId: "line-1" }),
    ]);
    await service.notify("enq-1", "sup-1", ["sq-1-revised"]);

    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledTimes(1);
  });
});

describe("QuoteReceivedNotificationService.notify — policy", () => {
  it("suppresses (and never calls Meta) when the NotificationEventPolicy row is disabled", async () => {
    const { service, prisma } = buildHarness();
    prisma.notificationEventPolicy.findUnique.mockResolvedValueOnce({ ...QUOTE_RECEIVED_POLICY, enabled: false });

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "TEMPLATE_DISABLED" }) })
    );
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
  });

  it("suppresses when the global WhatsApp business kill-switch is off", async () => {
    const { service, prisma } = buildHarness({ globalEnabled: false });

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "CHANNEL_DISABLED_GLOBALLY" }) })
    );
  });
});

describe("QuoteReceivedNotificationService.notify — live Meta payload / failure handling", () => {
  it("live mode: sends exactly three body parameters, no header, correct template name, no button component (static View Quote button rendered by Meta)", async () => {
    const { service, prisma } = buildHarness({ mode: "live" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ messages: [{ id: "wamid.QUOTE-RECEIVED-1" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await service.notify("enq-1", "sup-1", ["sq-1"]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.template.name).toBe("quote_received");
    expect(sentBody.template.components).toHaveLength(1);
    expect(sentBody.template.components[0].type).toBe("body");
    expect(sentBody.template.components[0].parameters).toHaveLength(3);
    expect(sentBody.template.components[0].parameters[0]).toEqual({ type: "text", text: "BH-2026-00452" });
    expect(sentBody.template.components[0].parameters[1]).toEqual({ type: "text", text: "TMT 10mm Steel" });
    expect(sentBody.template.components[0].parameters[2]).toEqual({ type: "text", text: "10 MT" });
    expect(sentBody.template.components.some((c: any) => c.type === "button")).toBe(false);
    expect(sentBody.template.components.some((c: any) => c.type === "header")).toBe(false);
    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "sent", metaMessageId: "wamid.QUOTE-RECEIVED-1" }) })
    );
  });

  it("live mode: a Meta API failure is recorded as failed and never throws — the quote submission itself is unaffected", async () => {
    const { service, prisma } = buildHarness({ mode: "live" });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => ({ error: { message: "Internal error", code: 999 } }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(service.notify("enq-1", "sup-1", ["sq-1"])).resolves.toBeUndefined();

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed" }) })
    );
  });
});
