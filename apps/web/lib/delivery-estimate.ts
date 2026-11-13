// C13 — Delivery timing visibility while browsing.
//
// Investigation summary (see task C13): the schema has NO per-listing/
// per-product delivery estimate. `SupplierQuote.leadTimeDays` (packages/db/
// prisma/schema.prisma) only exists on a quote created AFTER an enquiry is
// submitted and a supplier has responded — never at browsing/PLP time — and
// the AI Sourcing Assistant's `estimatedDeliveryDays` is likewise derived
// only from a real SupplierQuote.leadTimeDays when one already exists
// (apps/web/lib/sourcing/supplier-search.ts), explicitly null otherwise ("no
// supplier delivery-capability or lead-time model exists... never a
// default"). So no reliable numeric delivery estimate can be shown on the
// PLP/quick-view without fabricating one.
//
// This mirrors the app's own existing, truthful framing for this exact gap —
// see components/products/EnquiryPanel.tsx ("Checkout will submit a supplier
// enquiry, not a payment.") and components/orders/OrderDetailOverlay.tsx
// ("This order starts as a supplier enquiry and becomes payable after
// supplier confirmation.") — applied to delivery timing specifically.
export const DELIVERY_TIMING_BROWSING_NOTE = "Delivery timing confirmed after supplier accepts";
