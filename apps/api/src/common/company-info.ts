// BuildOhub's own registered-company identity, shown on Admin-generated
// Invoices and Advance Payment Receipts (invoice-pdf.util.ts /
// advance-receipt-pdf.util.ts) wherever the platform's own GSTIN/registered
// address must appear.
//
// BuildOhub is operated by its registered parent company, Triad Build Tech
// Private Limited — these are that company's real registered office
// address and GSTIN. Byte-for-byte the same content as apps/web's and
// apps/supplier's lib/company-info.ts (kept duplicated per this repo's
// existing convention of not sharing pdfkit-rendering-adjacent code across
// app boundaries — see apps/supplier/lib/pdf-fonts.ts's own header comment
// for the same rationale). This is the single place every PDF renderer in
// apps/api reads this identity from — update here only.
export const BUILDOHUB_COMPANY = {
  // Capital "O" — see the Purchase Order branding task's mandatory
  // company-name capitalization rule. Never "Buildohub". This is the
  // consumer-facing brand name; the registered legal entity name is
  // `legalName` below.
  name: "BuildOhub",
  // Registered parent company (the legal entity operating the BuildOhub
  // brand) — shown alongside `name` on GST-bearing documents.
  legalName: "Triad Build Tech Private Limited",
  // Full registered office address, including the sub-district/taluk
  // (Ganapathy, Coimbatore North), formatted to render on one address line
  // above city/state/pincode.
  addressLine: "No 87A Sathy Road, Ganapathy, Coimbatore North",
  city: "Coimbatore",
  state: "Tamil Nadu",
  pincode: "641006",
  gstin: "33AANCT3003A1Z0",
  email: null as string | null,
  phone: null as string | null,
} as const;
