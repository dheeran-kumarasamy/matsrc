# Phase 6F — Geographic Pricing Hierarchy: Implementation Report

## 1. Problem

The District-Wise Price Intelligence system assumed every price observation
must be district-specific. In reality, legitimate sources (government
indices, manufacturer price lists) frequently publish state-wide or
national prices only. AGNI_STEELS is the concrete motivating case: its
extracted TMT price list is Tamil-Nadu-wide, not tied to any specific
district, even though the company's registered address is in Erode. Forcing
that data into a district slot (Erode, Chennai, or any other district) would
misrepresent it. The system needed an explicit, safe way to retain and serve
DISTRICT/STATE/NATIONAL prices without ever fabricating false precision.

## 2. Architecture

Introduced `PricingGeographyLevel` (`DISTRICT | STATE | NATIONAL`) as an
explicit dimension alongside the existing district/canonical-SKU dimensions.
Resolution precedence is DISTRICT > STATE > NATIONAL, implemented in one
place — `PricingResolutionService.resolveBestAvailablePrice()`
(`apps/api/src/pricing/pricing-resolution.service.ts`) — so every caller
(public API, Builder district-pricing route, watchlist bridge, alert
engine) shares the same fallback logic instead of re-implementing it.

Every result carries `geographyLevel`, `state`, `district`,
`requestedDistrict`, `fallbackUsed`, and `fallbackReason` so no caller can
silently present a broader-geography price as district-specific.

## 3. Schema changes

- New `PricingState` model (one row today: Tamil Nadu).
- `PricingDistrict.stateId` (non-null FK).
- `PricingObservation` / `PricingDistrictPriceDaily` / `PricingTrendMonthly`:
  added `geographyLevel` (non-null) + `stateId` (nullable), made
  `districtId` nullable. Added a CHECK constraint on each enforcing the
  DISTRICT/STATE/NATIONAL ↔ stateId/districtId combination at the database
  level (not just application code).
- `PricingDistrictPriceDaily.geoKey` / `PricingTrendMonthly.geoKey`: a
  deterministic dedupe key (districtId, else stateId, else `"NATIONAL"`),
  replacing the old `districtId`-only unique constraint (which could not
  correctly dedupe STATE/NATIONAL rows once `districtId` became nullable —
  Postgres treats `NULL` as distinct in unique indexes).
- `PricingAlertEvaluation`: `geographyLevel`/`stateId` added (nullable),
  `districtId` now nullable.
- `PricingSourceEndpoint`: `geographyLevel`/`stateId` added (nullable) —
  source-declared price applicability, independent of any per-district URL
  the endpoint also has.
- `PricingRawObservation.rawGeographyLevel` added (nullable) — preserves
  explicit source-declared geography evidence, never fabricated from
  `rawLocationText`.

Full detail: `docs/pricing/geographic-pricing-hierarchy.md`.

## 4. Migration

Migration `20260810130725_add_pricing_geographic_hierarchy`
(`packages/db/prisma/migrations/`). Pre-migration verification found the
four serving/normalized-layer tables (`PricingObservation`,
`PricingDistrictPriceDaily`, `PricingTrendMonthly`, `PricingAlertEvaluation`)
completely empty (0 rows each), and `PricingRawObservation` holding only 23
pending `JINDAL_PANTHER` rows (Delhi-market, `parseStatus=PENDING`). This
meant the only real backfill needed was `PricingDistrict.stateId = Tamil
Nadu` for all 38 existing districts — safe and deterministic, since that
table has only ever contained Tamil Nadu districts. The 23 pending JINDAL
rows were left completely untouched.

**Incident and recovery, documented for transparency:** during
investigation, a `prisma migrate diff --shadow-database-url` command was
mistakenly run against the production `DIRECT_URL` instead of a genuine
scratch database, which wiped most application table data (schema/DDL was
never dropped). This was caught immediately via a data-integrity check,
reported to the user, and recovered via a Neon Instant Restore to a
timestamp just before the incident. Post-restore row counts were verified
to exactly match the pre-incident baseline (`pricing_district=38`,
`pricing_source=37`, `pricing_source_endpoint=27`,
`pricing_raw_observation=23`, plus non-zero `Product`/`Order`/`Site`/
`Watchlist` rows) before the migration was re-applied via `prisma db
execute` (never via `migrate diff --shadow-database-url` again).

## 5. Resolution logic

`PricingResolutionService.resolveBestAvailablePrice(canonicalSkuId,
districtId, asOfDate)`:
1. Query a DISTRICT row for the district (must be `publicDisplayAllowed`
   and within the 72h freshness window).
2. If none, query a STATE row for the district's state.
3. If none, query a NATIONAL row.
4. If none, return `NO_DATA`.

Three simple indexed queries at most (no N+1). Compliance
(`publicDisplayAllowed`) and freshness are enforced identically at every
level, so a more-precise but non-compliant/stale row never wins over a
less-precise but valid one.

