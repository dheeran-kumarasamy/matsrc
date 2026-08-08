import { describe, expect, it, vi } from "vitest";
import { NotificationService } from "./notification.service";

describe("NotificationService.notifySupplierOrderSubmitted", () => {
  it("creates supplier WhatsApp notification containing enquiry deep link", async () => {
    const prisma = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: "enquiry-12345678",
          user: { id: "builder-1", name: "Builder One", phone: null },
          totalAmount: 1800,
          items: [
            {
              quantity: 10,
              product: { name: "Cement OPC", unit: "BAG" },
              supplier: {
                companyName: "Supplier One",
                user: { id: "supplier-user-1" },
              },
            },
          ],
        }),
      },
      notification: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      },
      notificationTemplate: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      notificationDeliveryLog: {
        create: vi.fn(),
      },
    };

    const queue = {
      enqueue: vi.fn().mockResolvedValue(true),
    };

    const provider = {
      sendWhatsAppMessage: vi.fn().mockResolvedValue({ externalId: "mock", provider: "mock-whatsapp" }),
    };

    const service = new NotificationService(prisma as any, queue as any, provider as any);
    await service.notifySupplierOrderSubmitted("enquiry-12345678");

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const payload = (prisma.notification.create as any).mock.calls[0][0].data;
    expect(payload.channel).toBe("WHATSAPP");
    expect(payload.audience).toBe("supplier");
    expect(String(payload.body)).toContain("/rfqs?respond=enquiry-12345678");
    expect(payload.status).toBe("queued");
  });
});

describe("NotificationService.notifyWatchlistPriceAlert — idempotency", () => {
  function makePrisma(opts: { existingNotification?: { id: string } | null } = {}) {
    return {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: "builder-1", whatsappNumber: "919876543210", phone: null }),
      },
      notification: {
        findFirst: vi.fn().mockResolvedValue(opts.existingNotification ?? null),
        create: vi.fn().mockResolvedValue({ id: "notif-new" }),
      },
    };
  }

  const baseParams = {
    userId: "builder-1",
    watchlistId: "w1",
    productName: "Cement OPC",
    currentPrice: 90,
    targetPrice: 100,
    districtName: "Chennai",
    confidence: "HIGH",
    method: "OBSERVED",
    methodLabel: "Verified market price",
    idempotencyKey: "watchlist-alert:w1:sku-1:d1:2026-01-10",
  };

  it("returns the existing notification id without creating a duplicate when idempotencyKey already exists", async () => {
    const prisma = makePrisma({ existingNotification: { id: "notif-existing" } });
    const queue = { enqueue: vi.fn() };
    const provider = { sendWhatsAppMessage: vi.fn() };
    const service = new NotificationService(prisma as any, queue as any, provider as any);

    const result = await service.notifyWatchlistPriceAlert(baseParams);

    expect(result).toBe("notif-existing");
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it("creates and enqueues a new notification when no existing idempotencyKey match is found", async () => {
    const prisma = makePrisma({ existingNotification: null });
    const queue = { enqueue: vi.fn().mockResolvedValue(true) };
    const provider = { sendWhatsAppMessage: vi.fn() };
    const service = new NotificationService(prisma as any, queue as any, provider as any);

    const result = await service.notifyWatchlistPriceAlert(baseParams);

    expect(result).toBe("notif-new");
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledWith("watchlist-price-alert", { notificationId: "notif-new" });
  });

  it("returns null without creating a notification when the target user no longer exists", async () => {
    const prisma = makePrisma();
    prisma.user.findUnique = vi.fn().mockResolvedValue(null);
    const queue = { enqueue: vi.fn() };
    const provider = { sendWhatsAppMessage: vi.fn() };
    const service = new NotificationService(prisma as any, queue as any, provider as any);

    const result = await service.notifyWatchlistPriceAlert(baseParams);

    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

