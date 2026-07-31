# Site-wise Purchase Reports + Tally Integration (Builder Portal)

## Summary

Adds two linked capabilities to the Builder ("Customer") portal in `apps/web`:

1. **Site-wise purchase reports** — builders can tag orders to a construction
   site and generate a filterable, exportable (CSV/XLSX/PDF) report of
   everything purchased through Matsrc, broken down by site, supplier,
   category, and time.
2. **Tally integration** — builders (or their accountants) can export a
   Tally-compatible Purchase Voucher XML file (India/GST context: GSTIN,
   HSN, CGST/SGST/IGST) importable directly into TallyPrime / Tally.ERP 9
   via *Gateway of Tally → Import Data → XML*.

All new code lives in `apps/web` and follows the existing direct-Prisma,
builder-scoped API route convention (`apps/web/app/api/builder/**`) — no
changes were made to the NestJS `apps/api` backend.

## Schema changes (additive, reversible)

Migration: `20260731125244_add_sites_and_tally_gst_fields`

- New `Site` model (`builderId, name, code, addressLine, city, state,
  pincode, gstin, status`) + `SiteStatus` enum (`ACTIVE | ARCHIVED`).
- New nullable `Order.siteId` FK → `Site` (nullable, so all existing
  historical orders remain valid/unaffected — "Unassigned" is a supported
  filter value everywhere).
- New nullable `SupplierProfile.gstin`, `Product.hsnCode`,
  `OrderItem.taxRatePercent` (Decimal(5,2), defaults to 18% in application
  code when null, for orders placed before this field existed).
- New `TallyLedgerMapping` model (one row per builder, unique on
  `builderId`) storing the builder's Tally company name, default ledger
  names for purchase/CGST/SGST/IGST/round-off, and a `supplierLedgerMap`
  JSON map of `supplierId -> Tally party ledger name`.

No existing columns were altered or dropped. No existing queries were
changed in a way that could break current workflows.

## New builder-facing pages

- `/reports/site-wise` — Site-wise Purchase Report: filter bar (site, date
  range, supplier, status, category), KPI cards, spend-by-site breakdown,
  charts (spend by supplier, spend over time), paginated line-item detail
  table, and CSV/XLSX/PDF export buttons.
- `/reports/site-wise/tally` — Tally Settings & Export: editable ledger
  mapping (company name + purchase/CGST/SGST/IGST/round-off ledger names +
  per-supplier party ledger names), a "Validate Export" dry-run button, and
  a "Download Tally XML" button (disabled until validation passes).
- Both are linked from the main `/reports` page and are protected by the
  existing `/reports` prefix in `middleware.ts` (no middleware changes were
  needed).

## New API routes (all builder-scoped, `force-dynamic`, never cached)

- `GET /api/builder/reports/site-wise` — paginated JSON report.
- `GET /api/builder/reports/site-wise/export?format=csv|xlsx|pdf` — full
  export of all matching rows (no pagination).
- `GET /api/builder/tally/ledger-mapping` / `PATCH ...` — read/update the
  builder's Tally settings.
- `GET /api/builder/tally/dry-run` — validates that every supplier in the
  filtered order set has a configured Tally ledger; returns blockers
  without generating XML.
- `GET /api/builder/tally/export` — generates and downloads the Tally XML;
  re-validates and blocks (409) if any supplier is unmapped; writes an
  `AuditLog` entry (`TALLY_EXPORT`) on success.

## Key design decisions

- **Defaults to PAID orders only** for Tally export (overridable via
  `status` query param) — since only paid orders represent confirmed
  accounting transactions.
- **Money is always computed server-side** from `OrderItem.quantity *
  OrderItem.unitPrice` (+ `taxRatePercent`, default 18% if not set on older
  rows) — client input is never trusted for report or XML totals.
- **Intra- vs inter-state GST** is determined by comparing the first two
  digits (official GST state code) of the supplier's and the site's GSTIN.
  If either GSTIN is missing, defaults to intra-state (CGST+SGST) as the
  more common case for small/local suppliers — this never blocks export,
  it's just the safer accounting default until GSTINs are filled in.
- **Round-off ledger** absorbs any residual paisa-level difference so every
  voucher balances exactly (debits = credits), even with odd 50/50 CGST/SGST
  splits.
- **Multi-supplier orders** (shouldn't normally occur, since checkout groups
  items per-supplier) are conservatively attributed to the first line item's
  supplier — documented inline, not a blocking ambiguity.

## Testing

- `pnpm --filter @matsrc/web exec tsc --noEmit` — passes with zero errors.
- `pnpm --filter @matsrc/web exec vitest run` — 25/25 tests passing,
  including 15 new tests in `apps/web/lib/tally-xml.spec.ts` covering:
  - `isIntraState` GST state-code comparison (match / mismatch / missing
    GSTIN on either or both sides).
  - `validateVouchers` blocker detection for unmapped suppliers and
    correct total-value aggregation.
  - `buildTallyImportXml` structural correctness (one `<VOUCHER>` per
    order, correct CGST+SGST vs IGST selection), XML escaping, and —
    critically — **debit/credit balancing to zero** for every voucher,
    including an intentionally "odd-paisa" GST split case and a
    multi-voucher batch where each voucher is checked independently.
- A sample generated file is included at `docs/sample-tally-export.xml`
  (two vouchers: one intra-state CGST+SGST, one inter-state IGST) generated
  directly from the real `buildTallyImportXml` function for review.

## Manual QA checklist (for reviewer / before merge)

- [ ] Create a new Site under `/sites`, place an order, tag it to the site
      (either at checkout or retroactively from the order detail page).
- [ ] Visit `/reports/site-wise`, filter by that site, confirm totals match
      the order.
- [ ] Export CSV / XLSX / PDF and confirm the numbers match the on-screen
      summary.
- [ ] Visit `/reports/site-wise/tally`, set a company name and map the
      order's supplier to a ledger name, click "Validate Export" (should
      show 0 blockers), then "Download Tally XML" and confirm the file
      downloads.
- [ ] Attempt a Tally export filter that includes an order whose supplier
      is *not* yet mapped — confirm the dry-run surfaces a blocker and the
      download button stays disabled; also confirm hitting the export
      endpoint directly returns 409.
- [ ] Confirm orders without a `siteId` still appear correctly under the
      "Unassigned" filter option everywhere (report, Tally export).
- [ ] (Optional, in TallyPrime/Tally.ERP 9) Import
      `docs/sample-tally-export.xml` via *Gateway of Tally → Import Data →
      XML* and confirm two Purchase vouchers are created correctly with
      balanced CGST/SGST and IGST entries respectively.

## Known follow-ups (not blocking, tracked for a future iteration)

- CSV/XLSX/PDF report exports do not yet write an `AuditLog` entry (only
  the Tally XML export does). Could be added if financial-export auditing
  is required for these formats too.
- No end-to-end/integration test harness exists yet for the full
  create-site → tag-order → report → export flow; current test coverage is
  unit-level (pure XML/GST logic). Aggregation math in
  `site-wise-report.ts` and `tally-vouchers.ts` is Prisma-backed and would
  need either a test database or a mocked Prisma client to unit test
  directly.
