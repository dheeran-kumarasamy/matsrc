// apps/web/lib/site-receipt-sheet-dto.ts
//
// Site Material Receipt & Verification Sheet — Strict Privacy DTO & Mapper
//
// MANDATORY FINANCIAL PRIVACY GUARANTEE:
// This document is strictly for physical material receipt verification at the
// construction site. It MUST NEVER contain commercial, pricing, tax, or
// payment data. Financial fields are excluded at the source data-mapping level
// via an explicit whitelist.
//
// The mapper rejects and strips any price, rate, subtotal, tax, discount,
// markup, currency, or payment status.

export type SiteReceiptSheetItem = {
  slNo: number;
  productName: string;
  description: string | null;
  specification: string | null;
  unit: string;
  invoiceQuantity: number;
};

export type SiteReceiptSheetParty = {
  name: string;
  address: string | null;
  gstin?: string | null;
  state?: string | null;
};

export type SiteReceiptSheetData = {
  documentTitle: "SITE MATERIAL RECEIPT & VERIFICATION SHEET";
  receiptSheetNumber: string;
  invoiceNumber: string;
  invoiceDate: string | Date;
  generatedDate: string | Date;
  supplierName: string;
  buyerName: string;
  siteName: string;
  deliveryAddress: string;
  orderReference: string;
  buyerPoNumber: string | null;
  items: SiteReceiptSheetItem[];
};

/**
 * Maps a raw invoice or serialized invoice row to a strictly sanitized
 * SiteReceiptSheetData object.
 *
 * Only permitted non-financial fields are extracted. No commercial or pricing
 * properties are allowed through.
 */
export function mapInvoiceToSiteReceiptSheet(invoice: any): SiteReceiptSheetData {
  if (!invoice) {
    throw new Error("Cannot map null or undefined invoice to SiteReceiptSheetData");
  }

  const invoiceNumber = String(invoice.invoiceNumber || "INV-NOT-SPECIFIED");
  const rawSuffix = invoiceNumber.replace(/^IN\//, "");
  const receiptSheetNumber = `DC/${rawSuffix}`;
  const orderRef = String(invoice.enquiryId || invoice.order?.enquiryId || invoice.orderId || "Not available");

  // Buyer name fallback
  const buyerName =
    invoice.buyer?.legalName ||
    invoice.buyer?.tradeName ||
    invoice.buyerLegalName ||
    invoice.builder?.legalName ||
    invoice.builder?.name ||
    "Contractor / Client";

  // Site name fallback
  const siteName = invoice.site?.name || "Site not specified";

  // Delivery site address fallback
  const siteAddress =
    [
      invoice.shipTo?.addressLine || invoice.shipToAddressLine || invoice.site?.addressLine,
      invoice.shipTo?.city || invoice.shipToCity || invoice.site?.city,
      invoice.shipTo?.state || invoice.shipToState || invoice.site?.state,
      invoice.shipTo?.pincode || invoice.shipToPincode || invoice.site?.pincode,
    ]
      .filter(Boolean)
      .join(", ") || "Site address not available";

  // Supplier name: Use supplier's company name if provided, or fallback
  const supplierName =
    invoice.supplier?.companyName ||
    invoice.supplierCompany ||
    invoice.supplierName ||
    "Authorized BuildOhub Supplier";

  const rawLineItems = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];

  const items: SiteReceiptSheetItem[] = rawLineItems.map((li: any, idx: number) => {
    const rawQty = li.quantity;
    const invoiceQuantity =
      typeof rawQty === "number"
        ? rawQty
        : rawQty != null
          ? Number(rawQty)
          : 0;

    const productName = String(li.productName || "Material / Product");
    const description = li.description ? String(li.description).trim() : null;
    const specification =
      li.specification ? String(li.specification).trim() : (li.hsnCode ? `HSN: ${li.hsnCode}` : null);
    const unit = String(li.uqc || li.unit || "Unit");

    return {
      slNo: typeof li.slNo === "number" && li.slNo > 0 ? li.slNo : idx + 1,
      productName,
      description: description || null,
      specification: specification || null,
      unit,
      invoiceQuantity: isNaN(invoiceQuantity) ? 0 : invoiceQuantity,
    };
  });

  return {
    documentTitle: "SITE MATERIAL RECEIPT & VERIFICATION SHEET",
    receiptSheetNumber,
    invoiceNumber,
    invoiceDate: invoice.invoiceDate || new Date(),
    generatedDate: new Date(),
    supplierName,
    buyerName,
    siteName,
    deliveryAddress: siteAddress,
    orderReference: orderRef,
    buyerPoNumber: invoice.buyerPoNumber ? String(invoice.buyerPoNumber) : null,
    items,
  };
}

