import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsappNotificationService } from "./whatsapp-notification.service";
import { WhatsAppEngineConfigService } from "./whatsapp-engine-config.service";

function makePrisma() {
  const rows = new Map<string, any>();
  let counter = 0;
  return {
    whatsAppMessageLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        counter += 1;
        const row = { id: `log-${counter}`, ...data, metaMessageId: null, errorDetails: null };
        rows.set(row.id, row);
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return row;
      }),
    },
    __rows: rows,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, statusText: status === 200 ? "OK" : "Error", json: async () => body } as unknown as Response;
}

describe("WhatsappNotificationService", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let config: WhatsAppEngineConfigService;

  beforeEach(() => {
    prisma = makePrisma();
    config = new WhatsAppEngineConfigService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE;
  });

  it("off mode: creates a log row but never calls fetch, and marks it failed with DISABLED_BY_CHANNEL", async () => {
    vi.spyOn(config, "getMode").mockReturnValue("off");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const service = new WhatsappNotificationService(prisma as any, config);
    const result = await service.sendTemplateAlert("919876543210", "supplier_price_update", ["Acme Steel", "2"]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.errorDetails).toBe("DISABLED_BY_CHANNEL");
    expect(prisma.__rows.get(result.logId).status).toBe("failed");
  });

  it("dry-run mode: never calls fetch and simulates queued -> sent with a mock message id", async () => {
    vi.spyOn(config, "getMode").mockReturnValue("dry-run");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const service = new WhatsappNotificationService(prisma as any, config);
    const result = await service.sendTemplateAlert("919876543210", "supplier_price_update", ["Acme Steel", "2"]);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("sent");
    expect(result.metaMessageId).toMatch(/^mock-wa-/);
  });

  it("live mode: on Meta success, stores messages[0].id and marks status sent", async () => {
    vi.spyOn(config, "getMode").mockReturnValue("live");
    vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
    vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.ABC123" }] })));

    const service = new WhatsappNotificationService(prisma as any, config);
    const result = await service.sendTemplateAlert("919876543210", "supplier_price_update", ["Acme Steel"]);

    expect(result.status).toBe("sent");
    expect(result.metaMessageId).toBe("wamid.ABC123");
  });

  it("live mode: on Meta rejection (4xx), marks status failed and stores sanitized errorDetails (never the token)", async () => {
    vi.spyOn(config, "getMode").mockReturnValue("live");
    vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
    vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: "Invalid template name", code: 132001 } }, 400))
    );

    const service = new WhatsappNotificationService(prisma as any, config);
    const result = await service.sendTemplateAlert("919876543210", "unapproved_template", []);

    expect(result.status).toBe("failed");
    expect(result.errorDetails).toContain("Invalid template name");
    expect(result.errorDetails).not.toContain("SECRET_TOKEN");
  });

  it("live mode: a network/transport failure never throws and marks status failed", async () => {
    vi.spyOn(config, "getMode").mockReturnValue("live");
    vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
    vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const service = new WhatsappNotificationService(prisma as any, config);
    const result = await service.sendTemplateAlert("919876543210", "supplier_price_update", []);

    expect(result.status).toBe("failed");
    expect(result.errorDetails).toBe("ECONNRESET");
  });

  it("live mode: missing WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN never crashes and marks status failed", async () => {
    vi.spyOn(config, "getMode").mockReturnValue("live");
    vi.spyOn(config, "getPhoneNumberId").mockReturnValue(undefined);
    vi.spyOn(config, "getAccessToken").mockReturnValue(undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const service = new WhatsappNotificationService(prisma as any, config);
    const result = await service.sendTemplateAlert("919876543210", "supplier_price_update", []);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  describe("Meta template configuration updates (supplier_rfq_reminder / customer_order_status)", () => {
    it("customer_order_status: sends only the template name + exactly two body variables, with no button/components payload beyond body", async () => {
      vi.spyOn(config, "getMode").mockReturnValue("live");
      vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
      vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.ORDER1" }] }));
      vi.stubGlobal("fetch", fetchSpy);

      const service = new WhatsappNotificationService(prisma as any, config);
      const result = await service.sendTemplateAlert("919876543210", "customer_order_status", ["BH-2026-00452", "Dispatched"]);

      expect(result.status).toBe("sent");
      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sentBody.template.name).toBe("customer_order_status");
      expect(sentBody.template.components).toHaveLength(1);
      expect(sentBody.template.components[0].type).toBe("body");
      expect(sentBody.template.components[0].parameters).toEqual([
        { type: "text", text: "BH-2026-00452" },
        { type: "text", text: "Dispatched" },
      ]);
      // No button/header component of any kind is ever constructed by this service.
      expect(sentBody.template.components.some((c: any) => c.type === "button")).toBe(false);
      expect(sentBody.template.components.some((c: any) => c.type === "header")).toBe(false);
    });

    it("supplier_rfq_reminder: resolves to the new Meta template name and passes the correct three variables (RFQ id, material, deadline)", async () => {
      vi.spyOn(config, "getMode").mockReturnValue("live");
      vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
      vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.RFQ1" }] }));
      vi.stubGlobal("fetch", fetchSpy);

      const service = new WhatsappNotificationService(prisma as any, config);
      const result = await service.sendTemplateAlert("919876543210", "supplier_rfq_reminder", [
        "RFQ-2026-00125",
        "TMT 10mm Steel",
        "10 September 2026, 5:00 PM",
      ]);

      expect(result.status).toBe("sent");
      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sentBody.template.name).toBe("supplier_rfq_reminder");
      expect(sentBody.template.name).not.toBe("supplier_quote_reminder");
      expect(sentBody.template.components[0].parameters).toEqual([
        { type: "text", text: "RFQ-2026-00125" },
        { type: "text", text: "TMT 10mm Steel" },
        { type: "text", text: "10 September 2026, 5:00 PM" },
      ]);
    });

    it("supplier_price_update: sends the template name + exactly ONE body variable (the missing-product list), matching the approved Meta template's single {{1}}", async () => {
      vi.spyOn(config, "getMode").mockReturnValue("live");
      vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
      vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
      vi.spyOn(config, "getTemplateLanguage").mockReturnValue("en");
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.PRICE1" }] }));
      vi.stubGlobal("fetch", fetchSpy);

      const service = new WhatsappNotificationService(prisma as any, config);
      const result = await service.sendTemplateAlert("919876543210", "supplier_price_update", ["TMT 10mm, TMT 12mm, M-Sand"]);

      expect(result.status).toBe("sent");
      expect(result.metaMessageId).toBe("wamid.PRICE1");
      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sentBody.type).toBe("template");
      expect(sentBody.template.name).toBe("supplier_price_update");
      expect(sentBody.template.language).toEqual({ code: "en" });
      expect(sentBody.template.components).toHaveLength(1);
      expect(sentBody.template.components[0]).toEqual({
        type: "body",
        parameters: [{ type: "text", text: "TMT 10mm, TMT 12mm, M-Sand" }],
      });
    });
  });

  describe("buttonUrlSuffix — payment_required_v2's approved dynamic Complete Payment URL button", () => {
    it("adds a dynamic URL button component (sub_type url, index 0) only when buttonUrlSuffix is supplied", async () => {
      vi.spyOn(config, "getMode").mockReturnValue("live");
      vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
      vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
      vi.spyOn(config, "getTemplateLanguage").mockReturnValue("en");
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.PAY1" }] }));
      vi.stubGlobal("fetch", fetchSpy);

      const service = new WhatsappNotificationService(prisma as any, config);
      const result = await service.sendTemplateAlert(
        "919876543210",
        "payment_required_v2",
        ["BH-2026-00452", "₹50,000", "14 Oct 2026"],
        "order-1"
      );

      expect(result.status).toBe("sent");
      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sentBody.template.components).toHaveLength(2);
      expect(sentBody.template.components[0]).toEqual({
        type: "body",
        parameters: [
          { type: "text", text: "BH-2026-00452" },
          { type: "text", text: "₹50,000" },
          { type: "text", text: "14 Oct 2026" },
        ],
      });
      expect(sentBody.template.components[1]).toEqual({
        type: "button",
        sub_type: "url",
        index: 0,
        parameters: [{ type: "text", text: "order-1" }],
      });
    });

    it("never sends a full URL as the button parameter — only the bare dynamic suffix", async () => {
      vi.spyOn(config, "getMode").mockReturnValue("live");
      vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
      vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.PAY2" }] }));
      vi.stubGlobal("fetch", fetchSpy);

      const service = new WhatsappNotificationService(prisma as any, config);
      await service.sendTemplateAlert("919876543210", "payment_required_v2", ["BH-1", "₹1,000", "1 Jan 2027"], "order-77");

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const buttonText = sentBody.template.components.find((c: any) => c.type === "button").parameters[0].text;
      expect(buttonText).toBe("order-77");
      expect(buttonText).not.toMatch(/^https?:\/\//);
      expect(buttonText).not.toContain("buildohub.in");
      expect(buttonText).not.toContain("payment/");
    });

    it("omitting buttonUrlSuffix preserves the pre-existing body-only payload exactly (backward compatible)", async () => {
      vi.spyOn(config, "getMode").mockReturnValue("live");
      vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
      vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.PAY3" }] }));
      vi.stubGlobal("fetch", fetchSpy);

      const service = new WhatsappNotificationService(prisma as any, config);
      await service.sendTemplateAlert("919876543210", "payment_required_v2", ["BH-1", "₹1,000", "1 Jan 2027"]);

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(sentBody.template.components).toHaveLength(1);
      expect(sentBody.template.components[0].type).toBe("body");
      expect(sentBody.template.components.some((c: any) => c.type === "button")).toBe(false);
    });

    it("resolves to the correct destination URL for a representative order id, with no duplicated 'payment/' prefix", async () => {
      vi.spyOn(config, "getMode").mockReturnValue("live");
      vi.spyOn(config, "getPhoneNumberId").mockReturnValue("PHONE_ID");
      vi.spyOn(config, "getAccessToken").mockReturnValue("SECRET_TOKEN");
      const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.PAY4" }] }));
      vi.stubGlobal("fetch", fetchSpy);

      const service = new WhatsappNotificationService(prisma as any, config);
      await service.sendTemplateAlert("919876543210", "payment_required_v2", ["BH-1", "₹1,000", "1 Jan 2027"], "abc123");

      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
      const buttonText = sentBody.template.components.find((c: any) => c.type === "button").parameters[0].text;
      // Approved fixed prefix is https://buildohub.in/orders/payment/ — the
      // resolved destination is prefix + buttonText, which must be exactly
      // https://buildohub.in/orders/payment/abc123, never a duplicated
      // .../payment/payment/abc123.
      const resolvedUrl = `https://buildohub.in/orders/payment/${buttonText}`;
      expect(resolvedUrl).toBe("https://buildohub.in/orders/payment/abc123");
      expect(resolvedUrl).not.toContain("payment/payment");
    });
  });
});