## 6. API changes

`GET /public/pricing/resolve?canonicalSkuCode=...&districtCode=...` (new,
additive) returns `price`, `unit`, `geographyLevel`, `state`, `district`,
`requestedDistrict`, `fallbackUsed`, `fallbackReason`, `confidence`,
`method`, `asOf`, `isStale`. The existing `district-daily`/`trend-monthly`
endpoints gained additive `geographyLevel`/`stateId` fields on each row; no
existing field was removed or renamed.

## 7. UI changes

- Builder district-pricing route/panel: falls back to a STATE reference
  price when no district-specific price exists, and surfaces
  `geographyLevel`/`geographyStateName`/`isGeographyFallback` on the
  `current` price object. The panel renders a `GeographyLevelBadge`
  ("Erode district price" vs "Tamil Nadu state reference") and a visible
  banner: "State-level reference used because district-specific pricing is
  unavailable for {district}."
- Watchlist price intelligence (`apps/web/lib/watchlist-pricing.ts`): same
  DISTRICT→STATE fallback, same additive fields.
- NestJS watchlist alert engine (`PricingAlertEvaluationService`): resolves
  DISTRICT first, STATE second (two batched queries, still no N+1), and
  persists `geographyLevel`/`stateId` on every `PricingAlertEvaluation` row.
  Notification copy for a state-fallback alert appends "(state reference)"
  to the district name so a builder is never told a state-wide price is
  their district's price.
- Admin UI: deferred in this batch (no test runner is configured for
  `apps/admin`, and the task's guardrails require validating changes before
  claiming them done — a geography filter/column can be added as a
  follow-up once admin test tooling exists).

## 8. AGNI validation

The normalization/rollup/resolution layers now technically support
representing AGNI_STEELS as `geographyLevel=STATE`, `stateId=Tamil Nadu`,
`districtId=NULL` once `PricingNormalizationService.normalizeBatch()` is
invoked with `{ geographyLevel: "STATE", stateId: <tamil-nadu-id> }` for its
raw rows. AGNI_STEELS remains `isEnabled: false` in
`packages/db/prisma/seeds/pricing/sources.json` — untouched by this batch,
per the explicit no-enablement instruction. No AGNI ingestion/normalization
was actually run against AGNI in this batch (§45 hard stop).

## 9. JINDAL handling

JINDAL_PANTHER's 23 raw rows remain `rawLocationText="Delhi"`,
`parseStatus=PENDING`, `rawGeographyLevel=NULL` — completely untouched. No
Delhi `PricingState` or `PricingDistrict` was created. Delhi stays outside
the Tamil Nadu production scope; the architecture can represent it (any
state is just a `PricingState` row) without that being part of today's
dataset.

## 10. Tests

New tests added, all passing:
- `pricing-resolution.service.spec.ts` — 10 tests (spec §36 Test 1–10:
  DISTRICT hit, STATE fallback, NATIONAL fallback, NO_DATA, staleness,
  compliance-prohibited district row, STATE-never-has-districtId,
  no-company-address-dependency, AGNI-style STATE result, JINDAL-style
  isolation).
- `pricing-daily-rollup.service.spec.ts` — 2 new geography-isolation tests
  (DISTRICT/STATE never merged; NATIONAL row shape).
- `pricing-monthly-rollup.service.spec.ts` — 1 new geography-isolation test
  (separate monthly trend series per geography).
- `pricing-alert-evaluation.service.spec.ts` — 2 new tests (STATE fallback
  persisted correctly with `districtId=null`; DISTRICT still beats STATE
  when both exist — regression).
- `pricing-normalization.service.spec.ts` — existing 11 tests updated for
  the new geography-aware `normalizeBatch()` signature; all still pass.

## 11. Compliance

No compliance rule was weakened. `verify-pricing-source-compliance.js` and
`sources.json` were not modified. The pre-existing 33 compliance violations
returned by that script are unrelated to this batch (verified via `git
diff` — zero changes to either file) and predate this work.
`AGNI_STEELS.isEnabled` remains `false`. `tosReviewedAt` was not modified
for any source.

## 12. Remaining decisions

- **AGNI ToS approval** — administrative/legal decision, out of scope here.
- **Whether STATE-level references are acceptable for public Builder
  pricing** — the plumbing is in place (badge, banner, additive API
  fields), but whether AGNI-style state-wide data should ever reach a real
  builder is a separate product/compliance decision.
- **Admin UI geography filter/column** (spec §29) — deferred; no admin test
  tooling exists to safely validate the change in this environment.
- **NATIONAL-level fallback in the Builder panel and watchlist bridge** —
  the resolution service supports it, but the Next.js-side route/lib were
  only wired for DISTRICT→STATE in this batch (NATIONAL data does not exist
  yet in production, so this is a low-risk deferral, not a gap in the
  underlying architecture).
