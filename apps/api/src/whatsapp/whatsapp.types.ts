/**
 * Shared types for the Supplier WhatsApp bot module.
 *
 * The bot is a new client on top of existing supplier APIs (listings, rfqs/enquiries,
 * orders). No new source of truth is introduced — session state lives here in-memory
 * (server-side, keyed by phone number) and every mutating action still goes through the
 * existing Prisma-backed services so Admin/Supplier portals never drift from what the
 * bot does.
 */

export type BotListRow = {
  id: string;
  title: string;
  description?: string;
};

export type BotButton = {
  id: string;
  title: string;
};

export type BotTemplateComponent = {
  type: "header" | "body" | "button";
  sub_type?: "url" | "quick_reply";
  index?: number;
  parameters: Array<
    | { type: "text"; text: string }
    | { type: "payload"; payload: string }
    // Document-header parameter (Meta template "document" header type) — used by
    // lifecycle notifications that attach a PDF (e.g. builder_po_issued,
    // supplier_invoice_generated). `link` must be a publicly reachable HTTPS URL to
    // the already-generated PDF (reusing the existing export endpoint), not inline
    // base64 content.
    | { type: "document"; document: { link: string; filename?: string } }
  >;
};


/**
 * A structured outbound message. The mock adapter just logs these; a real BSP/Cloud API
 * adapter translates `list`/`buttons` into WhatsApp's native List Message / Reply Button
 * message types, `text` into a plain session-message send, and `template` into a
 * pre-approved WhatsApp Message Template send (used for OTP delivery and any
 * proactive/re-engagement nudges that fall outside the 24h customer service window).
 */
export type BotMessage =
  | { kind: "text"; text: string }
  | { kind: "list"; header?: string; body: string; buttonLabel?: string; rows: BotListRow[] }
  | { kind: "buttons"; body: string; buttons: BotButton[] }
  | { kind: "template"; name: string; languageCode: string; components?: BotTemplateComponent[] };



export type MainFlow = "MAIN" | "PRICE_UPDATE" | "ENQUIRY_DECISION" | "ORDER_STATUS" | "DAILY_REPORT" | "HUMAN_HANDOFF";

export type WhatsAppSession = {
  phone: string;
  userId: string;
  email: string | null;
  name: string | null;
  supplierProfileId: string;
  language: "en" | "regional";
  flow: MainFlow;
  step: string;
  context: Record<string, unknown>;
  invalidCount: number;
  createdAt: number;
  updatedAt: number;
};


export const MENU_FOOTER = "Reply MENU to return to the main menu.";

export const GLOBAL_RESET_KEYWORDS = new Set(["MENU", "HI", "HELLO", "START"]);
export const HUMAN_HANDOFF_KEYWORDS = new Set(["AGENT", "HELP"]);

export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_INVALID_RETRIES = 3;
