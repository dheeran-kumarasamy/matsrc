import { Injectable } from "@nestjs/common";
import { SupplierReportsService } from "src/supplier/reports/reports.service";
import { WhatsAppSession, BotMessage, MENU_FOOTER } from "../whatsapp.types";
import { WhatsAppSessionService } from "../whatsapp-session.service";

// Only 3 options, within WhatsApp's Reply Button limit (max 3) — so this menu uses
// native Reply Buttons rather than an Interactive List Message.
const REPORT_BUTTONS = [
  { id: "SUMMARY", title: "Last 1 Month" },
  { id: "BY_PRODUCT", title: "By Product" },
  { id: "BY_VALUE", title: "By Transaction Value" },
];

/** Numeric free-text fallback (1-3), mirroring the Main Menu's dual-path pattern. */
const REPORT_NUMERIC_FALLBACK: Record<string, string> = {
  "1": "SUMMARY",
  "2": "BY_PRODUCT",
  "3": "BY_VALUE",
};


/**
 * Flow 4 — Daily Report (see spec §7).
 *
 * Thin bot-facing wrapper around `SupplierReportsService`, which is the same service the
 * Supplier portal can call — so the numbers the bot reports are never a separate,
 * potentially-drifting source of truth.
 */
@Injectable()
export class DailyReportFlow {
  constructor(
    private readonly reportsService: SupplierReportsService,
    private readonly sessionService: WhatsAppSessionService
  ) {}

  async start(session: WhatsAppSession): Promise<BotMessage> {
    this.sessionService.setFlow(session.phone, "DAILY_REPORT", "MENU");
    return {
      kind: "buttons",
      body: "Which report would you like?",
      buttons: REPORT_BUTTONS.map((button) => ({ id: button.id, title: button.title })),
    };
  }


  async handle(session: WhatsAppSession, text: string): Promise<BotMessage> {
    switch (session.step) {
      case "MENU":
        return this.handleMenuSelect(session, text);
      case "SELECT_PRODUCT":
        return this.handleProductSelect(session, text);
      default:
        return this.start(session);
    }
  }

  private user(session: WhatsAppSession) {
    return { userId: session.userId, email: session.email, name: session.name };
  }

  private async handleMenuSelect(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const trimmed = text.trim();
    // Path 1: a tapped Reply Button arrives as its `id` (e.g. "SUMMARY") via
    // `interactive.button_reply.id`. Path 2: numeric free-text fallback ("1"-"3") for
    // users who type instead of tapping. Both converge on the same handlers below.
    const choice = REPORT_NUMERIC_FALLBACK[trimmed] ?? trimmed.toUpperCase();

    if (choice === "SUMMARY") {

      return this.presentSummary(session);
    }

    if (choice === "BY_VALUE") {
      return this.presentByValue(session);
    }

    if (choice === "BY_PRODUCT") {
      return this.presentProductPicker(session);
    }

    return { kind: "text", text: "Please select a valid report option from the list." };
  }

  private async presentSummary(session: WhatsAppSession): Promise<BotMessage> {
    const summary = await this.reportsService.getSummary(this.user(session), 30);
    this.sessionService.resetToMainMenu(session.phone);

    const text =
      `📊 Last 1 Month Summary\n` +
      `Enquiries: ${summary.totalEnquiries}\n` +
      `Accepted: ${summary.accepted}\n` +
      `Rejected: ${summary.rejected}\n` +
      `Confirmed (POs): ${summary.ordersConfirmed}\n` +
      `Delivered: ${summary.ordersDelivered}\n` +
      `Total transaction value: ₹${summary.totalTransactionValue}\n` +
      (summary.topProductByVolume ? `Top product: ${summary.topProductByVolume.name} (${summary.topProductByVolume.quantity} units)\n` : "") +
      `\nFull PDF: ${summary.pdfDownloadUrl}\n\n${MENU_FOOTER}`;

    return { kind: "text", text };
  }

  private async presentProductPicker(session: WhatsAppSession): Promise<BotMessage> {
    const products = await this.reportsService.listActiveProductsForReportPicker(this.user(session));

    if (!products.length) {
      this.sessionService.resetToMainMenu(session.phone);
      return { kind: "text", text: `You don't have any active listings to report on.\n\n${MENU_FOOTER}` };
    }

    this.sessionService.update(session.phone, { step: "SELECT_PRODUCT", context: { productIds: products.map((p) => p.id) } });

    return {
      kind: "list",
      header: "By Product",
      body: "Select a product to see its report.",
      rows: products.map((product) => ({ id: product.id, title: product.name })),
    };
  }

  private async handleProductSelect(session: WhatsAppSession, text: string): Promise<BotMessage> {
    const productIds = (session.context.productIds as string[]) ?? [];
    const productId = text.trim();
    if (!productIds.includes(productId)) {
      return { kind: "text", text: "Please select a valid product from the list." };
    }

    const report = await this.reportsService.getByProduct(this.user(session), productId, 30);
    this.sessionService.resetToMainMenu(session.phone);

    const text2 =
      `📊 ${report.productName} — Last 30 Days\n` +
      `Enquiries: ${report.enquiries}\n` +
      `Delivered orders: ${report.ordersDelivered}\n` +
      `Total quantity: ${report.totalQuantity}\n` +
      `Total value: ₹${report.totalValue}\n\n` +
      `Full PDF: ${report.pdfDownloadUrl}\n\n${MENU_FOOTER}`;

    return { kind: "text", text: text2 };
  }

  private async presentByValue(session: WhatsAppSession): Promise<BotMessage> {
    const report = await this.reportsService.getOrdersByValue(this.user(session), "desc", 5);
    this.sessionService.resetToMainMenu(session.phone);

    const rowsText = report.rows.length
      ? report.rows.map((row, index) => `${index + 1}. ${row.buyer} — ₹${row.value}`).join("\n")
      : "No orders yet.";

    const text = `📊 Top Orders by Value\n${rowsText}\n\nFull PDF: ${report.pdfDownloadUrl}\n\n${MENU_FOOTER}`;

    return { kind: "text", text };
  }
}
