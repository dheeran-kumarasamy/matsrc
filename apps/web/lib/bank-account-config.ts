// Bank-transfer ("Standard" payment method) beneficiary details shown to the
// customer on the /orders/payment/[id] page (route moved from
// /orders/[id]/payment so the order reference number is always the last
// path segment). There is no existing bank/
// payment configuration table or admin UI for this in the current schema,
// so — per the task's guidance to introduce a clean, environment-driven
// configuration mechanism consistent with existing conventions (this repo
// already sources several server-only settings from process.env, e.g.
// SUPPLIER_PORTAL_URL / WHATSAPP_ENABLED in lib/notify.ts and
// lib/twilio-whatsapp.ts) — these are read from environment variables
// instead of being hard-coded in the frontend. Never imported by a "use
// client" component directly; always fetched from a server component/route
// handler and passed down as props.
export type BankAccountDetails = {
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branch: string;
  accountType?: string;
  mobileNo?: string;
  emailId?: string;
  upiId: string | null;
};

export function getBankAccountDetails(): BankAccountDetails {
  return {
    accountHolderName: process.env.BANK_ACCOUNT_HOLDER_NAME || "Triad Build Tech Private Limited",
    bankName: process.env.BANK_NAME || "ICICI Bank Ltd",
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || "777705678978",
    ifscCode: process.env.BANK_IFSC_CODE || "ICIC0004179",
    branch: process.env.BANK_BRANCH_NAME || "Ganapathy branch, Coimbatore",
    accountType: process.env.BANK_ACCOUNT_TYPE || "CURRENT ACCOUNT",
    mobileNo: process.env.BANK_MOBILE_NO || "9487944167",
    emailId: process.env.BANK_EMAIL_ID || "TRIADBUILDTECH@GMAIL.COM",
    upiId: process.env.BANK_UPI_ID || null,
  };
}
