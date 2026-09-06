import { describe, expect, it, vi } from "vitest";
import { NotificationEngineService } from "./notification-engine.service";

function makePrisma() {
  return {
    notificationEvent: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: "event-1", ...data })),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("NotificationEngineService", () => {
  it("creates a suppressed NotificationEvent and never calls the channel dispatcher when policy denies", async () => {
    const prisma = makePrisma();
    const policy = { evaluate: vi.fn().mockResolvedValue({ allowed: false, reason: "TEMPLATE_DISABLED" }) };
    const whatsAppChannel = { send: vi.fn() };
    const inAppChannel = { send: vi.fn() };

    const service = new NotificationEngineService(prisma as any, policy as any, whatsAppChannel as any, inAppChannel as any);
    const result = await service.dispatch({ eventType: "X", recipientId: "u1", recipientType: "supplier" });

    expect(whatsAppChannel.send).not.toHaveBeenCalled();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("TEMPLATE_DISABLED");
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "suppressed", suppressReason: "TEMPLATE_DISABLED" }) })
    );
  });

  it("dispatches to the WhatsApp channel and marks the event sent on success", async () => {
    const prisma = makePrisma();
    const policy = { evaluate: vi.fn().mockResolvedValue({ allowed: true, templateName: "t1", channel: "WHATSAPP", priority: "P1" }) };
    const whatsAppChannel = { send: vi.fn().mockResolvedValue({ success: true, externalId: "wamid.1" }) };
    const inAppChannel = { send: vi.fn() };

    const service = new NotificationEngineService(prisma as any, policy as any, whatsAppChannel as any, inAppChannel as any);
    const result = await service.dispatch({ eventType: "X", recipientId: "u1", recipientType: "supplier", phone: "919876543210" }, "WHATSAPP");

    expect(whatsAppChannel.send).toHaveBeenCalledOnce();
    expect(result.allowed).toBe(true);
    expect(result.sendResult?.success).toBe(true);
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { status: "sent" } });
  });

  it("marks the event failed when the channel dispatcher reports failure", async () => {
    const prisma = makePrisma();
    const policy = { evaluate: vi.fn().mockResolvedValue({ allowed: true, templateName: "t1", channel: "WHATSAPP", priority: "P1" }) };
    const whatsAppChannel = { send: vi.fn().mockResolvedValue({ success: false, error: "Meta rejected" }) };
    const inAppChannel = { send: vi.fn() };

    const service = new NotificationEngineService(prisma as any, policy as any, whatsAppChannel as any, inAppChannel as any);
    const result = await service.dispatch({ eventType: "X", recipientId: "u1", recipientType: "supplier", phone: "919876543210" }, "WHATSAPP");

    expect(result.sendResult?.success).toBe(false);
    expect(prisma.notificationEvent.update).toHaveBeenCalledWith({ where: { id: "event-1" }, data: { status: "failed" } });
  });

  it("never throws even when the policy service itself throws", async () => {
    const prisma = makePrisma();
    const policy = { evaluate: vi.fn().mockRejectedValue(new Error("DB down")) };
    const whatsAppChannel = { send: vi.fn() };
    const inAppChannel = { send: vi.fn() };

    const service = new NotificationEngineService(prisma as any, policy as any, whatsAppChannel as any, inAppChannel as any);
    const result = await service.dispatch({ eventType: "X", recipientId: "u1", recipientType: "supplier" });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("INTERNAL_ERROR");
  });

  it("resolve() marks matching NotificationEvent rows resolved and never throws on failure", async () => {
    const prisma = makePrisma();
    const policy = { evaluate: vi.fn() };
    const service = new NotificationEngineService(prisma as any, policy as any, {} as any, {} as any);

    await service.resolve("SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:s1:2026-01-01");

    expect(prisma.notificationEvent.updateMany).toHaveBeenCalledWith({
      where: { dedupeKey: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:s1:2026-01-01" },
      data: expect.objectContaining({ status: "resolved" }),
    });
  });
});
