import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { renderRfqPdf, type RfqPdfData } from "src/common/rfq-pdf.util";

// Admin-only RFQ data loading + PDF rendering. No ownership scoping is
// required here (RoleGuard + @Roles("ADMIN") on the controller already
// gates this to Admin/Super Admin — see AdminRfqPdfController) — mirrors
// AdminInvoicesController's identical "any admin may view any order"
// convention.
@Injectable()
export class AdminRfqPdfService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        enquiryId: true,
        status: true,
        createdAt: true,
        deliveryAddress: true,
        deliveryDate: true,
        tentativeDeliveryDate: true,
        user: { select: { name: true, email: true, phone: true } },
        site: {
          select: { name: true, addressLine: true, city: true, state: true, pincode: true },
        },
        items: {
          select: {
            quantity: true,
            product: { select: { name: true, description: true, unit: true } },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("RFQ not found");
    }

    return order;
  }

  // Identity privacy: the rendered PDF never includes the builder's or
  // supplier's real name/contact details — the requesting party is shown
  // only by its Site name, and the counterparty is always rendered as
  // "BuildOhub" (see rfq-pdf.util.ts's RfqPdfData doc comment and its
  // hardcoded BUILDOHUB_COMPANY.name in the Supplier column). Order.user
  // is therefore deliberately NOT mapped into RfqPdfData here — it remains
  // available on `order` only for getSummary()'s internal Admin-only
  // display below, which is a different, staff-facing screen, not the
  // cross-party document.
  private toRfqPdfData(order: Awaited<ReturnType<AdminRfqPdfService["loadOrder"]>>): RfqPdfData {
    return {
      rfqNumber: order.enquiryId ?? order.id,
      createdAt: order.createdAt,
      status: order.status,
      site: order.site,
      deliveryAddress: order.deliveryAddress,
      deliveryDate: order.deliveryDate ?? order.tentativeDeliveryDate,
      // No RFQ-level notes field exists on Order itself — deliberately
      // never substituted with SupplierQuote.notes (a specific supplier's
      // own quotation remarks; see rfq-pdf.util.ts's doc comment on why
      // that would leak an unintended, supplier-specific note).
      notes: null,
      lineItems: order.items.map((item) => ({
        productName: item.product.name,
        description: item.product.description,
        quantity: item.quantity,
        unit: item.product.unit,
      })),
    };
  }

  async renderPdf(orderId: string): Promise<{ buffer: Buffer; filename: string }> {
    const order = await this.loadOrder(orderId);
    const data = this.toRfqPdfData(order);
    const buffer = await renderRfqPdf(data);
    const filename = `RFQ-${data.rfqNumber}`.replace(/[\\/]/g, "-") + ".pdf";
    return { buffer, filename };
  }

  // Lightweight JSON metadata read backing the minimal Admin RFQ detail
  // page (see AdminRfqPdfController.getRfq / apps/admin's
  // app/(admin)/orders/[orderId]/page.tsx) — the download action itself
  // only needs rfqNumber/status/createdAt to render, so this intentionally
  // returns far less than the full PDF payload (no supplier contact
  // details, no notes) to avoid over-exposing data an Admin list screen
  // doesn't need just to show a download button.
  async getSummary(orderId: string) {
    const order = await this.loadOrder(orderId);
    return {
      id: order.id,
      rfqNumber: order.enquiryId ?? order.id,
      status: order.status,
      createdAt: order.createdAt,
      builder: order.user ? { name: order.user.name, email: order.user.email, phone: order.user.phone } : null,
      itemCount: order.items.length,
    };
  }
}
