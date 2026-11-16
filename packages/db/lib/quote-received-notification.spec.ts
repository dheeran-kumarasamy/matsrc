import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  notifyQuoteReceived,
  summarizeQuoteMaterials,
  summarizeQuoteQuantities,
  getQuoteReceivedWhatsAppMode,
} from "./quote-received-notification";

describe("QuoteReceivedNotification — material & quantity summaries", () => {
  it("summarizes up to 3 materials and adds '+N more'", () => {
    const quotes = [
      { lineItem: { product: { name: "Steel 12mm" } } },
      { lineItem: { product: { name: "Cement 53 Grade" } } },
      { lineItem: { product: { name: "Red Bricks" } } },
      { lineItem: { product: { name: "Sand M" } } },
    ];
    expect(summarizeQuoteMaterials(quotes)).toBe("Steel 12mm, Cement 53 Grade, Red Bricks, +1 more");
  });

  it("handles empty materials safely", () => {
    expect(summarizeQuoteMaterials([])).toBe("your requested material");
  });

  it("summarizes up to 3 quantities with units", () => {
    const quotes = [
      { lineItem: { quantity: 10, product: { unit: "Ton" } } },
      { lineItem: { quantity: 50, product: { unit: "Bags" } } },
    ];
    expect(summarizeQuoteQuantities(quotes)).toBe("10 Ton, 50 Bags");
  });

  it("handles empty quantities safely", () => {
    expect(summarizeQuoteQuantities([])).toBe("—");
  });
});

describe("notifyQuoteReceived", () => {
  let mockPrisma: any;
  let orderData: any;
  let quoteData: any[];
  let policyData: any;
  let globalSettingsData: any;
  let preferenceData: any;
  let existingEventData: any;
  let existingNotificationData: any;
  let createdEvents: any[];
  let createdLogs: any[];
  let createdNotifications: any[];

  beforeEach(() => {
    createdEvents = [];
    createdLogs = [];
    createdNotifications = [];

    orderData = {
      id: "ord-1",
      enquiryId: "BH-2026-0001",
      userId: "user-buyer-1",
      user: {
        id: "user-buyer-1",
        phone: "+919876543210",
        whatsappNumber: "+919876543210",
      },
    };

    quoteData = [
      {
        id: "quote-1",
        enquiryId: "ord-1",
        supplierId: "sup-1",
        lineItemId: "item-1",
        lineItem: {
          id: "item-1",
          quantity: 20,
          product: { name: "TMT Rebar 12mm", unit: "Ton" },
        },
      },
    ];

    policyData = {
      eventType: "QUOTE_RECEIVED",
      channel: "WHATSAPP",
      templateName: "quote_received",
      enabled: true,
    };

    globalSettingsData = { id: "global", whatsappBusinessEnabled: true };
    preferenceData = null;
    existingEventData = null;
    existingNotificationData = null;

    mockPrisma = {
      order: {
        findUnique: vi.fn(async () => orderData),
      },
      supplierQuote: {
        findMany: vi.fn(async () => quoteData),
      },
      notificationEventPolicy: {
        findUnique: vi.fn(async () => policyData),
      },
      notificationGlobalSettings: {
        findUnique: vi.fn(async () => globalSettingsData),
      },
      notificationPreference: {
        findUnique: vi.fn(async () => preferenceData),
      },
      notificationEvent: {
        findUnique: vi.fn(async () => existingEventData),
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `event-${createdEvents.length + 1}`, ...data };
          createdEvents.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = createdEvents.find((e) => e.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
      },
      whatsAppMessageLog: {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `log-${createdLogs.length + 1}`, ...data };
          createdLogs.push(row);
          return row;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const row = createdLogs.find((l) => l.id === where.id);
          if (row) Object.assign(row, data);
          return row;
        }),
      },
      notification: {
        findFirst: vi.fn(async () => existingNotificationData),
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `notif-${createdNotifications.length + 1}`, ...data };
          createdNotifications.push(row);
          return row;
        }),
      },
    };
  });

  it("does nothing if quoteIds is empty", async () => {
    await notifyQuoteReceived(mockPrisma, { enquiryId: "ord-1", supplierId: "sup-1", quoteIds: [] });
    expect(mockPrisma.order.findUnique).not.toHaveBeenCalled();
    expect(createdEvents).toHaveLength(0);
    expect(createdNotifications).toHaveLength(0);
  });

  it("creates both in-app notification and WhatsApp event in dry-run mode", async () => {
    await notifyQuoteReceived(mockPrisma, { enquiryId: "ord-1", supplierId: "sup-1", quoteIds: ["quote-1"] });

    // 1. In-app notification created
    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0]).toMatchObject({
      userId: "user-buyer-1",
      channel: "IN_APP",
      title: "Quote Received",
      templateType: "RFQ_QUOTE_SHARED",
      idempotencyKey: "builder-quote-received:ord-1:sup-1:item-1",
    });
    const parsedVariables = JSON.parse(createdNotifications[0].variables);
    expect(parsedVariables.orderId).toBe("ord-1");

    // 2. WhatsApp event and log created
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toMatchObject({
      eventType: "QUOTE_RECEIVED",
      recipientId: "user-buyer-1",
      status: "sent",
      dedupeKey: "QUOTE_RECEIVED:ord-1:sup-1:item-1",
    });

    expect(createdLogs).toHaveLength(1);
    expect(createdLogs[0]).toMatchObject({
      phoneNumber: "+919876543210",
      templateName: "quote_received",
      parameters: ["BH-2026-0001", "TMT Rebar 12mm", "20 Ton"],
    });
  });

  it("suppresses WhatsApp when user opts out, but still creates in-app notification", async () => {
    preferenceData = { userId: "user-buyer-1", whatsappEnabled: false };

    await notifyQuoteReceived(mockPrisma, { enquiryId: "ord-1", supplierId: "sup-1", quoteIds: ["quote-1"] });

    // In-app alert is created regardless of WhatsApp opt-out
    expect(createdNotifications).toHaveLength(1);

    // WhatsApp is suppressed with reason
    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toMatchObject({
      status: "suppressed",
      suppressReason: "USER_OPTED_OUT",
    });
    expect(createdLogs).toHaveLength(0);
  });

  it("suppresses WhatsApp when duplicate dedupe key exists", async () => {
    existingEventData = { id: "existing-event" };

    await notifyQuoteReceived(mockPrisma, { enquiryId: "ord-1", supplierId: "sup-1", quoteIds: ["quote-1"] });

    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].status).toBe("suppressed");
    expect(createdEvents[0].suppressReason).toBe("DUPLICATE_DEDUPE_KEY");
  });

  it("handles missing phone safely without throwing", async () => {
    orderData.user.phone = null;
    orderData.user.whatsappNumber = null;

    await notifyQuoteReceived(mockPrisma, { enquiryId: "ord-1", supplierId: "sup-1", quoteIds: ["quote-1"] });

    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0].status).toBe("failed");
    expect(createdLogs).toHaveLength(0);
  });
});

