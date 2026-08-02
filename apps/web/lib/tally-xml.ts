// Tally-compatible Purchase Voucher XML generation (India/GST context).
// One <VOUCHER> per order/invoice. CGST+SGST is used for intra-state
// purchases (builder site state == supplier state), IGST for inter-state.
// State is derived primarily from the first two digits of each party's
// GSTIN (the official GST state code) since that is the authoritative
// source; falls back to comparing the free-text Site.state / nothing if
// GSTIN is unavailable for either party (treated as intra-state/CGST+SGST,
// the more common default for small suppliers who haven't filled in GSTIN
// yet — never blocks export, only surfaced as an informational note).

export type TallyLedgerMappingConfig = {
  companyName: string;
  purchaseLedger: string;
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
  roundOffLedger: string;
  supplierLedgerMap: Record<string, string>;
};

export type TallyVoucherLineItem = {
  productName: string;
  hsnCode: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  taxableValue: number;
  taxRatePercent: number;
  gstAmount: number;
};

export type TallyVoucherInput = {
  orderId: string;
  orderDate: Date;
  supplierId: string;
  supplierName: string;
  supplierGstin: string | null;
  siteState: string | null;
  siteGstin: string | null;
  lineItems: TallyVoucherLineItem[];
  total: number;
};

export type TallyValidationBlocker = {
  orderId: string;
  reason: string;
};

export type TallyDryRunResult = {
  voucherCount: number;
  totalValue: number;
  blockers: TallyValidationBlocker[];
};

function gstStateCode(gstin: string | null | undefined): string | null {
  if (!gstin || gstin.length < 2) return null;
  return gstin.slice(0, 2);
}

export function isIntraState(supplierGstin: string | null, siteGstin: string | null): boolean {
  const supplierCode = gstStateCode(supplierGstin);
  const siteCode = gstStateCode(siteGstin);
  if (supplierCode && siteCode) {
    return supplierCode === siteCode;
  }
  // Insufficient data to determine — default to intra-state (CGST+SGST),
  // the more common case for small/local suppliers.
  return true;
}

function escapeXml(value: string | number): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function formatTallyDate(date: Date): string {
  // Tally expects YYYYMMDD
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Validates that every order's supplier has a configured Tally party ledger
// mapping. Returns blockers (unmapped suppliers) without generating any XML.
export function validateVouchers(
  vouchers: TallyVoucherInput[],
  mapping: TallyLedgerMappingConfig
): TallyDryRunResult {
  const blockers: TallyValidationBlocker[] = [];
  let totalValue = 0;

  for (const voucher of vouchers) {
    totalValue += voucher.total;
    if (!mapping.supplierLedgerMap[voucher.supplierId]) {
      blockers.push({
        orderId: voucher.orderId,
        reason: `No Tally party ledger mapped for supplier "${voucher.supplierName}". Configure it in Tally Settings before exporting.`,
      });
    }
  }

  return {
    voucherCount: vouchers.length,
    totalValue: round2(totalValue),
    blockers,
  };
}

// Builds a single .xml document (root <ENVELOPE> containing one <VOUCHER>
// per order) importable into TallyPrime / Tally.ERP 9 via
// Gateway of Tally > Import Data > XML.
export function buildTallyImportXml(
  vouchers: TallyVoucherInput[],
  mapping: TallyLedgerMappingConfig
): string {
  const voucherXmls = vouchers.map((voucher) => buildSingleVoucherXml(voucher, mapping)).join("\n");

  return `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${escapeXml(mapping.companyName)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${voucherXmls}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;
}

function buildSingleVoucherXml(voucher: TallyVoucherInput, mapping: TallyLedgerMappingConfig): string {
  const partyLedger = mapping.supplierLedgerMap[voucher.supplierId] ?? voucher.supplierName;
  const intraState = isIntraState(voucher.supplierGstin, voucher.siteGstin);
  const voucherNumber = voucher.orderId.slice(0, 12);
  const date = formatTallyDate(voucher.orderDate);

  const totalTaxable = round2(voucher.lineItems.reduce((s, li) => s + li.taxableValue, 0));
  const totalGst = round2(voucher.lineItems.reduce((s, li) => s + li.gstAmount, 0));
  const grossTotal = round2(totalTaxable + totalGst);

  // Debits = credits: party ledger is debited (positive/DR from a purchase
  // perspective in Tally's XML convention, amount is negative for the
  // debit-side ledger entry per Tally's XML sign convention where credit
  // amounts are positive and debit amounts are negative) the full gross
  // total; purchase + tax ledgers are credited for their respective shares.
  // Round-off ledger absorbs any residual paisa-level rounding difference
  // so the voucher always balances exactly.
  const roundOff = round2(grossTotal - (totalTaxable + totalGst));

  const ledgerEntries: string[] = [];

  // Party (supplier) ledger — debit (negative amount in Tally XML convention)
  ledgerEntries.push(
    `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(partyLedger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <AMOUNT>-${grossTotal.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`
  );

  // Purchase ledger — credit (positive)
  ledgerEntries.push(
    `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(mapping.purchaseLedger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>${totalTaxable.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`
  );

  if (totalGst > 0) {
    if (intraState) {
      const half = round2(totalGst / 2);
      ledgerEntries.push(
        `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(mapping.cgstLedger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>${half.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`
      );
      ledgerEntries.push(
        `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(mapping.sgstLedger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>${(totalGst - half).toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`
      );
    } else {
      ledgerEntries.push(
        `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(mapping.igstLedger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>${totalGst.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`
      );
    }
  }

  if (Math.abs(roundOff) >= 0.01) {
    ledgerEntries.push(
      `      <ALLLEDGERENTRIES.LIST>
       <LEDGERNAME>${escapeXml(mapping.roundOffLedger)}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <AMOUNT>${roundOff.toFixed(2)}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`
    );
  }

  const inventoryEntries = voucher.lineItems
    .map(
      (li) => `      <ALLINVENTORYENTRIES.LIST>
       <STOCKITEMNAME>${escapeXml(li.productName)}</STOCKITEMNAME>
       <HSNCODE>${escapeXml(li.hsnCode ?? "")}</HSNCODE>
       <RATE>${li.unitPrice.toFixed(2)}/${escapeXml(li.unit)}</RATE>
       <AMOUNT>${li.taxableValue.toFixed(2)}</AMOUNT>
       <ACTUALQTY>${li.quantity} ${escapeXml(li.unit)}</ACTUALQTY>
       <BILLEDQTY>${li.quantity} ${escapeXml(li.unit)}</BILLEDQTY>
      </ALLINVENTORYENTRIES.LIST>`
    )
    .join("\n");

  return `    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Purchase" ACTION="Create">
      <DATE>${date}</DATE>
      <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
      <VOUCHERNUMBER>${escapeXml(voucherNumber)}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${escapeXml(partyLedger)}</PARTYLEDGERNAME>
      <NARRATION>Buildohub order ${escapeXml(voucher.orderId)}</NARRATION>
${inventoryEntries}
${ledgerEntries.join("\n")}
     </VOUCHER>
    </TALLYMESSAGE>`;
}
