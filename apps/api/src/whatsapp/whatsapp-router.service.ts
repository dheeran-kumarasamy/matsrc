import { Injectable, Logger } from "@nestjs/common";
import { WhatsAppAuthService } from "./whatsapp-auth.service";
import { WhatsAppSessionService } from "./whatsapp-session.service";
import { WhatsAppAuditHelper } from "./whatsapp-audit.helper";
import { PriceUpdateFlow } from "./flows/price-update.flow";
import { EnquiryDecisionFlow } from "./flows/enquiry-decision.flow";
import { OrderStatusFlow } from "./flows/order-status.flow";
import { DailyReportFlow } from "./flows/daily-report.flow";

import {
  BotMessage,
  GLOBAL_RESET_KEYWORDS,
  HUMAN_HANDOFF_KEYWORDS,
  MainFlow,
  MENU_FOOTER,
  WhatsAppSession,
} from "./whatsapp.types";

const MAIN_MENU_ROWS: Array<{ id: MainFlow; title: string; description: string }> = [
  { id: "PRICE_UPDATE", title: "1. Update Product Price", description: "Change price of an active listing" },
  { id: "ENQUIRY_DECISION", title: "2. Accept/Reject Enquiry", description: "Action pending buyer enquiries" },
  { id: "ORDER_STATUS", title: "3. Order Status", description: "View orders & confirm delivery" },
  { id: "DAILY_REPORT", title: "4. Daily Report", description: "See your performance numbers" },
];

/**
 * Top-level message router for the Supplier WhatsApp bot (spec §3 — Main menu &
 * navigation rules).
 *
 * Responsibilities:
 *  - Auth gate: verified-number lookup before granting any menu access.
 *  - Global keyword interception (MENU/HI/HELLO/START resets to main menu; AGENT/HELP
 *    hands off to a human agent) — takes priority over whatever flow/step the session is
 *    currently in, per spec.
 *  - Main-menu dispatch to the 4 flow classes.
 *  - 3-strikes-invalid escalation to human handoff (delegates to session service's
 *    invalid-attempt counter, which each flow also increments on its own invalid input).
 */
@Injectable()
export class WhatsAppRouterService {
  private readonly logger = new Logger(WhatsAppRouterService.name);

  constructor(
    private readonly authService: WhatsAppAuthService,
    private readonly sessionService: WhatsAppSessionService,
    private readonly auditHelper: WhatsAppAuditHelper,
    private readonly priceUpdateFlow: PriceUpdateFlow,
    private readonly enquiryDecisionFlow: EnquiryDecisionFlow,
    private readonly orderStatusFlow: OrderStatusFlow,
    private readonly dailyReportFlow: DailyReportFlow
  ) {}

  async handleInboundMessage(phone: string, rawText: string): Promise<BotMessage> {
    const text = (rawText ?? "").trim();
    const upper = text.toUpperCase();

    if (HUMAN_HANDOFF_KEYWORDS.has(upper)) {
      const session = this.sessionService.get(phone);
      if (session) this.sessionService.update(phone, { flow: "HUMAN_HANDOFF", step: "WAITING_FOR_AGENT" });
      await this.recordEscalation(session, phone, text);
      return this.humanHandoffMessage();
    }


    let session = this.sessionService.get(phone);

    if (GLOBAL_RESET_KEYWORDS.has(upper)) {
      if (session) {
        this.sessionService.resetToMainMenu(phone);
      } else {
        session = await this.authenticate(phone);
        if (!session) return this.registrationRequiredMessage();
      }
      return this.mainMenuMessage();
    }

    if (!session) {
      session = await this.authenticate(phone);
      if (!session) return this.registrationRequiredMessage();
      return this.mainMenuMessage();
    }

    if (session.flow === "HUMAN_HANDOFF") {
      // Once a human agent has taken over, the bot stays silent except for the global
      // reset keywords handled above, so it doesn't talk over the agent.
      return { kind: "text", text: "An agent has been notified and will assist you shortly. Reply MENU to return to the automated menu." };
    }

    if (session.flow === "MAIN") {
      return this.handleMainMenuSelection(session, text);
    }

    const flow = this.resolveFlow(session.flow);
    const reply = await flow.handle(session, text);

    if (this.sessionService.hasExceededRetries(phone)) {
      this.sessionService.update(phone, { flow: "HUMAN_HANDOFF", step: "WAITING_FOR_AGENT", invalidCount: 0 });
      await this.recordEscalation(session, phone, text);
      return this.humanHandoffMessage();
    }

    return reply;
  }

