// BuildOhub's own identity as the BUYER on a supplier-facing Purchase Order
// (BuildOhub purchases goods from suppliers; see
// app/api/supplier/purchase-orders/[id]/export/route.ts's renderPoPdf), and
// as the operating platform shown on Invoices and Advance Payment Receipts.
//
// BuildOhub is operated by its registered parent company, Triad Build Tech
// Private Limited — these are that company's real registered office
// address and GSTIN, used wherever the platform's own GST-bearing identity
// must appear (Purchase Orders, Invoices, Advance Payment Receipts, and any
// other document requiring a GSTIN). This is the single place both the
// supplier-portal and builder-portal PO renderers read the buyer identity
// from — update here only. Byte-for-byte the same content as apps/web's
// lib/company-info.ts (kept duplicated per this repo's existing
// convention of not sharing pdfkit-rendering-adjacent code across the
// apps/web / apps/supplier boundary — see apps/supplier/lib/pdf-fonts.ts's
// own header comment for the same rationale).
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
  // above city/state/pincode (mirrors every other party block's layout).
  addressLine: "No 87A Sathy Road, Ganapathy, Coimbatore North",
  city: "Coimbatore",
  state: "Tamil Nadu",
  pincode: "641006",
  gstin: "33AANCT3003A1Z0",
  email: null as string | null,
  phone: null as string | null,
} as const;
