import { describe, expect, it, vi } from "vitest";
import { WhatsAppWebhookStatusProcessorService } from "./whatsapp-webhook-status-processor.service";

function makePrisma(existingLog: any | null) {
  return {
    whatsAppMessageLog: {
      findUnique: vi.fn().mockResolvedValue(existingLog),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("WhatsAppWebhookStatusProcessorService", () => {
  it("updates WhatsAppMessageLog.status to delivered when a matching metaMessageId is found", async () => {
    const prisma = makePrisma({ id: "log-1", metaMessageId: "wamid.ABC", status: "sent" });
    const service = new WhatsAppWebhookStatusProcessorService(prisma as any);

    await service.processStatuses([{ id: "wamid.ABC", status: "delivered" }]);

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "delivered" },
    });
  });

  it("updates WhatsAppMessageLog.status to read", async () => {
    const prisma = makePrisma({ id: "log-2", metaMessageId: "wamid.DEF", status: "delivered" });
    const service = new WhatsAppWebhookStatusProcessorService(prisma as any);

    await service.processStatuses([{ id: "wamid.DEF", status: "read" }]);

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith({
      where: { id: "log-2" },
      data: { status: "read" },
    });
  });

  it("updates WhatsAppMessageLog.status to failed and stores error details", async () => {
    const prisma = makePrisma({ id: "log-3", metaMessageId: "wamid.GHI", status: "sent" });
    const service = new WhatsAppWebhookStatusProcessorService(prisma as any);

    await service.processStatuses([{ id: "wamid.GHI", status: "failed", errors: [{ code: 131047, title: "Re-engagement" }] }]);

    expect(prisma.whatsAppMessageLog.update).toHaveBeenCalledWith({
      where: { id: "log-3" },
      data: { status: "failed", errorDetails: expect.stringContaining("131047") },
    });
  });

  it("never throws and does not update anything for an unknown Meta message id", async () => {
    const prisma = makePrisma(null);
    const service = new WhatsAppWebhookStatusProcessorService(prisma as any);

    await expect(service.processStatuses([{ id: "wamid.UNKNOWN", status: "sent" }])).resolves.toBeUndefined();
    expect(prisma.whatsAppMessageLog.update).not.toHaveBeenCalled();
  });

  it("never throws even when the prisma update call itself fails", async () => {
    const prisma = makePrisma({ id: "log-4", metaMessageId: "wamid.JKL", status: "sent" });
    prisma.whatsAppMessageLog.update = vi.fn().mockRejectedValue(new Error("DB down"));
    const service = new WhatsAppWebhookStatusProcessorService(prisma as any);

    await expect(service.processStatuses([{ id: "wamid.JKL", status: "delivered" }])).resolves.toBeUndefined();
  });
});