  private async handleMainMenuSelection(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const choice = this.matchMainMenuChoice(text);
    if (!choice) {
      const invalidCount = this.sessionService.incrementInvalid(session.phone);
      if (invalidCount >= 3) {
        this.sessionService.update(session.phone, { flow: "HUMAN_HANDOFF", step: "WAITING_FOR_AGENT", invalidCount: 0 });
        await this.recordEscalation(session, session.phone, text);
        return this.humanHandoffMessage();
      }
      return { kind: "text", text: "Please select a valid option from the menu, or reply MENU to see it again." };
    }

    return this.resolveFlow(choice).start(session);
  }

  /**
   * Persists an AGENT/HELP (or 3-strikes) human-handoff escalation into the existing
   * `AuditLog` table (via `WhatsAppAuditHelper.recordEscalation`) so ops staff can see it
   * from the Admin portal's "WhatsApp Escalations" list — reusing the same
   * access-control pattern as `admin/disputes` rather than building a new inbox UI.
   */
  private async recordEscalation(session: WhatsAppSession | undefined, phone: string, lastMessage: string): Promise<void> {
    try {
      await this.auditHelper.recordEscalation({
        actorId: session?.userId ?? "system",
        phone,
        lastMessage,
      });
    } catch (error) {
      this.logger.error(`Failed to record WhatsApp escalation for ${phone}`, error as Error);
    }
  }


  private matchMainMenuChoice(text: string): MainFlow | null {
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();

    const byId = MAIN_MENU_ROWS.find((row) => row.id === upper);
    if (byId) return byId.id;

    if (trimmed === "1") return "PRICE_UPDATE";
    if (trimmed === "2") return "ENQUIRY_DECISION";
    if (trimmed === "3") return "ORDER_STATUS";
    if (trimmed === "4") return "DAILY_REPORT";

    return null;
  }

  private resolveFlow(flow: MainFlow) {
    switch (flow) {
      case "PRICE_UPDATE":
        return this.priceUpdateFlow;
      case "ENQUIRY_DECISION":
        return this.enquiryDecisionFlow;
      case "ORDER_STATUS":
        return this.orderStatusFlow;
      case "DAILY_REPORT":
        return this.dailyReportFlow;
      default:
        throw new Error(`No flow handler registered for "${flow}"`);
    }
  }

  private async authenticate(phone: string): Promise<WhatsAppSession | undefined> {
    const identity = await this.authService.resolveByVerifiedNumber(phone);
    if (!identity) return undefined;

    return this.sessionService.create({
      phone,
      userId: identity.userId,
      email: identity.email,
      name: identity.name,
      supplierProfileId: identity.supplierProfileId,
      language: identity.language,
    });
  }

  private mainMenuMessage(): BotMessage {
    return {
      kind: "list",
      header: "Matsrc Supplier Bot",
      body: "How can I help you today?",
      rows: MAIN_MENU_ROWS.map((row) => ({ id: row.id, title: row.title, description: row.description })),
    };
  }

  private registrationRequiredMessage(): BotMessage {
    return {
      kind: "text",
      text: `We couldn't find a Matsrc supplier account linked to this WhatsApp number.\nRegister or update your contact number here: ${this.authService.getRegistrationLink()}`,
    };
  }

  private humanHandoffMessage(): BotMessage {
    return {
      kind: "text",
      text: `You're being connected to a human agent — they'll respond here shortly.\n\n${MENU_FOOTER}`,
    };
  }
}
