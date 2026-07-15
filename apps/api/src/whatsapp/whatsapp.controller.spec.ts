import { createHmac } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpStatus, RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { WhatsAppController } from "./whatsapp.controller";

/**
 * Fixture-based tests for the WhatsApp webhook controller, using JSON shapes matching
 * Meta's documented WhatsApp Cloud API webhook payloads
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components). No
 * live calls are made — `fetch`/Graph API isn't touched by this controller at all.
 */

const APP_SECRET = "test-app-secret";

function signBody(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function makeInboundMessagePayload(messageId: string, phone: string, text: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: "123456789012345" },
              messages: [
                {
                  id: messageId,
                  from: phone,
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function makeStatusPayload(messageId: string, status: "sent" | "delivered" | "read" | "failed", recipient: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: "123456789012345" },
              statuses: [
                {
                  id: messageId,
                  status,
                  timestamp: "1700000001",
                  recipient_id: recipient,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function makeMockResponse(): Response {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

function makeReq(body: unknown): RawBodyRequest<Request> {
  const rawBody = Buffer.from(JSON.stringify(body));
  return { body, rawBody } as unknown as RawBodyRequest<Request>;
}

describe("WhatsAppController", () => {
  let controller: WhatsAppController;
  let router: { handleInboundMessage: ReturnType<typeof vi.fn> };
  let sessionService: { withIdempotency: ReturnType<typeof vi.fn> };
  let auditHelper: { recordDeliveryStatus: ReturnType<typeof vi.fn>; recordEscalation: ReturnType<typeof vi.fn> };
  let sendAdapter: { send: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = "verify-me";

    router = { handleInboundMessage: vi.fn().mockResolvedValue({ kind: "text", text: "ok" }) };
    sessionService = {
      withIdempotency: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
    };
    auditHelper = {
      recordDeliveryStatus: vi.fn().mockResolvedValue(undefined),
      recordEscalation: vi.fn().mockResolvedValue(undefined),
    };
    sendAdapter = {
      send: vi.fn().mockResolvedValue({ externalId: "mock-id", provider: "mock" }),
    };

    controller = new WhatsAppController(router as any, sessionService as any, auditHelper as any, sendAdapter as any);
  });


  describe("GET verify (webhook handshake)", () => {
    it("returns the hub.challenge with 200 when the verify token matches", () => {
      const res = makeMockResponse();
      controller.verify("subscribe", "verify-me", "1234567890", res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.send).toHaveBeenCalledWith("1234567890");
    });

    it("returns 403 when the verify token does not match", () => {
      const res = makeMockResponse();
      controller.verify("subscribe", "wrong-token", "1234567890", res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(res.send).toHaveBeenCalledWith("verification_failed");
    });

    it("returns 403 when hub.mode is not subscribe", () => {
      const res = makeMockResponse();
      controller.verify("unsubscribe", "verify-me", "1234567890", res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    });
  });

  describe("POST receive — signature verification", () => {
    it("accepts a webhook POST with a valid X-Hub-Signature-256 signature", async () => {
      const payload = makeInboundMessagePayload("wamid.ABC123", "919876543210", "MENU");
      const req = makeReq(payload);
      const signature = signBody(req.rawBody!, APP_SECRET);
      const res = makeMockResponse();

      await controller.receive(req, signature, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      expect(router.handleInboundMessage).toHaveBeenCalledWith("919876543210", "MENU");
    });

    it("rejects a webhook POST with an invalid signature with 401", async () => {
      const payload = makeInboundMessagePayload("wamid.ABC123", "919876543210", "MENU");
      const req = makeReq(payload);
      const res = makeMockResponse();

      await controller.receive(req, "sha256=deadbeef", res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
      expect(router.handleInboundMessage).not.toHaveBeenCalled();
    });

    it("rejects a webhook POST with a missing signature header when a secret is configured", async () => {
      const payload = makeInboundMessagePayload("wamid.ABC123", "919876543210", "MENU");
      const req = makeReq(payload);
      const res = makeMockResponse();

      await controller.receive(req, undefined, res);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      expect(router.handleInboundMessage).not.toHaveBeenCalled();
    });
  });

  describe("POST receive — delivery status webhooks", () => {
    it("records a delivered status event via the audit helper and acks 200 with no inbound reply", async () => {
      const payload = makeStatusPayload("wamid.STATUS1", "delivered", "919876543210");
      const req = makeReq(payload);
      const signature = signBody(req.rawBody!, APP_SECRET);
      const res = makeMockResponse();

      await controller.receive(req, signature, res);

      expect(auditHelper.recordDeliveryStatus).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "wamid.STATUS1", status: "delivered", recipientPhone: "919876543210" })
      );
      expect(router.handleInboundMessage).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    it("records failed delivery status events too", async () => {
      const payload = makeStatusPayload("wamid.STATUS2", "failed", "919876543210");
      const req = makeReq(payload);
      const signature = signBody(req.rawBody!, APP_SECRET);
      const res = makeMockResponse();

      await controller.receive(req, signature, res);

      expect(auditHelper.recordDeliveryStatus).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: "wamid.STATUS2", status: "failed" })
      );
    });
  });

  describe("POST receive — duplicate webhook delivery idempotency", () => {
    it("only invokes the router once for two webhook deliveries carrying the same Meta message id", async () => {
      const payload = makeInboundMessagePayload("wamid.DUPLICATE1", "919876543210", "1");
      const req1 = makeReq(payload);
      const signature1 = signBody(req1.rawBody!, APP_SECRET);
      const res1 = makeMockResponse();

      // Real idempotency cache behavior: emulate WhatsAppSessionService.withIdempotency
      // caching the first result and returning it (without re-invoking fn) on a second
      // call with the same key.
      const cache = new Map<string, unknown>();
      sessionService.withIdempotency.mockImplementation(async (key: string, fn: () => Promise<unknown>) => {
        if (cache.has(key)) return cache.get(key);
        const result = await fn();
        cache.set(key, result);
        return result;
      });

      await controller.receive(req1, signature1, res1);

      // Meta re-delivers the identical webhook payload (same message id) after not
      // receiving/processing our ack in time.
      const req2 = makeReq(payload);
      const signature2 = signBody(req2.rawBody!, APP_SECRET);
      const res2 = makeMockResponse();

      await controller.receive(req2, signature2, res2);

      expect(router.handleInboundMessage).toHaveBeenCalledTimes(1);
      expect(sessionService.withIdempotency).toHaveBeenCalledTimes(2);
      expect(res1.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(res2.status).toHaveBeenCalledWith(HttpStatus.OK);
    });
  });
});
