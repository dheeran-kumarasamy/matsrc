// BuildOhub's own identity as the BUYER on a supplier-facing Purchase Order
// (BuildOhub purchases goods from suppliers; see
// app/api/builder/purchase-orders/[id]/export/route.ts's renderPoPdf).
//
// There is currently no authoritative BuildOhub registered-office address,
// GSTIN, or support-contact field anywhere in the database schema or
// environment configuration (confirmed by inspecting prisma/schema.prisma
// and every apps/*/.env* file) — this is a genuine data gap, not an
// oversight in this file. Per the task's "do not invent missing
// addresses/GSTINs" requirement, the optional fields below are left
// `null` rather than filled with a plausible-looking placeholder value,
// and the PDF renderer shows an explicit "Not configured" label for any
// null field instead of silently omitting the line or fabricating data.
//
// If/when BuildOhub's registered address and GSTIN become available (e.g.
// from a future company-settings table or env vars), fill them in here —
// this is the single place both the supplier-portal and builder-portal PO
// renderers read the buyer identity from, so there is nowhere else to
// update.
export const BUILDOHUB_COMPANY = {
  // Capital "O" — see the Purchase Order branding task's mandatory
  // company-name capitalization rule. Never "Buildohub".
  name: "BuildOhub",
  addressLine: null as string | null,
  city: null as string | null,
  state: null as string | null,
  pincode: null as string | null,
  gstin: null as string | null,
  email: null as string | null,
  phone: null as string | null,
} as const;
