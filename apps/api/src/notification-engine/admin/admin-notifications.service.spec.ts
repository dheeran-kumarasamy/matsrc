import { describe, expect, it, vi } from "vitest";
import { AdminNotificationsService } from "./admin-notifications.service";
import { WhatsAppEngineConfigService } from "../whatsapp/whatsapp-engine-config.service";

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    notificationEventPolicy: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(
        overrides.existingPolicy !== undefined
          ? overrides.existingPolicy
          : { id: "p1", eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED", channel: "WHATSAPP", enabled: true }
      ),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "p1", enabled: true, ...data })),
    },
    notificationGlobalSettings: {
      upsert: vi.fn().mockResolvedValue({ id: "global", whatsappBusinessEnabled: true }),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "global", ...data })),
    },
    notificationPolicyAudit: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("AdminNotificationsService", () => {
  it("updatePolicy writes a NotificationPolicyAudit row with old/new value, actor, and reason", async () => {
    const prisma = makePrisma();
    const config = new WhatsAppEngineConfigService();
    const service = new AdminNotificationsService(prisma as any, config);

    await service.updatePolicy("p1", { enabled: false, reason: "Temporary business decision" }, "admin-1");

    expect(prisma.notificationPolicyAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          policyId: "p1",
          action: "UPDATE_POLICY",
          reason: "Temporary business decision",
          changedBy: "admin-1",
        }),
      })
    );
  });

  it("updatePolicy throws NotFoundException when the policy id does not exist", async () => {
    const prisma = makePrisma({ existingPolicy: null });
    const config = new WhatsAppEngineConfigService();
    const service = new AdminNotificationsService(prisma as any, config);

    await expect(service.updatePolicy("missing", { enabled: false }, "admin-1")).rejects.toThrow();
  });

  it("updateGlobalWhatsAppSettings records a GLOBAL_WHATSAPP_DISABLED audit action when turning the switch off", async () => {
    const prisma = makePrisma();
    const config = new WhatsAppEngineConfigService();
    const service = new AdminNotificationsService(prisma as any, config);

    await service.updateGlobalWhatsAppSettings({ whatsappBusinessEnabled: false, reason: "Ops decision" }, "admin-1");

    expect(prisma.notificationPolicyAudit.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "GLOBAL_WHATSAPP_DISABLED", changedBy: "admin-1" }) })
    );
  });
});
