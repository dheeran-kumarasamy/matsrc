import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppAlertService } from "./whatsapp-alert.service";
import { WhatsAppAlertConfigService } from "./whatsapp-alert-config.service";

function buildPrisma(overrides: { user?: any } = {}) {
  const hasUserOverride = Object.prototype.hasOwnProperty.call(overrides, "user");
  const user = hasUserOverride
    ? overrides.user
    : {
        id: "u-1",
        phone: "919876543210",
        whatsappNumber: null,
        notificationPreference: { whatsappOptIn: true },
      };

  return {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
    },
    notificationDeliveryLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}


function buildConfig(enabled: boolean): WhatsAppAlertConfigService {
  const config = new WhatsAppAlertConfigService();
  vi.spyOn(config, "isEnabled").mockReturnValue(enabled);
  return config;
}

describe("WhatsAppAlertService", () => {
  let provider: { sendTemplateMessage: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    provider = { sendTemplateMessage: vi.fn().mockResolvedValue({ success: true, providerMessageId: "SM-1" }) };
  });

  it("does not attempt any provider call when WHATSAPP_ENABLED is false", async () => {
    const prisma = buildPrisma();
    const config = buildConfig(false);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await service.sendOrderStatusUpdate({ userId: "u-1", orderId: "order-1", status: "SHIPPED" });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(provider.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("does not attempt a provider call when the user has not opted in", async () => {
    const prisma = buildPrisma({
      user: { id: "u-1", phone: "919876543210", whatsappNumber: null, notificationPreference: { whatsappOptIn: false } },
    });
    const config = buildConfig(true);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await service.sendOrderStatusUpdate({ userId: "u-1", orderId: "order-1", status: "SHIPPED" });

    expect(provider.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("does not attempt a provider call when the user has no notificationPreference row at all", async () => {
    const prisma = buildPrisma({
      user: { id: "u-1", phone: "919876543210", whatsappNumber: null, notificationPreference: null },
    });
    const config = buildConfig(true);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await service.sendWatchlistPriceHit({
      userId: "u-1",
      productId: "prod-1",
      productName: "Cement OPC",
      currentPrice: "100",
      targetPrice: "110",
    });

    expect(provider.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it("sends via the provider and records a delivery log when enabled + opted-in", async () => {
    const prisma = buildPrisma();
    const config = buildConfig(true);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await service.sendRfqQuoteReceived({
      userId: "u-1",
      enquiryId: "enq-1",
      supplierName: "Supplier One",
      bestPriceTotal: "1200",
    });

    expect(provider.sendTemplateMessage).toHaveBeenCalledWith("919876543210", "rfq_quote_received", {
      enquiryId: "enq-1",
      supplierName: "Supplier One",
      bestPriceTotal: "1200",
    });
    expect(prisma.notificationDeliveryLog.create).toHaveBeenCalledTimes(1);
  });

  it("never throws when the provider call itself fails, and still records the failed attempt", async () => {
    provider.sendTemplateMessage.mockResolvedValueOnce({ success: false, error: "boom" });
    const prisma = buildPrisma();
    const config = buildConfig(true);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await expect(
      service.sendOrderStatusUpdate({ userId: "u-1", orderId: "order-1", status: "SHIPPED" })
    ).resolves.toBeUndefined();

    expect(prisma.notificationDeliveryLog.create).toHaveBeenCalledTimes(1);
  });

  it("never throws even when the provider call rejects unexpectedly", async () => {
    provider.sendTemplateMessage.mockRejectedValueOnce(new Error("network down"));
    const prisma = buildPrisma();
    const config = buildConfig(true);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await expect(
      service.sendOrderStatusUpdate({ userId: "u-1", orderId: "order-1", status: "SHIPPED" })
    ).resolves.toBeUndefined();
  });

  it("never throws even when the delivery-log write itself fails", async () => {
    const prisma = buildPrisma();
    prisma.notificationDeliveryLog.create.mockRejectedValueOnce(new Error("db down"));
    const config = buildConfig(true);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await expect(
      service.sendOrderStatusUpdate({ userId: "u-1", orderId: "order-1", status: "SHIPPED" })
    ).resolves.toBeUndefined();
  });

  it("does nothing (no crash) when the user cannot be found", async () => {
    const prisma = buildPrisma({ user: null });
    const config = buildConfig(true);
    const service = new WhatsAppAlertService(prisma as any, config, provider as any);

    await service.sendOrderStatusUpdate({ userId: "missing", orderId: "order-1", status: "SHIPPED" });

    expect(provider.sendTemplateMessage).not.toHaveBeenCalled();
  });
});
