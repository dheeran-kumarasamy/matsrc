// Shared Invoice serialization for the Contractor/Client-facing builder
// portal (apps/web). Mirrors apps/api/src/admin/invoices/invoices.service.ts's
// own serialize() shape exactly, so both the Admin app and this app render
// identical invoice data from the same stored Invoice/InvoiceLineItem
// snapshot — never recomputed from live order/product pricing.

export function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export const invoiceInclude = {
  order: { select: { id: true, enquiryId: true } },
  builder: { select: { id: true, name: true, email: true, phone: true } },
  site: { select: { id: true, name: true, addressLine: true, city: true, state: true, pincode: true, gstin: true } },
  supplier: { select: { id: true, companyName: true, gstin: true, user: { select: { email: true, phone: true } } } },
  generatedBy: { select: { id: true, name: true, email: true } },
  lineItems: true,
} as const;

export function serializeInvoice(invoice: any) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    status: invoice.status,
    orderId: invoice.orderId,
    enquiryId: invoice.enquiryId ?? invoice.order?.enquiryId ?? invoice.orderId,
    builder: invoice.builder
      ? { id: invoice.builder.id, name: invoice.builder.name, email: invoice.builder.email, phone: invoice.builder.phone }
      : null,
    site: invoice.site
      ? {
          id: invoice.site.id,
          name: invoice.site.name,
          addressLine: invoice.site.addressLine,
          city: invoice.site.city,
          state: invoice.site.state,
          pincode: invoice.site.pincode,
          gstin: invoice.site.gstin,
        }
      : null,
    supplier: invoice.supplier
      ? {
          id: invoice.supplier.id,
          companyName: invoice.supplier.companyName,
          gstin: invoice.supplier.gstin,
          email: invoice.supplier.user?.email ?? null,
          phone: invoice.supplier.user?.phone ?? null,
        }
      : null,
    lineItems: (invoice.lineItems ?? []).map((li: any) => ({
      id: li.id,
      productId: li.productId,
      productName: li.productName,
      description: li.description,
      quantity: li.quantity,
      unitPrice: toNumber(li.unitPrice),
      taxRate: li.taxRate !== null && li.taxRate !== undefined ? toNumber(li.taxRate) : null,
      taxAmount: toNumber(li.taxAmount),
      subtotal: toNumber(li.subtotal),
      total: toNumber(li.total),
    })),
    subtotal: toNumber(invoice.subtotal),
    taxAmount: toNumber(invoice.taxAmount),
    totalAmount: toNumber(invoice.totalAmount),
    currency: invoice.currency,
    paymentStatus: invoice.paymentStatus,
    amountPaid: invoice.amountPaid !== null && invoice.amountPaid !== undefined ? toNumber(invoice.amountPaid) : null,
    amountDue: invoice.amountDue !== null && invoice.amountDue !== undefined ? toNumber(invoice.amountDue) : null,
    generatedBy: invoice.generatedBy
      ? { id: invoice.generatedBy.id, name: invoice.generatedBy.name, email: invoice.generatedBy.email }
      : null,
    generatedAt: invoice.generatedAt,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}
