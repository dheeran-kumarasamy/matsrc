import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks the `twilio` SDK module itself (rather than `fetch`, since the Twilio Node SDK
 * does its own HTTP transport internally) — mirrors the fixture-based approach used in
 * `apps/api/src/whatsapp/adapters/meta-cloud-api-send.adapter.spec.ts` for the sibling
 * Meta Cloud API adapter, adapted for a class-based SDK client instead of raw `fetch`.
 */
const createMock = vi.fn();

vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    messages: { create: createMock },
  })),
}));

import { TwilioWhatsAppProvider } from "./twilio-whatsapp.provider";
import { WhatsAppAlertConfigService } from "./whatsapp-alert-config.service";

function buildConfig(overrides: Partial<Record<string, string | undefined>> = {}): WhatsAppAlertConfigService {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(overrides, key);
  const config = new WhatsAppAlertConfigService();
  vi.spyOn(config, "getTwilioAccountSid").mockReturnValue(has("accountSid") ? overrides.accountSid : "AC-test-sid");
  vi.spyOn(config, "getTwilioAuthToken").mockReturnValue(has("authToken") ? overrides.authToken : "test-auth-token");
  vi.spyOn(config, "getTwilioWhatsAppNumber").mockReturnValue(has("whatsappNumber") ? overrides.whatsappNumber : "+15550001111");
  vi.spyOn(config, "getTwilioMessagingServiceSid").mockReturnValue(has("messagingServiceSid") ? overrides.messagingServiceSid : undefined);
  vi.spyOn(config, "getTwilioContentSid").mockReturnValue(has("contentSid") ? overrides.contentSid : "HX-content-sid");
  return config;
}


describe("TwilioWhatsAppProvider", () => {
  let provider: TwilioWhatsAppProvider;

  beforeEach(() => {
    createMock.mockReset();
    provider = new TwilioWhatsAppProvider(buildConfig());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a template message and returns the provider message SID on success", async () => {
    createMock.mockResolvedValueOnce({ sid: "SM-success-123" });

    const result = await provider.sendTemplateMessage("919876543210", "order_status_update", {
      orderId: "order-1",
      status: "SHIPPED",
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.to).toBe("whatsapp:919876543210");
    expect(callArgs.from).toBe("whatsapp:+15550001111");
    expect(callArgs.contentSid).toBe("HX-content-sid");
    expect(JSON.parse(callArgs.contentVariables)).toEqual({ orderId: "order-1", status: "SHIPPED" });

    expect(result).toEqual({ success: true, providerMessageId: "SM-success-123" });
  });

  it("uses messagingServiceSid instead of from when configured", async () => {
    provider = new TwilioWhatsAppProvider(buildConfig({ messagingServiceSid: "MG-service-sid" }));
    createMock.mockResolvedValueOnce({ sid: "SM-success-456" });

    await provider.sendTemplateMessage("919876543210", "rfq_quote_received", { enquiryId: "enq-1" });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.messagingServiceSid).toBe("MG-service-sid");
    expect(callArgs.from).toBeUndefined();
  });

  it("returns a structured failure (never throws) when no Content SID is configured for the templateKey", async () => {
    provider = new TwilioWhatsAppProvider(buildConfig({ contentSid: undefined }));

    const result = await provider.sendTemplateMessage("919876543210", "watchlist_price_hit", {});

    expect(createMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No Twilio Content Template SID configured/);
  });

  it("fails fast with no retry on a permanent Twilio error code (invalid 'To' number)", async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error("Invalid To number"), { code: 21211, status: 400 }));

    const result = await provider.sendTemplateMessage("not-a-number", "order_status_update", {});

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid To number/);
    expect(result.error).toMatch(/code=21211/);
  });

  it("retries with backoff on a transient/5xx failure and eventually succeeds", async () => {
    vi.useFakeTimers();
    createMock
      .mockRejectedValueOnce(Object.assign(new Error("Server error"), { status: 500 }))
      .mockResolvedValueOnce({ sid: "SM-after-retry" });

    const sendPromise = provider.sendTemplateMessage("919876543210", "order_status_update", {});
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: true, providerMessageId: "SM-after-retry" });
    vi.useRealTimers();
  });

  it("gives up and returns a structured failure after exhausting all retries on persistent transient failures", async () => {
    vi.useFakeTimers();
    createMock.mockRejectedValue(Object.assign(new Error("Server error"), { status: 500 }));

    const sendPromise = provider.sendTemplateMessage("919876543210", "order_status_update", {});
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    // MAX_RETRIES = 3 -> 1 initial attempt + 3 retries = 4 calls total
    expect(createMock).toHaveBeenCalledTimes(4);
    expect(result.success).toBe(false);
    vi.useRealTimers();
  });

  it("returns a structured failure when neither messagingServiceSid nor whatsappNumber is configured", async () => {
    provider = new TwilioWhatsAppProvider(buildConfig({ whatsappNumber: undefined, messagingServiceSid: undefined }));

    const result = await provider.sendTemplateMessage("919876543210", "order_status_update", {});

    expect(createMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Neither TWILIO_MESSAGING_SERVICE_SID nor TWILIO_WHATSAPP_NUMBER/);
  });
});
