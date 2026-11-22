// apps/web/lib/site-receipt-sheet-dto.ts
//
// Site Material Receipt & Verification Sheet (Delivery Challan - DC) — Strict Privacy DTO & Mapper
//
// MANDATORY FINANCIAL PRIVACY GUARANTEE:
// This document is strictly for physical material delivery verification at the
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

export type SiteReceiptSheetData = {
  documentTitle: "Delivery Challan";
  receiptSheetNumber: string;
  invoiceNumber: string;
  invoiceDate: string | Date;
  generatedDate: string | Date;
  supplierName: string;
  buyerName: string;
  buyerAddress: string;
  siteName: string;
  siteAddress: string;
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

  // Full Buyer Billing Address (GSTIN is explicitly omitted)
  const buyerAddress =
    [
      invoice.buyer?.addressLine || invoice.buyerAddressLine || invoice.builder?.billingAddress,
      invoice.buyer?.city || invoice.buyerCity || invoice.builder?.billingCity,
      invoice.buyer?.state || invoice.buyerState || invoice.builder?.billingState,
      invoice.buyer?.pincode || invoice.buyerPincode || invoice.builder?.billingPincode,
    ]
      .filter(Boolean)
      .join(", ") ||
    [invoice.site?.addressLine, invoice.site?.city, invoice.site?.state, invoice.site?.pincode]
      .filter(Boolean)
      .join(", ") ||
    "Address not configured";

  // Site name fallback
  const siteName = invoice.site?.name || invoice.shipTo?.name || "Site Delivery";

  // Delivery site address (without state code like 'Tamilnadu (33)')
  const siteAddress =
    [
      invoice.site?.addressLine || invoice.shipTo?.addressLine || invoice.shipToAddressLine,
      invoice.site?.city || invoice.shipTo?.city || invoice.shipToCity,
      invoice.site?.state || invoice.shipTo?.state || invoice.shipToState,
      invoice.site?.pincode || invoice.shipTo?.pincode || invoice.shipToPincode,
    ]
      .filter(Boolean)
      .join(", ") || "Address not configured";

  // Supplier name: Use supplier's company name if provided, or fallback
  const supplierName =
    invoice.supplier?.companyName ||
    invoice.supplierCompany ||
    invoice.supplierName ||
    "Authorized BuildOhub Supplier";

  const isFreightOrOtherCharge = (li: any): boolean => {
    if (li.isService === true) return true;
    const name = String(li.productName || li.name || "").toLowerCase().trim();
    const desc = String(li.description || "").toLowerCase().trim();
    const combined = `${name} ${desc}`;
    return (
      combined.includes("freight") ||
      combined.includes("other charge") ||
      combined.includes("transport") ||
      combined.includes("shipping") ||
      combined.includes("delivery charge") ||
      combined.includes("loading") ||
      combined.includes("unloading") ||
      combined.includes("handling")
    );
  };

  const rawLineItems = (Array.isArray(invoice.lineItems) ? invoice.lineItems : []).filter(
    (li: any) => !isFreightOrOtherCharge(li)
  );

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
      slNo: idx + 1,
      productName,
      description: description || null,
      specification: specification || null,
      unit,
      invoiceQuantity: isNaN(invoiceQuantity) ? 0 : invoiceQuantity,
    };
  });

  return {
    documentTitle: "Delivery Challan",
    receiptSheetNumber,
    invoiceNumber,
    invoiceDate: invoice.invoiceDate || new Date(),
    generatedDate: new Date(),
    supplierName,
    buyerName,
    buyerAddress,
    siteName,
    siteAddress,
    orderReference: orderRef,
    buyerPoNumber: invoice.buyerPoNumber ? String(invoice.buyerPoNumber) : null,
    items,
  };
}
