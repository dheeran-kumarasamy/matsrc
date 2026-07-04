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
