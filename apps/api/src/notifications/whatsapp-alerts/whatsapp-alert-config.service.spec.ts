import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppAlertConfigService } from "./whatsapp-alert-config.service";

const ENV_KEYS = [
  "WHATSAPP_ENABLED",
  "WHATSAPP_MODE",
  "TWILIO_WHATSAPP_NUMBER",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_SANDBOX_NUMBER_OVERRIDE",
  "TWILIO_CONTENT_SID_WATCHLIST_PRICE_HIT",
  "TWILIO_CONTENT_SID_ORDER_STATUS_UPDATE",
  "TWILIO_CONTENT_SID_RFQ_QUOTE_RECEIVED",
  "NODE_ENV",
] as const;

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

describe("WhatsAppAlertConfigService.validateAtStartup", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    vi.restoreAllMocks();
  });

  it("does nothing when WHATSAPP_ENABLED is not 'true' regardless of mode/config", () => {
    setEnv({ WHATSAPP_ENABLED: "false", WHATSAPP_MODE: "production" });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).not.toThrow();
  });

  it("fails when production mode is missing a required template mapping", () => {
    setEnv({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "production",
      TWILIO_WHATSAPP_NUMBER: "+15550009999",
      TWILIO_CONTENT_SID_WATCHLIST_PRICE_HIT: "HX-watchlist",
      TWILIO_CONTENT_SID_ORDER_STATUS_UPDATE: "HX-order",
      // TWILIO_CONTENT_SID_RFQ_QUOTE_RECEIVED intentionally missing
    });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).toThrow(/rfq_quote_received/);
  });

  it("passes in production mode when all template mappings and a non-sandbox number are configured", () => {
    setEnv({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "production",
      TWILIO_WHATSAPP_NUMBER: "+15550009999",
      TWILIO_CONTENT_SID_WATCHLIST_PRICE_HIT: "HX-watchlist",
      TWILIO_CONTENT_SID_ORDER_STATUS_UPDATE: "HX-order",
      TWILIO_CONTENT_SID_RFQ_QUOTE_RECEIVED: "HX-rfq",
    });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).not.toThrow();
  });

  it("fails in production mode when the configured number is the known Twilio sandbox number", () => {
    setEnv({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "production",
      TWILIO_WHATSAPP_NUMBER: "+14155238886",
      TWILIO_CONTENT_SID_WATCHLIST_PRICE_HIT: "HX-watchlist",
      TWILIO_CONTENT_SID_ORDER_STATUS_UPDATE: "HX-order",
      TWILIO_CONTENT_SID_RFQ_QUOTE_RECEIVED: "HX-rfq",
    });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).toThrow(/known Twilio Sandbox number/);
  });

  it("fails in sandbox mode when a non-sandbox number is configured without the override flag", () => {
    setEnv({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "sandbox",
      TWILIO_WHATSAPP_NUMBER: "+15550009999",
    });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).toThrow(/does not match the known Twilio Sandbox number/);
  });

  it("passes in sandbox mode when a non-sandbox number is configured WITH the override flag set", () => {
    setEnv({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "sandbox",
      TWILIO_WHATSAPP_NUMBER: "+15550009999",
      TWILIO_SANDBOX_NUMBER_OVERRIDE: "true",
    });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).not.toThrow();
  });

  it("passes in sandbox mode when the configured number is the known sandbox number", () => {
    setEnv({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "sandbox",
      TWILIO_WHATSAPP_NUMBER: "+14155238886",
    });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).not.toThrow();
  });

  it("fails in sandbox mode when NODE_ENV is 'production' (cross-environment guardrail)", () => {
    setEnv({
      WHATSAPP_ENABLED: "true",
      WHATSAPP_MODE: "sandbox",
      TWILIO_WHATSAPP_NUMBER: "+14155238886",
      NODE_ENV: "production",
    });
    const config = new WhatsAppAlertConfigService();
    expect(() => config.validateAtStartup()).toThrow(/NODE_ENV="production"/);
  });

  it("onModuleInit delegates to validateAtStartup", () => {
    setEnv({ WHATSAPP_ENABLED: "false" });
    const config = new WhatsAppAlertConfigService();
    const spy = vi.spyOn(config, "validateAtStartup");
    config.onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
