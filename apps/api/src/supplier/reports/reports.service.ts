import { Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus } from "@matsrc/db";
import { PrismaService } from "src/prisma/prisma.service";
import { SupplierContextService } from "src/supplier/supplier-context.service";

/**
 * Backs Flow 4 (Daily Report) of the WhatsApp bot, and is available as a plain REST API
 * for future portal use. Figures are computed directly from the same Order/OrderItem/
 * SupplierQuote tables the Supplier portal and Admin read from, so there is no separate
 * "bot-only" numbers path (per QA checklist requirement).
 */
@Injectable()
export class SupplierReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supplierContext: SupplierContextService
  ) {}

  async getSummary(user: any, rangeDays = 30) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const items = await this.prisma.orderItem.findMany({
      where: {
        supplierId: supplierProfile.id,
        order: { createdAt: { gte: since } },
      },
      include: { order: true, product: true },
    });

    const enquiryOrderIds = new Set(items.map((item) => item.orderId));
    const totalEnquiries = enquiryOrderIds.size;

    let accepted = 0;
    let rejected = 0;
    let confirmed = 0;
    let delivered = 0;
    let totalTransactionValue = 0;
    const qtyByProduct = new Map<string, { name: string; qty: number }>();

    for (const item of items) {
      const status = item.order.status;
      if (status === OrderStatus.PROCESSING || status === OrderStatus.DISPATCHED || status === OrderStatus.OUT_FOR_DELIVERY || status === OrderStatus.DELIVERED) {
        accepted += 1;
      }
      if (status === OrderStatus.CANCELLED) {
        rejected += 1;
      }
      if (status === OrderStatus.DELIVERED) {
        delivered += 1;
        totalTransactionValue += Number(item.unitPrice) * item.quantity;
      }

      const existing = qtyByProduct.get(item.productId) ?? { name: item.product.name, qty: 0 };
      existing.qty += item.quantity;
      qtyByProduct.set(item.productId, existing);
    }

    const confirmedPOs = await this.prisma.purchaseOrder.count({
      where: { supplierId: supplierProfile.id, createdAt: { gte: since } },
    });
    confirmed = confirmedPOs;

    const topProduct = [...qtyByProduct.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;

    return {
      rangeDays,
      totalEnquiries,
      accepted,
      rejected,
      ordersConfirmed: confirmed,
      ordersDelivered: delivered,
      totalTransactionValue,
      topProductByVolume: topProduct ? { name: topProduct.name, quantity: topProduct.qty } : null,
      pdfDownloadUrl: this.buildPdfLink("summary"),
    };
  }

  async getByProduct(user: any, productId: string, rangeDays = 30) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    const product = await this.prisma.product.findFirst({
      where: { id: productId, supplierId: supplierProfile.id },
    });

    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const items = await this.prisma.orderItem.findMany({
      where: {
        supplierId: supplierProfile.id,
        productId,
        order: { createdAt: { gte: since } },
      },
      include: { order: true },
    });

    const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalValue = items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
    const enquiries = new Set(items.map((item) => item.orderId)).size;
    const delivered = items.filter((item) => item.order.status === OrderStatus.DELIVERED).length;

    return {
      productId,
      productName: product.name,
      rangeDays,
      enquiries,
      ordersDelivered: delivered,
      totalQuantity: totalQty,
      totalValue,
      pdfDownloadUrl: this.buildPdfLink(`product-${productId}`),
    };
  }

  async listActiveProductsForReportPicker(user: any) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);
    const products = await this.prisma.product.findMany({
      where: { supplierId: supplierProfile.id, isActive: true },
      orderBy: { updatedAt: "desc" },
      take: 10,
    });

    return products.map((product) => ({ id: product.id, name: product.name }));
  }

  async getOrdersByValue(user: any, sort: "asc" | "desc" = "desc", limit = 5) {
    const { supplierProfile } = await this.supplierContext.getOrCreateSupplier(user.userId, user.email, user.name);

    const items = await this.prisma.orderItem.findMany({
      where: { supplierId: supplierProfile.id },
      include: { order: { include: { user: true } }, product: true },
    });

    const byOrder = new Map<string, { orderId: string; buyer: string; value: number; createdAt: Date }>();
    for (const item of items) {
      const existing = byOrder.get(item.orderId) ?? {
        orderId: item.orderId,
        buyer: item.order.user.name ?? item.order.user.phone ?? "Builder",
        value: 0,
        createdAt: item.order.createdAt,
      };
      existing.value += Number(item.unitPrice) * item.quantity;
      byOrder.set(item.orderId, existing);
    }

    const rows = [...byOrder.values()].sort((a, b) => (sort === "desc" ? b.value - a.value : a.value - b.value)).slice(0, limit);

    return {
      sort,
      limit,
      rows,
      pdfDownloadUrl: this.buildPdfLink(`orders-by-value-${sort}`),
    };
  }

  private buildPdfLink(reportKey: string): string {
    // Pre-generated report link stub, expiring after 24h. Real implementation would
    // generate/store a PDF and sign a short-lived URL; kept as a deterministic stub so
    // the bot flow is fully wired without a PDF-rendering dependency.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const baseUrl = process.env.SUPPLIER_PORTAL_URL || process.env.NEXT_PUBLIC_SUPPLIER_APP_URL || "https://matsrc-supplier.vercel.app";
    return `${baseUrl.replace(/\/$/, "")}/reports/${reportKey}.pdf?expires=${encodeURIComponent(expiresAt)}`;
  }
}
