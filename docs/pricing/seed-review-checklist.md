# Pricing Intelligence — Seed Review Checklist (Phase 1)

This document lists every value in the Phase 1 static reference seed data
(`packages/db/prisma/seeds/pricing/*.json`) that was deliberately left
unresolved (`null` / omitted / flagged) rather than fabricated, per the
project's "never guess a fact" rule. Nothing here blocks Phase 1 (schema +
seed loading), but **all items below must be resolved by a human before the
corresponding source/endpoint is enabled or the value is trusted downstream**
(Phase 2+).

## 1. Districts (`districts.json`) — 38 rows

All 38 Tamil Nadu districts are seeded with only `code` / `name` / `isMetro`
(publicly verifiable). The following fields are intentionally `null` on
every row and must be verified before use:

- `nameTa` (Tamil name)
- `region`
- `latitude` / `longitude`
- `desCentreCode` (TN DES cost-index centre mapping)
- `sorAreaSupplementPct`
- `anchorDistrictId` / `anchorRoadDistanceKm`

**Action:** source district centroid lat/long and DES centre-code mapping
from an authoritative government dataset before Phase 2 endpoint wiring.

## 2. Material categories (`categories.json`) — 11 families, 32 children

Every one of the 11 top-level families (and by extension their children,
which inherit nothing else) has:

- `gstRatePct: null`, `hsnCode: null` — must be confirmed against the
  current CBIC GST rate schedule/HSN classification. Historical rates noted
  in `verificationNote` (e.g. cement ~28%, TMT ~18%) are **not** to be
  trusted without confirming the live notification.
- `floorPerBaseUnit: null`, `ceilingPerBaseUnit: null` — plausibility bounds
  used for anomaly detection; must be set from real market data before
  `PricingAnomaly` (`IMPLAUSIBLE_RANGE`) checks can be meaningful.

**Design decision:** child categories (e.g. `CEMENT_OPC_43`) inherit
`baseUnit`/`displayUnit` from their parent family at seed-load time
(`seed-pricing.js`), since the JSON only specifies these at the family
level and the schema requires non-null values on every row.

## 3. Unit conversions (`unit-conversions.json`)

The seed spec originally included ~15 "ambiguous" rows (factor depends on
external context, e.g. TMT steel `rod`/`piece`/`bundle`, sand
`tonne`/`lorry`/`tipper`/`truck`, coarse aggregate `tonne`/`lorry`/`tipper`,
bricks `pallet`, tiles `box`/`carton`, paint `kg`, plumbing/electrical
`pipe`/`coil`/`roll`/`bundle`).

**Decision (confirmed by user):** these ambiguous rows were **removed
entirely** from `unit-conversions.json` rather than seeded with a null
`factor` (schema's `PricingUnitConversion.factor` is non-nullable). They are
NOT currently seeded at all. Any downstream parser that encounters one of
these unit labels must fall back to resolving quantity via the SKU's own
nominal weight/volume (e.g. TMT bar weight-per-metre by diameter) rather
than a flat conversion factor.

**Action (Phase 2+):** either (a) add a proper mechanism for
context-dependent conversions (e.g. per-SKU override table) and re-add these
rows against that mechanism, or (b) confirm they should remain permanently
unsupported by this table.

## 4. Sources (`sources.json`) — 15 rows

- `TN_PWD_SOR`, `TN_TWAD_SOR`: `baseUrl: null` — exact landing page
  unverified. Must be confirmed before any `PricingSourceEndpoint` is
  created for these sources.
- `AGNI_STEELS`, `LIVECHENNAI`, `TODAYPRICERATES`: `licenseClass:
  ATTRIBUTION_REQUIRED` but `attributionText: null` — must be set before
  `isEnabled` can be flipped to `true` (attribution text required by
  license terms).
- All 15 sources are seeded `isEnabled: false` and `tosReviewedAt: null`
  (except the 3 `MATSRC_*` internal sources, which use
  `tosReviewedAtIsNow: true` in the seed JSON — translated by
  `seed-pricing.js` into an actual `tosReviewedAt: new Date()`, since Matsrc's
  own first-party data doesn't require external ToS review).
- `MATSRC_LISTINGS`, `MATSRC_QUOTES`, `MATSRC_ORDERS`: `baseUrl: null`
  (no external URL — internal data sources), `robotsAllowed: true`.

**`defaultPriceType` inference (added per user's option 2 — not in the
original seed spec, inferred and documented here rather than left
unresolved):**

| Source | defaultPriceType | Rationale |
|---|---|---|
| TN_PWD_SOR, TN_TWAD_SOR, TNSAND, TN_DES_BCCI | `GOVT_SCHEDULE` | Government-published schedule of rates / cost index |
| AGNI_STEELS, LIVECHENNAI, TODAYPRICERATES, TATA_NEXARC, STEELONCALL, INDIAMART, TRADEINDIA, EXPORTERSINDIA | `LIST_PRICE` | Published/dealer/marketplace list prices, not confirmed transactions |
| MATSRC_LISTINGS | `TRANSACTED` | Live supplier listing prices on Matsrc's own marketplace |
| MATSRC_QUOTES | `QUOTE` | Real RFQ quote responses |
| MATSRC_ORDERS | `TRANSACTED` | Actual completed order line values (highest trust) |

**Action:** re-confirm this mapping with a human reviewer before any of
these sources is enabled; it is a reasonable categorical inference, not a
fabricated numeric fact, but should not be treated as final without sign-off.

## Enforcement reminders for later phases

- No `PricingSource` may be set `isEnabled: true` without a non-null
  `tosReviewedAt` (enforced by `seed-pricing.js` at seed time via a runtime
  check; should also be covered by a dedicated unit/integration test — see
  Phase 1 task list).
- `INTERNAL_ONLY` licensed sources (`TATA_NEXARC`, `STEELONCALL`,
  `INDIAMART`, `TRADEINDIA`, `EXPORTERSINDIA`) must never have
  `publicDisplayAllowed: true` — already seeded `false` for all five; must
  stay enforced at the API serialization layer per schema comment.
