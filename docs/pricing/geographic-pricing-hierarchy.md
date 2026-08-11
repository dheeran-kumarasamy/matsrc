# Phase 6F — Geographic Pricing Hierarchy

## Purpose

District-Wise Price Intelligence assumed every price observation had to be
district-specific. That assumption is too restrictive: a legitimate source
may only publish a state-wide or national price (e.g. a manufacturer's
single published rate list covering all of Tamil Nadu). This document
describes the geographic hierarchy introduced to represent that correctly,
without ever inventing a false district-level precision.

## Geographic levels

```
DISTRICT   — a price explicitly tied to one PricingDistrict.
STATE      — a price explicitly tied to one PricingState, no district.
NATIONAL   — a price with no state/district applicability at all.
```

Modeled as the `PricingGeographyLevel` enum (`packages/db/prisma/schema.prisma`).

## Resolution order

```
DISTRICT > STATE > NATIONAL
```

`PricingResolutionService.resolveBestAvailablePrice(canonicalSkuId, districtId, asOfDate)`
(`apps/api/src/pricing/pricing-resolution.service.ts`) is the single place
this precedence is implemented. Every caller (public API, Builder
district-pricing route, watchlist bridge, alert engine) should route through
it (or the equivalent DISTRICT→STATE query pair, where a service cannot take
a NestJS dependency) rather than re-implementing the fallback.

At every level, a candidate row must additionally be:
- `publicDisplayAllowed = true` (compliance gate — see "Compliance" below)
- not stale beyond the existing 72-hour freshness threshold (same threshold
  `alert-eligibility.util.ts` already uses)

## Example

```
Query: Erode, Tamil Nadu

Available:
  Erode district price:     none
  Tamil Nadu state price:   ₹72,730
  India national price:     ₹75,000

Result:
  ₹72,730
  Geographic level: STATE
  Geography: Tamil Nadu
  Fallback used: true
  Fallback reason: NO_DISTRICT_PRICE_AVAILABLE
```

The response is never `Erode = ₹72,730` — that would misrepresent a
state-wide observation as district-specific.

## What is prohibited

- Assigning a state-wide price to a specific district.
- Using a source's registered company address as the price's geographic
  applicability.
- Defaulting an unresolved geography to Chennai, the first district, or the
  project's district.
- Copying one state-level row into 38 per-district rows.
- Inferring `geographyLevel` from a page title, IP address, or a city
  mention in free text (`rawLocationText`) without an explicit source signal.

## Schema

New/changed models (`packages/db/prisma/schema.prisma`,
migration `20260810130725_add_pricing_geographic_hierarchy`):

- `PricingState` (new) — one row per state in scope. Only Tamil Nadu exists
  today (backfilled deterministically from the pre-existing all-TN
  `PricingDistrict` table); no other state row has been created.
- `PricingDistrict.stateId` (new, non-null FK to `PricingState`).
- `PricingObservation`, `PricingDistrictPriceDaily`, `PricingTrendMonthly`:
  `geographyLevel` (non-null), `stateId` (nullable FK), `districtId`
  (now nullable FK). A CHECK constraint on each table enforces:
  ```
  DISTRICT  -> stateId NOT NULL, districtId NOT NULL
  STATE     -> stateId NOT NULL, districtId NULL
  NATIONAL  -> stateId NULL,     districtId NULL
  ```
- `PricingDistrictPriceDaily.geoKey` / `PricingTrendMonthly.geoKey` (new) —
  a deterministic, always-non-null string (districtId, else stateId, else
  the literal `"NATIONAL"`) used purely so the uniqueness constraint can
  dedupe correctly (Postgres treats `NULL` as distinct in unique indexes, so
  a raw `[districtId, stateId, ...]` unique key would silently allow
  duplicate STATE/NATIONAL rows for the same SKU/day).
- `PricingAlertEvaluation`: `geographyLevel`/`stateId` (nullable — a
  suppressed-before-resolution row has no geography to record), `districtId`
  now nullable.
- `PricingSourceEndpoint`: `geographyLevel`/`stateId` (nullable) — a
  source's *declared* geographic applicability, independent of any
  per-district URL pattern the endpoint may also carry.
- `PricingRawObservation.rawGeographyLevel` (nullable) — preserves explicit
  source-declared geography evidence at ingestion time, when the source
  provides it. Never derived from `rawLocationText`.

## Migration safety

Verified immediately before migration:

| Table | Rows |
|---|---|
| `PricingObservation` | 0 |
| `PricingDistrictPriceDaily` | 0 |
| `PricingTrendMonthly` | 0 |
| `PricingAlertEvaluation` | 0 |
| `PricingRawObservation` | 23 (all `JINDAL_PANTHER`, `rawLocationText="Delhi"`, `parseStatus=PENDING`) |
| `PricingDistrict` | 38 (all Tamil Nadu) |

Because the four serving/normalized-layer tables were empty, backfilling
carried zero risk of misclassifying real historical district data. The one
real backfill — `PricingDistrict.stateId = Tamil Nadu` for all 38 rows — is
safe and deterministic because this table has only ever contained Tamil
Nadu districts. The 23 pending JINDAL raw rows were left completely
untouched (still `PENDING`, still `rawLocationText="Delhi"`,
`rawGeographyLevel` still `null`) — nothing in this migration normalizes
them into any geography.

## Normalization

`PricingNormalizationService.normalizeBatch()`
(`apps/api/src/pricing/pricing-normalization.service.ts`) now takes an
explicit `NormalizationGeographyContext`:

```ts
{ geographyLevel: "DISTRICT"; districtId: string }
{ geographyLevel: "STATE"; stateId: string }
{ geographyLevel: "NATIONAL" }
```

The caller must already know this from source-declared applicability — the
service never infers it from `rawLocationText`, company address, or any
other heuristic. A bare `districtId` string is still accepted for backward
compatibility (equivalent to `{ geographyLevel: "DISTRICT", districtId }`).
If a `DISTRICT` context's `districtId` doesn't resolve to a real
`PricingDistrict`, the row is quarantined rather than guessing a state.

## Rollups

`PricingDailyRollupService`/`PricingMonthlyRollupService` group strictly by
`(canonicalSkuId, geographyLevel, stateId, districtId)`. A DISTRICT
observation and a STATE observation for the same SKU/day always produce two
separate rows — never merged, never derived from one another. Districtwide
anchor-based derivation (`DERIVED_INDEX`/`DERIVED_FREIGHT`) applies only to
DISTRICT rows; there is no "anchor state" concept.

## AGNI example

AGNI_STEELS's published price list is state-wide (Tamil Nadu), not
district-specific, even though the company's registered address is in
Erode. Once ToS/compliance approval is separately granted, AGNI's rows
should be normalized as:

```
geographyLevel = STATE
stateId        = Tamil Nadu
districtId     = NULL
```

Never as `districtId = Erode` (the registered address) or `districtId =
Chennai` (a mentioned metro). This document's implementation makes that
representation technically possible; it does not itself enable AGNI_STEELS,
approve its ToS, or weaken
`packages/db/scripts/verify-pricing-source-compliance.js`.

## JINDAL handling

JINDAL_PANTHER's raw data is Delhi-market (`rawLocationText="Delhi"`). Delhi
is out of the current Tamil-Nadu production scope. This phase does not
create a Delhi `PricingState`/`PricingDistrict`, and the 23 existing JINDAL
raw rows remain untouched and unnormalized. The architecture is capable of
representing Delhi geography (any state can exist as a `PricingState` row)
without that being part of the TN production dataset today.
