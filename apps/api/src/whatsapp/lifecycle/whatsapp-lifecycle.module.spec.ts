import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { whatsAppLifecycleSendProviderFactory } from "./whatsapp-lifecycle.module";
import { MockWhatsAppSendAdapter } from "../adapters/mock-whatsapp-send.adapter";
import { MetaCloudApiSendAdapter } from "../adapters/meta-cloud-api-send.adapter";

describe("whatsAppLifecycleSendProviderFactory (WhatsAppLifecycleModule)", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalWhatsAppAdapter = process.env.WHATSAPP_ADAPTER;

  let mockAdapter: MockWhatsAppSendAdapter;
  let metaAdapter: MetaCloudApiSendAdapter;

  beforeEach(() => {
    mockAdapter = new MockWhatsAppSendAdapter();
    metaAdapter = new MetaCloudApiSendAdapter();
  });

  afterEach(() => {
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }

    if (originalWhatsAppAdapter === undefined) {
      delete process.env.WHATSAPP_ADAPTER;
    } else {
      process.env.WHATSAPP_ADAPTER = originalWhatsAppAdapter;
    }
  });

  describe("Vercel Preview environment (fail-closed safety)", () => {
    it("selects Mock adapter when VERCEL_ENV=preview and WHATSAPP_ADAPTER=meta", () => {
      process.env.VERCEL_ENV = "preview";
      process.env.WHATSAPP_ADAPTER = "meta";

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(mockAdapter);
      expect(selected).not.toBe(metaAdapter);
    });

    it("selects Mock adapter when VERCEL_ENV=preview and WHATSAPP_ADAPTER=mock", () => {
      process.env.VERCEL_ENV = "preview";
      process.env.WHATSAPP_ADAPTER = "mock";

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(mockAdapter);
    });

    it("selects Mock adapter when VERCEL_ENV=preview and WHATSAPP_ADAPTER is unset", () => {
      process.env.VERCEL_ENV = "preview";
      delete process.env.WHATSAPP_ADAPTER;

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(mockAdapter);
    });
  });

  describe("Production environment", () => {
    it("selects Meta adapter when VERCEL_ENV=production and WHATSAPP_ADAPTER=meta", () => {
      process.env.VERCEL_ENV = "production";
      process.env.WHATSAPP_ADAPTER = "meta";

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(metaAdapter);
      expect(selected).not.toBe(mockAdapter);
    });

    it("selects Mock adapter when VERCEL_ENV=production and WHATSAPP_ADAPTER=mock", () => {
      process.env.VERCEL_ENV = "production";
      process.env.WHATSAPP_ADAPTER = "mock";

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(mockAdapter);
    });
  });

  describe("Non-Preview / Default environment (VERCEL_ENV unset)", () => {
    it("selects Meta adapter when VERCEL_ENV is unset and WHATSAPP_ADAPTER=meta", () => {
      delete process.env.VERCEL_ENV;
      process.env.WHATSAPP_ADAPTER = "meta";

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(metaAdapter);
    });

    it("selects Mock adapter when VERCEL_ENV is unset and WHATSAPP_ADAPTER is unset", () => {
      delete process.env.VERCEL_ENV;
      delete process.env.WHATSAPP_ADAPTER;

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(mockAdapter);
    });

    it("selects Mock adapter when VERCEL_ENV is unset and WHATSAPP_ADAPTER=mock", () => {
      delete process.env.VERCEL_ENV;
      process.env.WHATSAPP_ADAPTER = "mock";

      const selected = whatsAppLifecycleSendProviderFactory(mockAdapter, metaAdapter);
      expect(selected).toBe(mockAdapter);
    });
  });
});
