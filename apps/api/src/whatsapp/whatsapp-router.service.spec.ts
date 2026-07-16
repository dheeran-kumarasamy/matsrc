import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppRouterService } from "./whatsapp-router.service";
import { WhatsAppSession } from "./whatsapp.types";

/**
 * Unit tests for `WhatsAppRouterService`'s main-menu rendering and dispatch, covering
 * the WhatsApp Interactive List Message upgrade:
 *  - the rendered main menu has no duplicate/manual numbering baked into row titles
 *    (WhatsApp lists are already visually ordered by the client).
 *  - a tapped list row (arriving as its `id`, e.g. via `interactive.list_reply.id`) and
 *    a numeric free-text reply ("1"-"4") both route to the SAME flow's `.start()` call —
 *    there is only one dispatch path, not two duplicated ones.
 */

function makeSession(overrides: Partial<WhatsAppSession> = {}): WhatsAppSession {
  return {
    phone: "919876543210",
    userId: "user-1",
    email: "supplier@example.com",
    name: "Test Supplier",
    supplierProfileId: "supplier-profile-1",
    language: "en",
    flow: "MAIN",
    step: "MAIN_MENU",
    context: {},
    invalidCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("WhatsAppRouterService", () => {
  let authService: { resolveByVerifiedNumber: ReturnType<typeof vi.fn>; getRegistrationLink: ReturnType<typeof vi.fn> };
  let sessionService: {
    get: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    resetToMainMenu: ReturnType<typeof vi.fn>;
    incrementInvalid: ReturnType<typeof vi.fn>;
    hasExceededRetries: ReturnType<typeof vi.fn>;
  };
  let auditHelper: { recordEscalation: ReturnType<typeof vi.fn> };
  let priceUpdateFlow: { start: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn> };
  let enquiryDecisionFlow: { start: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn> };
  let orderStatusFlow: { start: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn> };
  let dailyReportFlow: { start: ReturnType<typeof vi.fn>; handle: ReturnType<typeof vi.fn> };
  let router: WhatsAppRouterService;
  let session: WhatsAppSession;

  beforeEach(() => {
    session = makeSession();

    authService = {
      resolveByVerifiedNumber: vi.fn().mockResolvedValue({
        userId: "user-1",
        email: "supplier@example.com",
        name: "Test Supplier",
        supplierProfileId: "supplier-profile-1",
        language: "en",
      }),
      getRegistrationLink: vi.fn().mockReturnValue("https://example.com/register"),
    };

    sessionService = {
      get: vi.fn().mockImplementation(() => session),
      create: vi.fn().mockImplementation(() => session),
      update: vi.fn().mockImplementation((_phone, patch) => {
        session = { ...session, ...patch };
        return session;
      }),
      resetToMainMenu: vi.fn(),
      incrementInvalid: vi.fn().mockReturnValue(1),
      hasExceededRetries: vi.fn().mockReturnValue(false),
    };

    auditHelper = { recordEscalation: vi.fn().mockResolvedValue(undefined) };

    priceUpdateFlow = { start: vi.fn().mockResolvedValue({ kind: "text", text: "price-update-start" }), handle: vi.fn() };
    enquiryDecisionFlow = { start: vi.fn().mockResolvedValue({ kind: "text", text: "enquiry-decision-start" }), handle: vi.fn() };
    orderStatusFlow = { start: vi.fn().mockResolvedValue({ kind: "text", text: "order-status-start" }), handle: vi.fn() };
    dailyReportFlow = { start: vi.fn().mockResolvedValue({ kind: "text", text: "daily-report-start" }), handle: vi.fn() };

    router = new WhatsAppRouterService(
      authService as any,
      sessionService as any,
      auditHelper as any,
      priceUpdateFlow as any,
      enquiryDecisionFlow as any,
      orderStatusFlow as any,
      dailyReportFlow as any
    );
  });

  it("renders the main menu as a native Interactive List Message with no duplicate/manual numbering in row titles", async () => {
    // No existing session -> triggers authenticate() + mainMenuMessage().
    sessionService.get.mockReturnValueOnce(undefined);

    const reply = await router.handleInboundMessage("919876543210", "MENU");

    expect(reply.kind).toBe("list");
    if (reply.kind !== "list") throw new Error("expected list message");

    expect(reply.rows).toHaveLength(4);
    for (const row of reply.rows) {
      // Row titles must NOT carry a manual leading number like "1. " — WhatsApp list
      // rows are already visually numbered/ordered by the client itself.
      expect(row.title).not.toMatch(/^\d+\.\s/);
    }
    expect(reply.buttonLabel).toBe("View Options");
  });

  const mainMenuCases: Array<{ rowId: string; numeric: string; flowName: string; getFlow: () => { start: ReturnType<typeof vi.fn> } }> = [
    { rowId: "PRICE_UPDATE", numeric: "1", flowName: "priceUpdateFlow", getFlow: () => priceUpdateFlow },
    { rowId: "ENQUIRY_DECISION", numeric: "2", flowName: "enquiryDecisionFlow", getFlow: () => enquiryDecisionFlow },
    { rowId: "ORDER_STATUS", numeric: "3", flowName: "orderStatusFlow", getFlow: () => orderStatusFlow },
    { rowId: "DAILY_REPORT", numeric: "4", flowName: "dailyReportFlow", getFlow: () => dailyReportFlow },
  ];

  for (const { rowId, numeric, flowName } of mainMenuCases) {
    it(`routes both a tapped list row ("${rowId}") and the numeric free-text reply ("${numeric}") to the same ${flowName}.start()`, async () => {
      session = makeSession({ flow: "MAIN" });

      await router.handleInboundMessage("919876543210", rowId);
      const flow = mainMenuCases.find((c) => c.rowId === rowId)!.getFlow();
      expect(flow.start).toHaveBeenCalledTimes(1);

      // Reset session back to MAIN (as it would be after a fresh MENU) and try numeric path.
      session = makeSession({ flow: "MAIN" });
      await router.handleInboundMessage("919876543210", numeric);
      expect(flow.start).toHaveBeenCalledTimes(2);

      // Both invocations were passed the same session object shape (dispatch converges).
      expect(flow.start.mock.calls[0][0]).toMatchObject({ flow: "MAIN" });
      expect(flow.start.mock.calls[1][0]).toMatchObject({ flow: "MAIN" });
    });
  }

  it("returns an invalid-option message for unrecognized main menu input, without touching any flow", async () => {
    session = makeSession({ flow: "MAIN" });

    const reply = await router.handleInboundMessage("919876543210", "not-a-valid-option");

    expect(reply.kind).toBe("text");
    expect(priceUpdateFlow.start).not.toHaveBeenCalled();
    expect(enquiryDecisionFlow.start).not.toHaveBeenCalled();
    expect(orderStatusFlow.start).not.toHaveBeenCalled();
    expect(dailyReportFlow.start).not.toHaveBeenCalled();
  });
});
