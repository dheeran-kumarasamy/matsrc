import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { TwilioWhatsAppController } from "./twilio-whatsapp.controller";

/**
 * Fixture-based tests for the Twilio inbound-webhook controller, mirroring
 * `whatsapp.controller.spec.ts`'s style but using Twilio's form-encoded field names
 * (`From`/`Body`/`MessageSid`/`WaId`) instead of Meta's nested JSON shape.
 */

function makeMockResponse(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

describe("TwilioWhatsAppController", () => {
  let controller: TwilioWhatsAppController;
  let router: { handleInboundMessage: ReturnType<typeof vi.fn> };
  let sessionService: { withIdempotency: ReturnType<typeof vi.fn> };
  let auditHelper: { recordDeliveryStatus: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    delete process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE;

    router = { handleInboundMessage: vi.fn().mockResolvedValue({ kind: "text", text: "ok" }) };
    sessionService = {
      withIdempotency: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
    };
    auditHelper = {
      recordDeliveryStatus: vi.fn().mockResolvedValue(undefined),
    };

    controller = new TwilioWhatsAppController(router as any, sessionService as any, auditHelper as any);
  });

  describe("POST messages — inbound message handling", () => {
    it("routes an inbound message using the normalized (whatsapp: prefix stripped) From number", async () => {
      const res = makeMockResponse();

      await controller.receiveMessage(
        { MessageSid: "SM123", From: "whatsapp:+919876543210", Body: "MENU" },
        undefined,
        res
      );

      expect(router.handleInboundMessage).toHaveBeenCalledWith("+919876543210", "MENU");
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    it("falls back to WaId when From is missing", async () => {
      const res = makeMockResponse();

      await controller.receiveMessage({ MessageSid: "SM124", WaId: "919876543210", Body: "1" }, undefined, res);

      expect(router.handleInboundMessage).toHaveBeenCalledWith("919876543210", "1");
    });

    it("uses ButtonText over Body when the sender tapped a Quick Reply button", async () => {
      const res = makeMockResponse();

      await controller.receiveMessage(
        { MessageSid: "SM125", From: "whatsapp:+919876543210", Body: "ignored", ButtonText: "confirm" },
        undefined,
        res
      );

      expect(router.handleInboundMessage).toHaveBeenCalledWith("+919876543210", "confirm");
    });

    it("acks with ok:false and does not call the router when the phone number is missing", async () => {
      const res = makeMockResponse();

      await controller.receiveMessage({ MessageSid: "SM126", Body: "hi" }, undefined, res);

      expect(router.handleInboundMessage).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    });

    it("dedupes duplicate webhook deliveries carrying the same Twilio MessageSid", async () => {
      const cache = new Map<string, unknown>();
      sessionService.withIdempotency.mockImplementation(async (key: string, fn: () => Promise<unknown>) => {
        if (cache.has(key)) return cache.get(key);
        const result = await fn();
        cache.set(key, result);
        return result;
      });

      const res1 = makeMockResponse();
      await controller.receiveMessage({ MessageSid: "SM-DUP", From: "whatsapp:+919876543210", Body: "1" }, undefined, res1);

      const res2 = makeMockResponse();
      await controller.receiveMessage({ MessageSid: "SM-DUP", From: "whatsapp:+919876543210", Body: "1" }, undefined, res2);

      expect(router.handleInboundMessage).toHaveBeenCalledTimes(1);
      expect(sessionService.withIdempotency).toHaveBeenCalledTimes(2);
    });

    it("rejects with 401 when signature validation is enabled but no signature/auth-token is present", async () => {
      process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE = "true";
      process.env.TWILIO_AUTH_TOKEN = "test-token";
      const res = makeMockResponse();

      await controller.receiveMessage({ MessageSid: "SM127", From: "whatsapp:+919876543210", Body: "hi" }, undefined, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(router.handleInboundMessage).not.toHaveBeenCalled();

      delete process.env.TWILIO_WEBHOOK_VALIDATE_SIGNATURE;
      delete process.env.TWILIO_AUTH_TOKEN;
    });
  });

  describe("POST status — delivery status callbacks", () => {
    it("records a delivered status event via the audit helper and acks 200", async () => {
      const res = makeMockResponse();

      await controller.receiveStatus({ MessageSid: "SM200", MessageStatus: "delivered", To: "whatsapp:+919876543210" }, res);

      expect(auditHelper.recordDeliveryStatus).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "SM200", status: "delivered", recipientPhone: "+919876543210" })
      );
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it("records failed delivery status events with the error code", async () => {
      const res = makeMockResponse();

      await controller.receiveStatus(
        { MessageSid: "SM201", MessageStatus: "failed", To: "whatsapp:+919876543210", ErrorCode: "63016" },
        res
      );

      expect(auditHelper.recordDeliveryStatus).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "SM201", status: "failed", errors: "63016" })
      );
    });

    it("does not call the audit helper when required fields are missing, but still acks 200", async () => {
      const res = makeMockResponse();

      await controller.receiveStatus({}, res);

      expect(auditHelper.recordDeliveryStatus).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
    });
  });
});
