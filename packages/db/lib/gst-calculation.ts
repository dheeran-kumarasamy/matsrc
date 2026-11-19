// packages/db/lib/gst-calculation.ts
//
// Shared, framework-agnostic GST/line-total calculation used by the Supplier
// RFQ Price Revision & GST-Inclusive Order Value feature (see
// apps/api/src/supplier/rfqs/rfqs.service.ts and
// apps/supplier/lib/supplier-data.ts — both quote-submission call sites use
// THIS module rather than re-implementing the math, per the existing
// convention already established for `DEFAULT_TAX_RATE_PERCENT` in
// apps/web/lib/sourcing/landed-cost.ts / site-wise-report.ts / tally-vouchers.ts.
//
// Formula (unchanged from the existing GST convention elsewhere in this
// codebase):
//   lineSubtotal = quantity * unitPrice
//   gstAmount    = lineSubtotal * gstRatePercent / 100
//   lineTotal    = lineSubtotal + gstAmount
//
// Rounding happens only at the END of each computation (never on
// intermediate values), matching the Decimal(12,2)/Decimal(14,2) columns
// these values are ultimately persisted into (SupplierQuote.lineSubtotal /
// gstAmount / lineTotal, OrderItem.unitPrice).
//
// GST rate resolution mirrors the existing, already-established fallback
// used by the site-wise report / Tally export / landed-cost estimator:
// OrderItem.taxRatePercent is nullable — when absent, DEFAULT_TAX_RATE_PERCENT
// (18) applies. No GST rate is ever hard-coded as the ONLY rate — every line
// item may carry its own taxRatePercent, which (when present) always wins.

/**
 * Default GST rate applied when a line item carries no explicit
 * taxRatePercent. Mirrors apps/web/lib/sourcing/landed-cost.ts's identical
 * constant/convention — kept here as the single shared copy for the
 * RFQ-quotation flow so apps/api (NestJS) and apps/supplier (Next.js), which
 * cannot import from apps/web, both apply the exact same default.
 */
export const DEFAULT_TAX_RATE_PERCENT = 18;

/** Rounds to 2 decimal places without floating-point drift. */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Strict validation for a supplier-entered quoted unit price (spec §12):
 * rejects negative values, NaN, Infinity, and non-finite/empty input. Zero is
 * treated as valid here — callers that must reject zero-price quotations per
 * their own business rule should layer that check on top explicitly, since
 * this module makes no assumption about whether ₹0 quotations are allowed.
 */
export function isValidQuotedPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Parses a supplier-submitted price string/number, returning null if invalid. */
export function parseQuotedPrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return isValidQuotedPrice(parsed) ? parsed : null;
}

export type LineGstInput = {
  quantity: number;
  unitPrice: number;
  /** Null/undefined applies DEFAULT_TAX_RATE_PERCENT. */
  gstRatePercent?: number | null;
};

export type LineGstBreakdown = {
  quantity: number;
  unitPrice: number;
  gstRatePercent: number;
  lineSubtotal: number;
  gstAmount: number;
  lineTotal: number;
};

/**
 * Computes the GST breakdown for a single RFQ/quotation line item:
 *   lineSubtotal = quantity * unitPrice
 *   gstAmount    = lineSubtotal * gstRatePercent / 100
 *   lineTotal    = lineSubtotal + gstAmount
 * A gstRatePercent of 0 is honoured as a genuine "GST not applicable" line
 * (gstAmount = 0, lineTotal = lineSubtotal) — never silently replaced with
 * the default.
 */
export function calculateLineGst(input: LineGstInput): LineGstBreakdown {
  const gstRatePercent =
    typeof input.gstRatePercent === "number" && Number.isFinite(input.gstRatePercent)
      ? input.gstRatePercent
      : DEFAULT_TAX_RATE_PERCENT;

  const lineSubtotal = input.quantity * input.unitPrice;
  const gstAmount = (lineSubtotal * gstRatePercent) / 100;
  const lineTotal = lineSubtotal + gstAmount;

  return {
    quantity: input.quantity,
    unitPrice: roundCurrency(input.unitPrice),
    gstRatePercent,
    lineSubtotal: roundCurrency(lineSubtotal),
    gstAmount: roundCurrency(gstAmount),
    lineTotal: roundCurrency(lineTotal),
  };
}

export type QuotationTotals = {
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
};

/**
 * Aggregates a quotation's per-line GST breakdowns into the overall
 * quotation-level totals shown to the supplier before submission (spec §7):
 *   Product Value (subtotal) / GST / Total Order Value (grand total).
 */
export function aggregateQuotationTotals(lines: LineGstBreakdown[]): QuotationTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
  const gstAmount = lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const grandTotal = subtotal + gstAmount;

  return {
    subtotal: roundCurrency(subtotal),
    gstAmount: roundCurrency(gstAmount),
    grandTotal: roundCurrency(grandTotal),
  };
}

// ─────────────────────────────────────────────
// Form GST INV-01 / E-Invoice & GST Compliance Utilities (Phase 2)
// ─────────────────────────────────────────────

