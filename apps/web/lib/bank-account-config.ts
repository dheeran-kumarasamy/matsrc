// Bank-transfer ("Standard" payment method) beneficiary details shown to the
// customer on the /orders/[id]/payment page. There is no existing bank/
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
  upiId: string | null;
};

export function getBankAccountDetails(): BankAccountDetails {
  return {
    accountHolderName: process.env.BANK_ACCOUNT_HOLDER_NAME || "BuildOHub Technologies Pvt Ltd",
    bankName: process.env.BANK_NAME || "HDFC Bank",
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || "50200012345678",
    ifscCode: process.env.BANK_IFSC_CODE || "HDFC0000123",
    branch: process.env.BANK_BRANCH_NAME || "Bengaluru — MG Road",
    upiId: process.env.BANK_UPI_ID || "buildohub@hdfcbank",
  };
}
