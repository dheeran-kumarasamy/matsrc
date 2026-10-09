// packages/db/lib/business-number.ts
//
// New EQ, OD, IN and AP Business Numbering implementation.
//
// Formats:
//   EQ/YYMM/SSSSS  (Enquiry)
//   OD/YYMM/SSSSS  (Order)
//   IN/YYMM/SSSSS  (Invoice)
//   AP/YYMM/SSSSS  (Advance Payment — Buildohub Advance Balance)
//
// Where:
//   YY    = 2-digit financial-year start year (April–March)
//   MM    = 2-digit financial-year month (April=01, May=02 ... March=12)
//   SSSSS = 5-digit zero-padded sequential serial per (type + FY)
//
// AP uses its own independent BusinessSequence row (key "AP_<fy>") — it
// never shares or perturbs the EQ/OD/IN counters.

export const EQ_REGEX = /^EQ\/[0-9]{4,6}\/[0-9]{5}$/;
export const OD_REGEX = /^OD\/[0-9]{4,6}\/[0-9]{5}$/;
export const IN_REGEX = /^IN\/[0-9]{4,6}\/[0-9]{5}$/;
export const AP_REGEX = /^AP\/[0-9]{4,6}\/[0-9]{5}$/;

export function validateBusinessNumber(type: "EQ" | "OD" | "IN" | "AP", value: string): boolean {
  if (type === "EQ") return EQ_REGEX.test(value);
  if (type === "OD") return OD_REGEX.test(value);
  if (type === "IN") return IN_REGEX.test(value);
  if (type === "AP") return AP_REGEX.test(value);
  return false;
}

export function getFinancialYearMonth(date: Date = new Date()): {
  fyStartYear: number;
  fyMonth: number;
  fyShort: string;
  fyMonthStr: string;
  yymm: string;
} {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed: 0=Jan, 3=Apr, 11=Dec

  let fyStartYear: number;
  let fyMonth: number;

  if (month >= 3) {
    // April (3) to December (11)
    fyStartYear = year;
    fyMonth = month - 3 + 1; // Apr -> 1, May -> 2, ..., Dec -> 9
  } else {
    // January (0) to March (2)
    fyStartYear = year - 1;
    fyMonth = month + 9 + 1; // Jan -> 10, Feb -> 11, Mar -> 12
  }

  const fyShort = String(fyStartYear % 100).padStart(2, "0");
  const fyMonthStr = String(fyMonth).padStart(2, "0");
  const yymm = `${fyShort}${fyMonthStr}`;

  return { fyStartYear, fyMonth, fyShort, fyMonthStr, yymm };
}

type TxClient = {
  $queryRaw: (...args: any[]) => Promise<any>;
  businessSequence: {
    upsert: (args: any) => Promise<any>;
    update: (args: any) => Promise<{ value: number }>;
  };
};

/**
 * Atomically increments and returns the next serial number for a given
 * identifier type ("EQ" | "OD" | "IN") and financial year. Takes a row lock
 * (`SELECT ... FOR UPDATE`) on the corresponding BusinessSequence row so
 * concurrent requests can never be handed duplicate serial numbers.
 */
export async function nextBusinessSequence(
  tx: TxClient,
  type: "EQ" | "OD" | "IN" | "AP",
  date: Date = new Date()
): Promise<{ serial: number; yymm: string }> {
  const { fyShort, yymm } = getFinancialYearMonth(date);
  const key = `${type}_${fyShort}`;

  await tx.businessSequence.upsert({
    where: { id: key },
    update: {},
    create: { id: key, type, fy: fyShort, value: 0 },
  });

  await tx.$queryRaw`SELECT "value" FROM "BusinessSequence" WHERE "id" = ${key} FOR UPDATE`;

  const updated = await tx.businessSequence.update({
    where: { id: key },
    data: { value: { increment: 1 } },
    select: { value: true },
  });

  if (updated.value > 99999) {
    throw new Error(
      `${type} serial ${updated.value} exceeds the 5-digit serial capacity (max 99999) for FY ${fyShort}. ` +
        "Refusing to truncate or reuse serial numbers."
    );
  }

  return { serial: updated.value, yymm };
}

export async function generateBusinessNumber(
  tx: TxClient,
  type: "EQ" | "OD" | "IN" | "AP",
  date: Date = new Date()
): Promise<string> {
  const { serial, yymm } = await nextBusinessSequence(tx, type, date);
  const paddedSerial = String(serial).padStart(5, "0");
  return `${type}/${yymm}/${paddedSerial}`;
}

export async function generateEnquiryNumber(
  tx: TxClient,
  date: Date = new Date()
): Promise<string> {
  return generateBusinessNumber(tx, "EQ", date);
}

export async function generateOrderNumber(
  tx: TxClient,
  date: Date = new Date()
): Promise<string> {
  return generateBusinessNumber(tx, "OD", date);
}

export async function generateInvoiceNumber(
  tx: TxClient,
  date: Date = new Date()
): Promise<string> {
  return generateBusinessNumber(tx, "IN", date);
}

// Advance Payment reference number (e.g. "AP/2601/00001") — the Buildohub
// Advance Balance's own independent serial sequence (BusinessSequence key
// "AP_<fy>"). Never reuses or perturbs the EQ/OD/IN counters.
export async function generateAdvancePaymentNumber(
  tx: TxClient,
  date: Date = new Date()
): Promise<string> {
  return generateBusinessNumber(tx, "AP", date);
}
