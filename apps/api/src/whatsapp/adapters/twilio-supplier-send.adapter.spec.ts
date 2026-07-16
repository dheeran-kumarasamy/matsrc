import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks the `twilio` SDK module itself (mirrors the approach used in
 * `apps/api/src/notifications/whatsapp-alerts/twilio-whatsapp.provider.spec.ts`).
 */
const createMock = vi.fn();

vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    messages: { create: createMock },
  })),
}));

import { TwilioSupplierSendAdapter } from "./twilio-supplier-send.adapter";

const ORIGINAL_ENV = { ...process.env };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("TwilioSupplierSendAdapter", () => {
  let adapter: TwilioSupplierSendAdapter;

  beforeEach(() => {
    createMock.mockReset();
    process.env = { ...ORIGINAL_ENV };
    setEnv({
      TWILIO_ACCOUNT_SID: "AC-test-sid",
      TWILIO_AUTH_TOKEN: "test-auth-token",
      TWILIO_SUPPLIER_WHATSAPP_NUMBER: "+15550009999",
      TWILIO_SUPPLIER_MESSAGING_SERVICE_SID: undefined,
      TWILIO_CONTENT_SID_SUPPLIER_OTP_VERIFICATION: undefined,
      TWILIO_CONTENT_SID_SUPPLIER_REENGAGEMENT: undefined,
      WHATSAPP_REENGAGEMENT_TEMPLATE: "supplier_reengagement_nudge",
    });
    adapter = new TwilioSupplierSendAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  it("sends a plain text message and returns the provider message SID", async () => {
    createMock.mockResolvedValueOnce({ sid: "SM-text-1" });

    const result = await adapter.send("919876543210", { kind: "text", text: "Hello supplier" });

    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.to).toBe("whatsapp:919876543210");
    expect(callArgs.from).toBe("whatsapp:+15550009999");
    expect(callArgs.body).toBe("Hello supplier");
    expect(result).toEqual({ externalId: "SM-text-1", provider: "twilio-supplier-whatsapp" });
  });

  it("uses messagingServiceSid instead of from when configured", async () => {
    setEnv({ TWILIO_SUPPLIER_MESSAGING_SERVICE_SID: "MG-service-sid" });
    adapter = new TwilioSupplierSendAdapter();
    createMock.mockResolvedValueOnce({ sid: "SM-text-2" });

    await adapter.send("919876543210", { kind: "text", text: "hi" });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.messagingServiceSid).toBe("MG-service-sid");
    expect(callArgs.from).toBeUndefined();
  });

  it("flattens a list message into numbered plain text (no native Twilio list type), without duplicate numbering", async () => {
    createMock.mockResolvedValueOnce({ sid: "SM-list-1" });

    await adapter.send("919876543210", {
      kind: "list",
      header: "Matsrc Supplier Bot",
      body: "How can I help you today?",
      rows: [
        { id: "PRICE_UPDATE", title: "Update Product Price", description: "Change price" },
        { id: "ORDER_STATUS", title: "Order Status", description: "View orders" },
      ],
    });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.body).toContain("Matsrc Supplier Bot");
    expect(callArgs.body).toContain("How can I help you today?");
    // Single numbering source (adapter-injected index), no "N. N." duplication.
    expect(callArgs.body).toContain("1. Update Product Price — Change price");
    expect(callArgs.body).toContain("2. Order Status — View orders");
    expect(callArgs.body).not.toMatch(/\d+\.\s*\d+\./);
    expect(callArgs.body).toContain("Reply with the number of your choice.");
  });


  it("flattens a buttons message into numbered plain text", async () => {
    createMock.mockResolvedValueOnce({ sid: "SM-buttons-1" });

    await adapter.send("919876543210", {
      kind: "buttons",
      body: "Confirm price update?",
      buttons: [
        { id: "confirm", title: "Confirm" },
        { id: "cancel", title: "Cancel" },
      ],
    });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.body).toContain("Confirm price update?");
    expect(callArgs.body).toContain("1. Confirm");
    expect(callArgs.body).toContain("2. Cancel");
  });

  it("sends a template message using a Content Template SID when one is mapped", async () => {
    setEnv({ TWILIO_CONTENT_SID_SUPPLIER_OTP_VERIFICATION: "HX-otp-sid" });
    adapter = new TwilioSupplierSendAdapter();
    createMock.mockResolvedValueOnce({ sid: "SM-otp-1" });

    await adapter.send("919876543210", {
      kind: "template",
      name: "supplier_otp_verification",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: "123456" }] }],
    });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.contentSid).toBe("HX-otp-sid");
    expect(JSON.parse(callArgs.contentVariables)).toEqual({ "1": "123456" });
    expect(callArgs.body).toBeUndefined();
  });

  it("falls back to a free-form text message for a template when no Content SID is mapped (e.g. Twilio Sandbox)", async () => {
    createMock.mockResolvedValueOnce({ sid: "SM-otp-fallback-1" });

    const result = await adapter.send("919876543210", {
      kind: "template",
      name: "supplier_otp_verification",
      languageCode: "en",
      components: [{ type: "body", parameters: [{ type: "text", text: "654321" }] }],
    });

    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.contentSid).toBeUndefined();
    expect(callArgs.body).toContain("supplier_otp_verification");
    expect(callArgs.body).toContain("654321");
    expect(result).toEqual({ externalId: "SM-otp-fallback-1", provider: "twilio-supplier-whatsapp" });
  });

  it("throws when neither a WhatsApp number nor a Messaging Service SID is configured", async () => {
    setEnv({ TWILIO_SUPPLIER_WHATSAPP_NUMBER: undefined, TWILIO_SUPPLIER_MESSAGING_SERVICE_SID: undefined });
    adapter = new TwilioSupplierSendAdapter();

    await expect(adapter.send("919876543210", { kind: "text", text: "hi" })).rejects.toThrow(
      /Neither TWILIO_SUPPLIER_MESSAGING_SERVICE_SID nor TWILIO_SUPPLIER_WHATSAPP_NUMBER/
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("retries with backoff on a transient/5xx failure and eventually succeeds", async () => {
    vi.useFakeTimers();
    createMock
      .mockRejectedValueOnce(Object.assign(new Error("Server error"), { status: 500 }))
      .mockResolvedValueOnce({ sid: "SM-after-retry" });

    const sendPromise = adapter.send("919876543210", { kind: "text", text: "hi" });
    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ externalId: "SM-after-retry", provider: "twilio-supplier-whatsapp" });
    vi.useRealTimers();
  });

  it("fails fast with no retry on a permanent Twilio error code (invalid 'To' number)", async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error("Invalid To number"), { code: 21211, status: 400 }));

    await expect(adapter.send("not-a-number", { kind: "text", text: "hi" })).rejects.toThrow(/code=21211/);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
