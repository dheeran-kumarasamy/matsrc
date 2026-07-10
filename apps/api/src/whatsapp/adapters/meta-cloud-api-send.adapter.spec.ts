import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaCloudApiSendAdapter } from "./meta-cloud-api-send.adapter";
import { BotMessage } from "../whatsapp.types";

/**
 * Fixture-based tests for the Meta Cloud API send adapter, mirroring the documented
 * WhatsApp Cloud API `/messages` request/response shapes
 * (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages).
 * `fetch` is mocked — no live calls are made.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as unknown as Response;
}

const GRAPH_SUCCESS_FIXTURE = {
  messaging_product: "whatsapp",
  contacts: [{ input: "919876543210", wa_id: "919876543210" }],
  messages: [{ id: "wamid.HBgLOTE5ODc2NTQzMjEwFQIAERgSNzZBRjFENUE4RUY4RUY4RUY4AA==" }],
};

const GRAPH_ERROR_REENGAGEMENT_FIXTURE = {
  error: {
    message: "(#131047) Re-engagement message",
    type: "OAuthException",
    code: 131047,
    error_subcode: 2494055,
    fbtrace_id: "AbCdEfGhIjK",
  },
};

const GRAPH_ERROR_PACING_FIXTURE = {
  error: {
    message: "(#131056) Message failed to send because of an error related to pacing.",
    type: "OAuthException",
    code: 131056,
    fbtrace_id: "AbCdEfGhIjK2",
  },
};

const GRAPH_ERROR_SERVER_FIXTURE = {
  error: {
    message: "Internal server error",
    type: "OAuthException",
    code: 1,
    fbtrace_id: "AbCdEfGhIjK3",
  },
};

describe("MetaCloudApiSendAdapter", () => {
  let adapter: MetaCloudApiSendAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789012345";
    process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
    process.env.WHATSAPP_REENGAGEMENT_TEMPLATE = "supplier_reengagement_nudge";

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    adapter = new MetaCloudApiSendAdapter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_REENGAGEMENT_TEMPLATE;
  });

  it("sends a plain text message and returns the Graph message id", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GRAPH_SUCCESS_FIXTURE));

    const message: BotMessage = { kind: "text", text: "Your price update was applied." };
    const result = await adapter.send("919876543210", message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v20.0/123456789012345/messages");
    expect(init.headers.Authorization).toBe("Bearer test-access-token");
    const body = JSON.parse(init.body);
    expect(body.type).toBe("text");
    expect(body.text.body).toBe("Your price update was applied.");
    expect(result).toEqual({
      externalId: GRAPH_SUCCESS_FIXTURE.messages[0].id,
      provider: "meta-whatsapp-cloud-api",
    });
  });

  it("sends an interactive list message with the correct Graph payload shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GRAPH_SUCCESS_FIXTURE));

    const message: BotMessage = {
      kind: "list",
      header: "Matsrc Supplier Bot",
      body: "How can I help you today?",
      rows: [
        { id: "PRICE_UPDATE", title: "1. Update Product Price", description: "Change price of an active listing" },
      ],
    };
    const result = await adapter.send("919876543210", message);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe("interactive");
    expect(body.interactive.type).toBe("list");
    expect(body.interactive.header).toEqual({ type: "text", text: "Matsrc Supplier Bot" });
    expect(body.interactive.action.sections[0].rows[0]).toEqual({
      id: "PRICE_UPDATE",
      title: "1. Update Product Price",
      description: "Change price of an active listing",
    });
    expect(result.externalId).toBe(GRAPH_SUCCESS_FIXTURE.messages[0].id);
  });

  it("sends an interactive reply-buttons message with the correct Graph payload shape", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GRAPH_SUCCESS_FIXTURE));

    const message: BotMessage = {
      kind: "buttons",
      body: "Accept or reject this enquiry?",
      buttons: [
        { id: "ACCEPT", title: "Accept" },
        { id: "REJECT", title: "Reject" },
      ],
    };
    await adapter.send("919876543210", message);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe("interactive");
    expect(body.interactive.type).toBe("button");
    expect(body.interactive.action.buttons).toEqual([
      { type: "reply", reply: { id: "ACCEPT", title: "Accept" } },
      { type: "reply", reply: { id: "REJECT", title: "Reject" } },
    ]);
  });

  it("sends a template message (OTP) with code-copy component params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(GRAPH_SUCCESS_FIXTURE));

    const message: BotMessage = {
      kind: "template",
      name: "supplier_otp_verification",
      languageCode: "en",
      components: [
        { type: "body", parameters: [{ type: "text", text: "482913" }] },
        { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: "482913" }] },
      ],
    };
    const result = await adapter.send("919876543210", message);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.type).toBe("template");
    expect(body.template.name).toBe("supplier_otp_verification");
    expect(body.template.language).toEqual({ code: "en" });
    expect(body.template.components[0]).toEqual({
      type: "body",
      parameters: [{ type: "text", text: "482913" }],
    });
    expect(result.externalId).toBe(GRAPH_SUCCESS_FIXTURE.messages[0].id);
  });

  it("falls back to the re-engagement template when Meta returns error code 131047", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(GRAPH_ERROR_REENGAGEMENT_FIXTURE, 400))
      .mockResolvedValueOnce(jsonResponse(GRAPH_SUCCESS_FIXTURE));

    const message: BotMessage = { kind: "text", text: "Your order has shipped." };
    const result = await adapter.send("919876543210", message);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fallbackBody.type).toBe("template");
    expect(fallbackBody.template.name).toBe("supplier_reengagement_nudge");
    expect(result.externalId).toBe(GRAPH_SUCCESS_FIXTURE.messages[0].id);
  });

  it("retries with backoff on error code 131056 (pacing/rate limit) and eventually succeeds", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(GRAPH_ERROR_PACING_FIXTURE, 400))
      .mockResolvedValueOnce(jsonResponse(GRAPH_SUCCESS_FIXTURE));

    const message: BotMessage = { kind: "text", text: "Hello" };
    const sendPromise = adapter.send("919876543210", message);

    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.externalId).toBe(GRAPH_SUCCESS_FIXTURE.messages[0].id);
    vi.useRealTimers();
  });

  it("retries on transport-level 5xx failures and eventually succeeds", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(GRAPH_ERROR_SERVER_FIXTURE, 500))
      .mockResolvedValueOnce(jsonResponse(GRAPH_SUCCESS_FIXTURE));

    const message: BotMessage = { kind: "text", text: "Hello" };
    const sendPromise = adapter.send("919876543210", message);

    await vi.runAllTimersAsync();
    const result = await sendPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.externalId).toBe(GRAPH_SUCCESS_FIXTURE.messages[0].id);
    vi.useRealTimers();
  });

  it("throws after exhausting retries on persistent 5xx failures", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(jsonResponse(GRAPH_ERROR_SERVER_FIXTURE, 500));

    const message: BotMessage = { kind: "text", text: "Hello" };
    const sendPromise = adapter.send("919876543210", message);
    // Attach a rejection handler immediately so the unresolved promise doesn't trigger
    // an unhandled-rejection warning while fake timers are advanced below.
    const assertion = expect(sendPromise).rejects.toThrow(/WhatsApp Cloud API send failed/);

    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });
});
