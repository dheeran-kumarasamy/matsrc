import { numberToIndianWords, getStateCode, getStateName } from "@matsrc/db";
import { BUILDOHUB_COMPANY } from "./company-info";

// Shared Invoice serialization for the Contractor/Client-facing builder
// portal (apps/web). Mirrors apps/api/src/admin/invoices/invoices.service.ts's
// own serialize() shape exactly, so both the Admin app and this app render
// identical invoice data from the same stored Invoice/InvoiceLineItem
// snapshot — never recomputed from live order/product pricing.

export function toNumber(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

// NOTE: deliberately does NOT select `supplier` — the generated BuildOhub
// buyer invoice must never disclose the supplier's identity (name/GSTIN/
// contact) to the Contractor/Client. Ship-from/ship-to are the invoice's
// own frozen address-only snapshot columns (see schema.prisma), selected
// directly below instead.
export const invoiceInclude = {
  order: { select: { id: true, enquiryId: true } },
  builder: { select: { id: true, name: true, email: true, phone: true } },
  site: { select: { id: true, name: true, addressLine: true, city: true, state: true, pincode: true, gstin: true } },
  generatedBy: { select: { id: true, name: true, email: true } },
  lineItems: true,
} as const;

export function serializeInvoice(invoice: any) {
  const sellerStateCode = invoice.sellerStateCode ?? "33";
  const placeOfSupplyStateCode =
    invoice.placeOfSupplyStateCode ??
    invoice.buyerStateCode ??
    getStateCode(invoice.site?.state, invoice.site?.gstin) ??
    "33";
  const placeOfSupplyStateName =
    invoice.placeOfSupplyStateName ??
    invoice.site?.state ??
    getStateName(placeOfSupplyStateCode) ??
    "Tamil Nadu";
  const isIntraState = sellerStateCode === placeOfSupplyStateCode;

  const rawSubtotal = toNumber(invoice.subtotal);
  const freightChargeAmount = toNumber(invoice.freightChargeAmount);
  const otherChargesAmount = toNumber(invoice.otherChargesAmount);
  const discountAmount = toNumber(invoice.discountAmount);
  const roundingAdjustment = toNumber(invoice.roundingAdjustment);
  const netAdjustment = freightChargeAmount + otherChargesAmount - discountAmount;
  const taxableValue =
    invoice.taxableValue !== null && invoice.taxableValue !== undefined
      ? toNumber(invoice.taxableValue)
      : rawSubtotal + netAdjustment;

  let totalTaxAmount = toNumber(invoice.taxAmount);
  let cgstTotal = toNumber(invoice.cgstAmount);
  let sgstTotal = toNumber(invoice.sgstAmount);
  let igstTotal = toNumber(invoice.igstAmount);

  if (cgstTotal === 0 && sgstTotal === 0 && igstTotal === 0 && totalTaxAmount > 0) {
    if (isIntraState) {
      cgstTotal = Math.round((totalTaxAmount / 2 + Number.EPSILON) * 100) / 100;
      sgstTotal = Math.round((totalTaxAmount - cgstTotal + Number.EPSILON) * 100) / 100;
    } else {
      igstTotal = totalTaxAmount;
    }
  }

  const totalAmount = toNumber(invoice.totalAmount);

  const buyer = {
    legalName: invoice.buyerLegalName ?? invoice.builder?.name ?? "Contractor/Client",
    tradeName: invoice.buyerTradeName ?? invoice.site?.name ?? null,
    gstin: invoice.buyerGstin ?? invoice.site?.gstin ?? "URP",
    addressLine: invoice.buyerAddressLine ?? invoice.site?.addressLine ?? null,
    city: invoice.buyerCity ?? invoice.site?.city ?? null,
    state: invoice.buyerState ?? invoice.site?.state ?? null,
    pincode: invoice.buyerPincode ?? invoice.site?.pincode ?? null,
    stateCode: invoice.buyerStateCode ?? placeOfSupplyStateCode,
  };

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    status: invoice.status,
    documentType: invoice.documentType ?? "INV",
    supplyType: invoice.supplyType ?? "B2B",
    reverseCharge: Boolean(invoice.reverseCharge),
    placeOfSupplyStateCode,
    placeOfSupplyStateName,
    sellerStateCode,
    orderId: invoice.orderId,
    enquiryId: invoice.enquiryId ?? invoice.order?.enquiryId ?? invoice.orderId,
    builder: invoice.builder
      ? { id: invoice.builder.id, name: invoice.builder.name, email: invoice.builder.email, phone: invoice.builder.phone }
      : null,
    buyer,
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
    // Ship-from/ship-to — location only, never the supplier's identity, per
    // the buyer-facing privacy requirement.
    shipFrom:
      invoice.shipFromAddressLine || invoice.shipFromCity || invoice.shipFromState || invoice.shipFromPincode
        ? {
            addressLine: invoice.shipFromAddressLine ?? null,
            city: invoice.shipFromCity ?? null,
            state: invoice.shipFromState ?? null,
            pincode: invoice.shipFromPincode ?? null,
          }
        : null,
    shipTo:
      invoice.shipToAddressLine || invoice.shipToCity || invoice.shipToState || invoice.shipToPincode
        ? {
            addressLine: invoice.shipToAddressLine ?? null,
            city: invoice.shipToCity ?? null,
            state: invoice.shipToState ?? null,
            pincode: invoice.shipToPincode ?? null,
          }
        : null,
    lineItems: (invoice.lineItems ?? []).map((li: any, index: number) => {
      const lineTaxRate = li.taxRate !== null && li.taxRate !== undefined ? toNumber(li.taxRate) : null;
      const lineTaxAmount = toNumber(li.taxAmount);
      let lineCgst = toNumber(li.cgstAmount);
      let lineSgst = toNumber(li.sgstAmount);
      let lineIgst = toNumber(li.igstAmount);

      if (lineCgst === 0 && lineSgst === 0 && lineIgst === 0 && lineTaxAmount > 0) {
        if (isIntraState) {
          lineCgst = Math.round((lineTaxAmount / 2 + Number.EPSILON) * 100) / 100;
          lineSgst = Math.round((lineTaxAmount - lineCgst + Number.EPSILON) * 100) / 100;
        } else {
          lineIgst = lineTaxAmount;
        }
      }

      const hsnCode =
        li.hsnCode ??
        (li.productName?.toLowerCase().includes("cement")
          ? "2523"
          : li.productName?.toLowerCase().includes("steel") || li.productName?.toLowerCase().includes("tmt")
            ? "7214"
            : "6810");

      return {
        id: li.id,
        slNo: li.slNo ?? index + 1,
        productId: li.productId,
        productName: li.productName,
        description: li.description,
        hsnCode,
        uqc: li.uqc ?? "OTH",
        unit: li.unit ?? "Unit",
        isService: Boolean(li.isService),
        quantity: toNumber(li.quantity),
        unitPrice: toNumber(li.unitPrice),
        taxableAmount:
          li.taxableAmount !== null && li.taxableAmount !== undefined
            ? toNumber(li.taxableAmount)
            : toNumber(li.subtotal),
        taxRate: lineTaxRate,
        cgstRate:
          li.cgstRate !== null && li.cgstRate !== undefined
            ? toNumber(li.cgstRate)
            : isIntraState && lineTaxRate !== null
              ? lineTaxRate / 2
              : null,
        cgstAmount: lineCgst,
        sgstRate:
          li.sgstRate !== null && li.sgstRate !== undefined
            ? toNumber(li.sgstRate)
            : isIntraState && lineTaxRate !== null
              ? lineTaxRate / 2
              : null,
        sgstAmount: lineSgst,
        igstRate:
          li.igstRate !== null && li.igstRate !== undefined
            ? toNumber(li.igstRate)
            : !isIntraState && lineTaxRate !== null
              ? lineTaxRate
              : null,
        igstAmount: lineIgst,
        taxAmount: lineTaxAmount,
        subtotal: toNumber(li.subtotal),
        total: toNumber(li.total),
      };
    }),
    subtotal: toNumber(invoice.subtotal),
    // Invoice-level adjustments + reconciling taxable value (audit fix —
    // see Invoice.taxableValue's schema doc comment). `taxableValue` falls
    // back to `subtotal` for historical invoices generated before these
    // fields existed, so those invoices keep rendering exactly as before.
    freightChargeAmount,
    otherChargesAmount,
    discountAmount,
    roundingAdjustment,
    taxableValue,
    cgstAmount: cgstTotal,
    sgstAmount: sgstTotal,
    igstAmount: igstTotal,
    cessAmount: toNumber(invoice.cessAmount),
    taxAmount: totalTaxAmount,
    totalAmount,
    totalInWords: numberToIndianWords(totalAmount),
    currency: invoice.currency,
    paymentStatus: invoice.paymentStatus,
    amountPaid: invoice.amountPaid !== null && invoice.amountPaid !== undefined ? toNumber(invoice.amountPaid) : null,
    amountDue: invoice.amountDue !== null && invoice.amountDue !== undefined ? toNumber(invoice.amountDue) : null,
    bankDetails: BUILDOHUB_COMPANY.bankDetails,
    buyerPoNumber: invoice.buyerPoNumber ?? null,
    ewayBillNumber: invoice.ewayBillNumber ?? null,
    vehicleNumber: invoice.vehicleNumber ?? null,
    transporterName: invoice.transporterName ?? null,
    generatedBy: invoice.generatedBy
      ? { id: invoice.generatedBy.id, name: invoice.generatedBy.name, email: invoice.generatedBy.email }
      : null,
    generatedAt: invoice.generatedAt,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}
