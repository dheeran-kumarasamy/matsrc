import { describe, expect, it, vi, beforeEach } from "vitest";
import { notifyLoginOtpWhatsApp, getLoginOtpWhatsAppMode, LOGIN_OTP_TEMPLATE_NAME } from "./login-otp-whatsapp-notification";

// End-to-end style tests exercising the REAL policy-evaluation and Meta-send
// logic in this module (only Prisma and `fetch` are faked) — this is the
// shared WhatsApp Login OTP sender both apps/web and apps/supplier call
// directly. Mirrors the test structure of payment-required-notification.spec.ts.

const LOGIN_OTP_POLICY = {
  enabled: true,
  templateName: LOGIN_OTP_TEMPLATE_NAME,
  channel: "WHATSAPP",
  priority: "P0",
};

function buildHarness(options: { policyEnabled?: boolean; existingDedupeKeys?: string[] } = {}) {
  const notificationEvents = new Map<string, any>();
  for (const key of options.existingDedupeKeys ?? []) {
    notificationEvents.set(key, { id: "existing" });
  }
  let eventCounter = 0;

  const prisma: any = {
    notificationEventPolicy: {
      findUnique: vi.fn().mockResolvedValue(options.policyEnabled === false ? { ...LOGIN_OTP_POLICY, enabled: false } : LOGIN_OTP_POLICY),
    },
    notificationEvent: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => notificationEvents.get(where.dedupeKey) ?? null),
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        eventCounter += 1;
        const row = { id: `event-${eventCounter}`, ...data };
        if (data.dedupeKey) notificationEvents.set(data.dedupeKey, row);
        return row;
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    whatsAppMessageLog: {
      create: vi.fn().mockImplementation(async ({ data }: any) => ({ id: `log-${eventCounter}`, ...data })),
      update: vi.fn().mockImplementation(async ({ data }: any) => data),
    },
  };

  return { prisma };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  delete process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  vi.unstubAllGlobals();
});

describe("getLoginOtpWhatsAppMode", () => {
  it("defaults to dry-run when unset", () => {
    expect(getLoginOtpWhatsAppMode()).toBe("dry-run");
  });

  it("reads live/off/dry-run case-insensitively, falling back to dry-run for anything else", () => {
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "LIVE";
    expect(getLoginOtpWhatsAppMode()).toBe("live");
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "off";
    expect(getLoginOtpWhatsAppMode()).toBe("off");
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "garbage";
    expect(getLoginOtpWhatsAppMode()).toBe("dry-run");
  });
});

describe("notifyLoginOtpWhatsApp", () => {
  it("creates the event and a WhatsAppMessageLog row, simulates success in dry-run, and never calls fetch", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.whatsAppMessageLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ templateName: LOGIN_OTP_TEMPLATE_NAME }) })
    );
  });

  it("never persists the plaintext OTP in the WhatsAppMessageLog parameters", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";

    await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    const createCall = prisma.whatsAppMessageLog.create.mock.calls[0][0];
    expect(JSON.stringify(createCall.data.parameters)).not.toContain("123456");
  });

  it("calls Meta exactly once with body + button components, both carrying the OTP, in live mode", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.ABC" }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "654321" });

    expect(result.success).toBe(true);
    if (result.success) expect(result.externalId).toBe("wamid.ABC");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchSpy.mock.calls[0];
    const payload = JSON.parse(requestInit.body as string);
    expect(payload.template.name).toBe(LOGIN_OTP_TEMPLATE_NAME);
    expect(payload.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "654321" }] },
      { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: "654321" }] },
    ]);
  });

  it("live mode: missing WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN never crashes and marks status failed", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("live mode: a Meta error response is captured, never thrown, and never claims success", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "SECRET_TOKEN";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Invalid parameter", code: 100 } }),
      })
    );

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(false);
  });

  it("mode 'off' never calls Meta and reports failure (never a fake success)", async () => {
    const { prisma } = buildHarness();
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "off";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("suppresses (and never calls Meta) when the NotificationEventPolicy row is disabled", async () => {
    const { prisma } = buildHarness({ policyEnabled: false });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "live";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "PHONE_ID";
    process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("TEMPLATE_DISABLED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dedupes by challengeId — a retried call for the SAME challenge never double-sends", async () => {
    const { prisma } = buildHarness({ existingDedupeKeys: ["LOGIN_OTP:challenge-1"] });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("DUPLICATE_DEDUPE_KEY");
    expect(prisma.whatsAppMessageLog.create).not.toHaveBeenCalled();
  });

  it("a DIFFERENT challengeId (a legitimate resend) is never suppressed by a prior challenge's dedupe key", async () => {
    const { prisma } = buildHarness({ existingDedupeKeys: ["LOGIN_OTP:challenge-1"] });
    process.env.NOTIFICATION_ENGINE_WHATSAPP_MODE = "dry-run";

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-2", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(true);
  });

  it("never throws, returning a structured failure for an unexpected internal error", async () => {
    const { prisma } = buildHarness();
    prisma.notificationEventPolicy.findUnique.mockRejectedValueOnce(new Error("db down"));

    const result = await notifyLoginOtpWhatsApp(prisma, { challengeId: "challenge-1", phone: "+919000000000", otp: "123456" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe("INTERNAL_ERROR");
  });
});
