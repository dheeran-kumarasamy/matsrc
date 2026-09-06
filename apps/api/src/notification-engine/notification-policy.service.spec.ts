import { describe, expect, it, vi } from "vitest";
import { NotificationPolicyService } from "./notification-policy.service";

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue(
        overrides.policy !== undefined
          ? overrides.policy
          : {
              id: "policy-1",
              eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
              channel: "WHATSAPP",
              templateName: "supplier_price_update",
              enabled: true,
              priority: "P1",
              maxPerDay: 1,
              cooldownMinutes: null,
              businessHoursOnly: false,
            }
      ),
    },
    notificationGlobalSettings: {
      findUnique: vi.fn().mockResolvedValue(overrides.global ?? { id: "global", whatsappBusinessEnabled: true }),
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(overrides.preference ?? null),
    },
    notificationEvent: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingDedupe ?? null),
      count: vi.fn().mockResolvedValue(overrides.sentTodayCount ?? 0),
      findFirst: vi.fn().mockResolvedValue(overrides.recentSend ?? null),
    },
  };
}

describe("NotificationPolicyService", () => {
  it("denies with TEMPLATE_NOT_FOUND when no policy row exists", async () => {
    const prisma = makePrisma({ policy: null });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({ eventType: "UNKNOWN_EVENT", channel: "WHATSAPP" });

    expect(decision).toEqual({ allowed: false, reason: "TEMPLATE_NOT_FOUND" });
  });

  it("denies with TEMPLATE_DISABLED when the policy is disabled", async () => {
    const prisma = makePrisma({
      policy: { id: "p1", eventType: "X", channel: "WHATSAPP", templateName: "t", enabled: false, priority: "P1", maxPerDay: null, cooldownMinutes: null, businessHoursOnly: false },
    });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({ eventType: "X", channel: "WHATSAPP" });

    expect(decision).toEqual({ allowed: false, reason: "TEMPLATE_DISABLED" });
  });

  it("denies with CHANNEL_DISABLED_GLOBALLY when the global WhatsApp kill-switch is off for a non-mandatory event", async () => {
    const prisma = makePrisma({ global: { id: "global", whatsappBusinessEnabled: false } });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({ eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED", channel: "WHATSAPP" });

    expect(decision).toEqual({ allowed: false, reason: "CHANNEL_DISABLED_GLOBALLY" });
  });

  it("bypasses the global kill-switch for mandatory (authentication) event types", async () => {
    const prisma = makePrisma({
      global: { id: "global", whatsappBusinessEnabled: false },
      policy: { id: "p1", eventType: "PHONE_VERIFICATION_OTP", channel: "WHATSAPP", templateName: "otp_template", enabled: true, priority: "P0", maxPerDay: null, cooldownMinutes: null, businessHoursOnly: false },
    });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({ eventType: "PHONE_VERIFICATION_OTP", channel: "WHATSAPP" });

    expect(decision).toEqual({ allowed: true, templateName: "otp_template", channel: "WHATSAPP", priority: "P0" });
  });

  it("denies with DUPLICATE_DEDUPE_KEY when a NotificationEvent with the same dedupeKey already exists", async () => {
    const prisma = makePrisma({ existingDedupe: { id: "existing-event" } });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({
      eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
      channel: "WHATSAPP",
      dedupeKey: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED:supplier-1:2026-01-01",
    });

    expect(decision).toEqual({ allowed: false, reason: "DUPLICATE_DEDUPE_KEY" });
  });

  it("denies with DAILY_LIMIT_REACHED when maxPerDay has already been reached", async () => {
    const prisma = makePrisma({ sentTodayCount: 1 });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({
      eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
      channel: "WHATSAPP",
      recipientId: "supplier-user-1",
    });

    expect(decision).toEqual({ allowed: false, reason: "DAILY_LIMIT_REACHED" });
  });

  it("denies with COOLDOWN_ACTIVE when a recent send exists within the cooldown window", async () => {
    const prisma = makePrisma({
      policy: { id: "p1", eventType: "X", channel: "WHATSAPP", templateName: "t", enabled: true, priority: "P1", maxPerDay: null, cooldownMinutes: 60, businessHoursOnly: false },
      recentSend: { id: "recent-event" },
    });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({ eventType: "X", channel: "WHATSAPP", recipientId: "u1" });

    expect(decision).toEqual({ allowed: false, reason: "COOLDOWN_ACTIVE" });
  });

  it("denies with USER_OPTED_OUT when the recipient has disabled WhatsApp preferences", async () => {
    const prisma = makePrisma({ preference: { whatsappEnabled: false } });
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({
      eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
      channel: "WHATSAPP",
      recipientId: "supplier-user-1",
    });

    expect(decision).toEqual({ allowed: false, reason: "USER_OPTED_OUT" });
  });

  it("returns an allowed decision with templateName/channel/priority when every check passes", async () => {
    const prisma = makePrisma();
    const service = new NotificationPolicyService(prisma as any);

    const decision = await service.evaluate({
      eventType: "SUPPLIER_DAILY_PRICE_UPDATE_REQUIRED",
      channel: "WHATSAPP",
      recipientId: "supplier-user-1",
    });

    expect(decision).toEqual({ allowed: true, templateName: "supplier_price_update", channel: "WHATSAPP", priority: "P1" });
  });

  describe("Meta template configuration updates (supplier_rfq_reminder / customer_order_status)", () => {
    it("SUPPLIER_RFQ_REMINDER resolves to the new Meta template name supplier_rfq_reminder, not the deleted supplier_quote_reminder", async () => {
      const prisma = makePrisma({
        policy: {
          id: "p-rfq-reminder",
          eventType: "SUPPLIER_RFQ_REMINDER",
          channel: "WHATSAPP",
          templateName: "supplier_rfq_reminder",
          enabled: true,
          priority: "P1",
          maxPerDay: 1,
          cooldownMinutes: 240,
          businessHoursOnly: true,
        },
      });
      const service = new NotificationPolicyService(prisma as any);

      // businessHourWindow covers every hour so this assertion isn't flaky depending on
      // the real wall-clock time the suite happens to run at (the policy is
      // businessHoursOnly:true).
      const decision = await service.evaluate({
        eventType: "SUPPLIER_RFQ_REMINDER",
        channel: "WHATSAPP",
        recipientId: "supplier-user-1",
        businessHourWindow: { startHour: 0, endHour: 24 },
      });

      expect(decision).toEqual({ allowed: true, templateName: "supplier_rfq_reminder", channel: "WHATSAPP", priority: "P1" });
      if (decision.allowed) {
        expect(decision.templateName).not.toBe("supplier_quote_reminder");
      }
    });

    it("ORDER_STATUS_CHANGED (customer_order_status) resolves correctly and is unaffected by the SUPPLIER_RFQ_REMINDER template rename", async () => {
      const prisma = makePrisma({
        policy: {
          id: "p-order-status",
          eventType: "ORDER_STATUS_CHANGED",
          channel: "WHATSAPP",
          templateName: "customer_order_status",
          enabled: true,
          priority: "P1",
          maxPerDay: null,
          cooldownMinutes: null,
          businessHoursOnly: false,
        },
      });
      const service = new NotificationPolicyService(prisma as any);

      const decision = await service.evaluate({ eventType: "ORDER_STATUS_CHANGED", channel: "WHATSAPP", recipientId: "customer-user-1" });

      expect(decision).toEqual({ allowed: true, templateName: "customer_order_status", channel: "WHATSAPP", priority: "P1" });
    });
  });
});