/** Official Indian 2-digit GST state codes mapped from state names */
export const STATE_CODE_MAP: Record<string, string> = {
  "jammu and kashmir": "01",
  "jammu & kashmir": "01",
  "himachal pradesh": "02",
  "punjab": "03",
  "chandigarh": "04",
  "uttarakhand": "05",
  "haryana": "06",
  "delhi": "07",
  "rajasthan": "08",
  "uttar pradesh": "09",
  "bihar": "10",
  "sikkim": "11",
  "arunachal pradesh": "12",
  "nagaland": "13",
  "manipur": "14",
  "mizoram": "15",
  "tripura": "16",
  "meghalaya": "17",
  "assam": "18",
  "west bengal": "19",
  "jharkhand": "20",
  "odisha": "21",
  "orissa": "21",
  "chhattisgarh": "22",
  "madhya pradesh": "23",
  "gujarat": "24",
  "dadra and nagar haveli and daman and diu": "26",
  "daman and diu": "26",
  "maharashtra": "27",
  "andhra pradesh": "37",
  "karnataka": "29",
  "goa": "30",
  "lakshadweep": "31",
  "kerala": "32",
  "tamil nadu": "33",
  "tamilnadu": "33",
  "puducherry": "34",
  "pondicherry": "34",
  "andaman and nicobar islands": "35",
  "telangana": "36",
  "ladakh": "38",
  "other territory": "97",
};

/** Reverse mapping from 2-digit state code to canonical state name */
export const CODE_TO_STATE_MAP: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

/**
 * Resolves the 2-digit numeric GST state code from a state name or GSTIN.
 * If GSTIN is provided and starts with 2 digits, those 2 digits are used directly.
 */
export function getStateCode(stateName?: string | null, gstin?: string | null): string | null {
  if (gstin && gstin.trim().length >= 2) {
    const prefix = gstin.trim().slice(0, 2);
    if (/^\d{2}$/.test(prefix)) {
      return prefix;
    }
  }

  if (stateName && stateName.trim()) {
    const normalized = stateName.trim().toLowerCase();
    if (STATE_CODE_MAP[normalized]) {
      return STATE_CODE_MAP[normalized];
    }
  }

  return null;
}

/**
 * Resolves the canonical state name from a 2-digit GST state code.
 */
export function getStateName(stateCode?: string | null): string | null {
  if (!stateCode) return null;
  return CODE_TO_STATE_MAP[stateCode.trim()] ?? null;
}

/**
 * Normalizes a product unit to an official GST Unit Quantity Code (UQC).
 * Reference: Form GST INV-01 ItemList.Unit.
 */
export function normalizeUqc(unit?: string | null): string {
  if (!unit || !unit.trim()) return "OTH";
  const clean = unit.trim().toUpperCase();

  switch (clean) {
    case "MT":
    case "METRIC TON":
    case "TON":
    case "TONNE":
    case "TONNES":
      return "TON";
    case "BAG":
    case "BAGS":
      return "BAG";
    case "SQM":
    case "SQ.M":
    case "SQ MTR":
    case "SQUARE METER":
    case "SQUARE METRES":
      return "SQM";
    case "SQFT":
    case "SQ.FT":
    case "SQ FT":
    case "SQUARE FEET":
      return "SQF";
    case "KG":
    case "KGS":
    case "KILOGRAM":
    case "KILOGRAMS":
      return "KGS";
    case "MTR":
    case "METER":
    case "METRE":
    case "METERS":
    case "METRES":
      return "MTR";
    case "PCS":
    case "NOS":
    case "PIECE":
    case "PIECES":
    case "UNIT":
    case "UNITS":
    case "NUMBER":
    case "NUMBERS":
      return "NOS";
    case "BOX":
    case "BOXES":
      return "BOX";
    case "LTR":
    case "LITRE":
    case "LITER":
    case "LITRES":
      return "LTR";
    case "BDL":
    case "BUNDLE":
    case "BUNDLES":
      return "BDL";
    case "SET":
    case "SETS":
      return "SET";
    default:
      return clean.length === 3 ? clean : "OTH";
  }
}

/**
 * Resolves the user-facing display unit of measurement for an invoice line item.
 * In Form GST INV-01 / E-Invoicing, `uqc` is a 3-character statutory code (like "OTH" for other).
 * However, buyers, admins, and PDFs must see the actual physical unit set on the site
 * (e.g. "KGS", "BAG", "MT", "SQFT"), and must NEVER see "OTH" or "Unit" as the measurement label.
 */
export function resolveInvoiceDisplayUnit(params: {
  unit?: string | null;
  uqc?: string | null;
  productName?: string | null;
}): string {
  const cleanUnit = params.unit?.trim();
  if (cleanUnit && cleanUnit.toUpperCase() !== "OTH" && cleanUnit.toUpperCase() !== "UNIT") {
    return cleanUnit;
  }
  const cleanUqc = params.uqc?.trim();
  if (cleanUqc && cleanUqc.toUpperCase() !== "OTH" && cleanUqc.toUpperCase() !== "UNIT") {
    return cleanUqc;
  }
  if (params.productName) {
    const lower = params.productName.toLowerCase();
    if (lower.includes("steel") || lower.includes("tmt")) {
      return "KGS";
    }
    if (lower.includes("cement")) {
      return "BAG";
    }
  }
  return cleanUnit || (cleanUqc && cleanUqc.toUpperCase() !== "OTH" ? cleanUqc : null) || "Unit";
}

export type LineTaxSplitInput = {
  quantity: number;
  unitPrice: number;
  gstRatePercent?: number | null;
  sellerStateCode?: string | null;
  placeOfSupplyStateCode?: string | null;
};

export type LineTaxSplitResult = {
  quantity: number;
  unitPrice: number;
  gstRatePercent: number;
  taxableAmount: number;
  isIntraState: boolean;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  igstRate: number;
  igstAmount: number;
  cessRate: number;
  cessAmount: number;
  totalTaxAmount: number;
  lineTotal: number;
};

/**
 * Computes the split of GST into CGST+SGST (for intra-state supplies)
 * or IGST (for inter-state supplies) as required by Form GST INV-01 and
 * Rule 46 of the CGST Rules.
 */
export function calculateLineTaxSplit(input: LineTaxSplitInput): LineTaxSplitResult {
  const quantity = input.quantity;
  const unitPrice = roundCurrency(input.unitPrice);
  const gstRatePercent =
    typeof input.gstRatePercent === "number" && Number.isFinite(input.gstRatePercent)
      ? input.gstRatePercent
      : DEFAULT_TAX_RATE_PERCENT;

  const sellerStateCode = input.sellerStateCode?.trim() || "33"; // Default Tamil Nadu
  const posCode = input.placeOfSupplyStateCode?.trim() || "33";
  const isIntraState = sellerStateCode === posCode;

  const taxableAmount = roundCurrency(quantity * unitPrice);

  let cgstRate = 0;
  let cgstAmount = 0;
  let sgstRate = 0;
  let sgstAmount = 0;
  let igstRate = 0;
  let igstAmount = 0;

  if (gstRatePercent > 0) {
    if (isIntraState) {
      cgstRate = roundCurrency(gstRatePercent / 2);
      sgstRate = roundCurrency(gstRatePercent / 2);
      cgstAmount = roundCurrency((taxableAmount * cgstRate) / 100);
      sgstAmount = roundCurrency((taxableAmount * sgstRate) / 100);
    } else {
      igstRate = gstRatePercent;
      igstAmount = roundCurrency((taxableAmount * igstRate) / 100);
    }
  }

  const totalTaxAmount = roundCurrency(cgstAmount + sgstAmount + igstAmount);
  const lineTotal = roundCurrency(taxableAmount + totalTaxAmount);

  return {
    quantity,
    unitPrice,
    gstRatePercent,
    taxableAmount,
    isIntraState,
    cgstRate,
    cgstAmount,
    sgstRate,
    sgstAmount,
    igstRate,
    igstAmount,
    cessRate: 0,
    cessAmount: 0,
    totalTaxAmount,
    lineTotal,
  };
}

/**
 * Converts a numeric amount to Indian currency words
 * e.g., 145250.50 -> "Rupees One Lakh Forty-Five Thousand Two Hundred Fifty and Paise Fifty Only"
 */
export function numberToIndianWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "Zero";
  if (amount === 0) return "Rupees Zero Only";

  const singleDigits = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = [
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertTwoDigits(n: number): string {
    if (n < 10) return singleDigits[n];
    if (n < 20) return teens[n - 10];
    const unit = n % 10;
    const ten = Math.floor(n / 10);
    return `${tens[ten]}${unit !== 0 ? `-${singleDigits[unit]}` : ""}`;
  }

  function convertThreeDigits(n: number): string {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    const parts: string[] = [];
    if (hundred > 0) parts.push(`${singleDigits[hundred]} Hundred`);
    if (rest > 0) parts.push(convertTwoDigits(rest));
    return parts.join(" ");
  }

  const integerPart = Math.floor(amount);
  const paisePart = Math.round((amount - integerPart) * 100);

  const parts: string[] = [];

  // Crores (10,000,000)
  const crores = Math.floor(integerPart / 10000000);
  let rem = integerPart % 10000000;
  if (crores > 0) {
    parts.push(`${convertTwoDigits(crores % 100)} Crore${crores > 1 ? "s" : ""}`);
  }

  // Lakhs (100,000)
  const lakhs = Math.floor(rem / 100000);
  rem = rem % 100000;
  if (lakhs > 0) {
    parts.push(`${convertTwoDigits(lakhs)} Lakh${lakhs > 1 ? "s" : ""}`);
  }

  // Thousands (1,000)
  const thousands = Math.floor(rem / 1000);
  rem = rem % 1000;
  if (thousands > 0) {
    parts.push(`${convertTwoDigits(thousands)} Thousand`);
  }

  // Hundreds & rest
  if (rem > 0) {
    parts.push(convertThreeDigits(rem));
  }

  const rupeeString = parts.length > 0 ? `Rupees ${parts.join(" ")}` : "Rupees Zero";
  const paiseString = paisePart > 0 ? ` and Paise ${convertTwoDigits(paisePart)}` : "";

  return `${rupeeString}${paiseString} Only`;
}
