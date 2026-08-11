# Phase 6G — Core Price Intelligence Platform Completion & Production Readiness

## Executive Summary

This phase performed a full read-only audit of the core District-Wise Price
Intelligence platform (extraction → raw ingestion → normalization →
canonical SKU → geographic resolution → rollups → anomaly detection → alert
evaluation → Builder/Supplier/Admin → audit/compliance), then fixed the one
genuine core defect the audit surfaced: `PricingAnomalyDetectionService`
grouped its MAD-outlier check by `districtId` alone, which became unsafe
once Phase 6F made `districtId` nullable for STATE/NATIONAL observations
(two different states' STATE-level series, or a STATE and a NATIONAL
series, could have been silently merged into one outlier calculation). This
has been fixed to match the geographic-isolation grouping already used
correctly by the daily/monthly rollups. No other core defect was found. No
AGNI ingestion, enablement, or compliance change was performed — AGNI
remains `isEnabled=false`, `tosReviewedAt=NULL`, verified unchanged.

## Scope

Audited: `apps/api/src/pricing/**`, `apps/api/src/admin/pricing/**`,
`apps/api/src/admin/audit/**`, `apps/web` (district-pricing panel,
watchlist, reports), `apps/supplier` (market intelligence, pricing
services), `apps/admin` (pricing dashboard panels), `packages/db` (schema,
seeds, safety tooling). Not modified: schema, seeds, Apify actor, source
enablement, AGNI/JINDAL data, database safety infrastructure (Phase 6F-1,
preserved as-is).

## Completed Architecture

The pipeline `source config → endpoint config → extraction → raw
observation → normalization → canonical SKU → geographic resolution →
daily rollup → monthly trend → anomaly detection → price resolution →
alert evaluation → Builder/Supplier/Admin → audit/compliance` is fully
wired end-to-end for the currently-proven extraction methods (native HTTP,
Apify stub/live). Every stage was verified by direct code inspection plus
existing (or, for anomaly detection, newly added) automated tests — not
assumed complete because a file exists.

## Core Pipeline Audit

See `docs/pricing/core-platform-readiness-6g.md` for the full
capability-by-capability matrix with evidence citations. Summary: 24 of 26
audited capabilities were already COMPLETE from prior phases; 1
(Anomaly detection) had a genuine geographic-isolation defect, now fixed;
Admin UI automated testing remains a documented, not fabricated, gap
(no test runner exists for `apps/admin` — introducing one was explicitly
out of scope for this phase).

## Extraction Architecture

`PricingIngestionService.ingestEndpoint()` dispatches per-URL via
`hasNativeParserForUrl()` — native HTTP for JINDAL_PANTHER/AGNI_STEELS
(both proven, both still gated by ToS/`isEnabled`), Apify (stub or live,
per `PricingConfigService.isApifyLiveEnabled()`) for everything else.
`PricingSource.scrapeMethod` (`APIFY_PLAYWRIGHT`/`PDF_PARSE`) remains
descriptive metadata — no Playwright or PDF extractor client exists, and
none is required, since no source using those methods is
approved/enabled. This matches spec §5's actual requirement ("route to the
correct extractor" for methods actually in production use, not "implement
every enum value speculatively").

Zero-result / partial-result handling was audited and found already
correct (`finalStatus` logic distinguishes `SUCCEEDED` from `PARTIAL` based
on `landed > 0 || items.length === 0`), but had no direct test coverage —
2 new tests were added (`pricing-ingestion.service.spec.ts`) asserting:
(1) a run that fetches items but lands zero new rows (all duplicates) is
classified `PARTIAL`, never `SUCCEEDED`; (2) a run that genuinely fetches
zero items (no rows on the page) is `SUCCEEDED` at the scrape-run level
(the HTTP/actor call itself worked) but `itemsFetched=0`/`itemsLanded=0` is
preserved so no downstream consumer can conflate "ran fine" with "found
prices" — directly addressing the Phase 6E finding this spec explicitly
calls out.

## Normalization

`PricingNormalizationService` rejects rows with missing SKU/price text,
quarantines unit-conversion-ambiguous rows rather than guessing a factor,
and (Phase 6F) requires an explicit `NormalizationGeographyContext` rather
than ever inferring geography. The pre-existing RANGE/ON_REQUEST
price-text-detection gap (documented in `implementation-inventory.md`) was
re-confirmed as still-current behavior, not silently "fixed" — changing
parser semantics was out of this phase's hard scope.

## Canonical SKU

Confirmed geography-independent: `PricingCanonicalSku.fingerprint` is
computed purely from `(materialCategoryId, brandId, grade, sizeMm,
sizeLabel, packLabel)` — no source/district/state/geographyLevel input.
No code path in normalization or rollups creates a new canonical SKU
because of a geography difference.

## Geographic Pricing

DISTRICT/STATE/NATIONAL hierarchy (Phase 6F) preserved unchanged: DB CHECK
constraints on `PricingObservation`/`PricingDistrictPriceDaily`/
`PricingTrendMonthly` enforce the `geographyLevel` ↔ `stateId`/`districtId`
combinations; `PricingResolutionService` implements DISTRICT > STATE >
NATIONAL fallback with compliance/freshness gates at every level. Company
address is never consulted (verified: `PricingResolutionService` only
queries `PricingDistrict`/`PricingDistrictPriceDaily`, confirmed by an
existing test asserting the fake Prisma client's exposed methods).

## Rollups

Daily and monthly rollups already grouped correctly by `(canonicalSkuId,
geographyLevel, stateId, districtId)` via the `geoKey` column (Phase 6F) —
re-verified this phase, no change needed.

## Anomalies

**Defect found and fixed.** `PricingAnomalyDetectionService.detectForDate()`
grouped MAD-outlier detection by `` `${canonicalSkuId}::${districtId}` ``
only. Since `districtId` is `null` for both STATE and NATIONAL
observations (Phase 6F), this key would have silently merged: (a) two
different states' STATE-level series, and (b) any STATE series with any
NATIONAL series, into one outlier calculation — directly violating the
"never mix DISTRICT/STATE/NATIONAL series" rule this task and Phase 6F
both establish. Fixed to group by `(canonicalSkuId, geographyLevel,
stateId, districtId)`, matching the rollups exactly. 2 new tests added
proving isolation; all 10 pre-existing anomaly tests still pass unchanged
(their fixtures default to a single consistent DISTRICT/state/district
tuple, so behavior for the already-tested DISTRICT-only scenarios is
identical). The documented "an observation can receive two independent
anomaly reasons in one run" behavior (cross-check interaction test) was
preserved exactly, per instruction not to silently change service
semantics.

## Alerts

`PricingAlertEvaluationService` unchanged this phase — Phase 6F's
DISTRICT→STATE fallback, `geographyLevel`/`stateId` persistence, and
"(state reference)" notification-copy disclosure were re-verified via the
existing 9 passing tests (including the two Phase 6F STATE-fallback
tests). No NATIONAL fallback in the alert engine — documented as an
existing, unchanged scope boundary (watchlists are district-scoped via a
builder Site; NATIONAL has no meaningful builder-facing analog yet).

## Watchlists

`watchlist-bridge.service.ts` (NestJS, for the alert engine) and
`watchlist-pricing.ts` (Next.js, for the Builder watchlist UI) both
resolve canonical SKU → district → DISTRICT price → STATE fallback,
surfacing `geographyLevel`, `isGeographyFallback`, `geographyStateName`.
No silent geographic substitution occurs — a STATE fallback is always
labeled as such in both the persisted `PricingAlertEvaluation` row and the
UI-facing `WatchlistPriceIntelligence` type. The known duplicate-logic
flag between the two implementations (documented since Phase 6E-1) remains
unconsolidated — out of scope (no unrelated refactor).

## Builder

The district-pricing panel (`DistrictPriceIntelligencePanel.tsx`) renders
a `GeographyLevelBadge` ("Erode district price" vs "Tamil Nadu state
reference") plus an explicit banner when a STATE fallback is used. The
District-Wise Price Intelligence report route
(`district-price-intelligence/route.ts`) is explicitly scoped to
`geographyLevel=DISTRICT` end-to-end (verified this phase — a STATE/
NATIONAL row can never silently appear mapped onto a district in this
report, by construction of the query filter, not just by convention).

## Supplier

`market-intelligence-data.ts` and `supplier-data.ts` (both Phase 6F-fixed,
re-verified this phase) explicitly filter `geographyLevel=DISTRICT` for
every district-scoped view (listing competitiveness, category trend,
district opportunity, district pricing). INTERNAL_ONLY sources are never
surfaced to Supplier UI (gated by the existing `publicDisplayAllowed`
column, computed at rollup time from contributing sources' `licenseClass`).

## Admin

`AdminPricingController`/`PricingAdminOpsService` provide the full
operational surface (dashboard, source/endpoint management, scheduler
control, manual rollup triggers, anomaly review/bulk-resolve/comment,
canonical SKU merge/rename, alias actions, unmapped-queue actions), all
gated by `OptionalJwtAuthGuard`+`RoleGuard`+`@Roles("ADMIN")` and
audit-logged. 20 backend tests pass. No automated UI test suite exists for
`apps/admin` (no test runner configured in that workspace) — this is
documented as a gap, not closed in this phase per the explicit instruction
not to introduce large new test tooling; manual API-contract/backend-logic
verification was performed instead.

## Audit

Every meaningful admin mutation writes an `AuditLog` row with actor
identity preserved (`actorId` from `@CurrentUser()`) — confirmed via 20+
call sites in `pricing-admin-ops.service.ts` covering source/endpoint
status changes, ingest/rollup triggers, canonical SKU merge/rename, alias
actions, unmapped-queue actions, anomaly resolve/bulk-resolve/comment, and
scheduler pause/resume. `AuditService`/`AuditController` expose these
read-only to Admin, RBAC-gated identically to the pricing controller.

## Compliance

`publicDisplayAllowed`, `licenseClass`, `tosReviewedAt`, `robotsAllowed`,
and source `isEnabled` cannot be bypassed by any read path audited
(public API, `PricingResolutionService`, Builder report, Supplier report,
alerts, watchlists) — every one of them ultimately filters on
`publicDisplayAllowed` (itself computed from contributing sources'
`licenseClass` at rollup time) and/or checks `isEnabled`/`tosReviewedAt`
before any write path can enable a source
(`PricingAdminOpsService.updateSourceStatus()` throws `BadRequestException`
if `tosReviewedAt`/`robotsAllowed`/config is incomplete). A STATE-level
fallback price is subject to the exact same `publicDisplayAllowed` gate as
a DISTRICT price — it cannot bypass compliance by being less geographically
precise. No compliance rule was weakened this phase.

## Scheduler

`PricingSchedulerService.runDailyJobs()` chains anomaly detection → daily
rollup → alert evaluation, with alert evaluation wrapped in its own
try/catch so an alerting failure never corrupts or retries the already-
successful rollup. `runMonthlyJob()` runs independently. Both are no-ops
when `PRICING_FEATURE_ENABLED=false`. No change made this phase — audited
and confirmed correct.

## Observability

`PricingScrapeRun` already tracks source/endpoint/method(implicitly via
actor)/startedAt/finishedAt/itemsFetched/status/errorMessage;
`PricingAdminOpsService.getDashboardSummary()` exposes
platformHealth/processingSummary/observationTrend/pipelineStatus computed
from these existing fields plus `PricingRawObservation.parseStatus`
counts. No duplicate telemetry was introduced.

## Data Quality

`DataQualityDashboardPanel` (Admin UI) and its backing summary distinguish
coverage/staleness/compliance-blocked/method-mismatch states, per
`pricing-admin-types.ts`'s `PricingDataQualitySummary` shape. Not modified
this phase; no defect found on inspection.

## Security

Every admin pricing route uses the identical
`OptionalJwtAuthGuard`+`RoleGuard`+`@Roles("ADMIN")` pattern used across
all 11 other admin controllers in the codebase — no inconsistency found,
no guard weakened.

## Database Safety

Phase 6F-1 infrastructure (`packages/db/lib/db-safety.js`,
`db-safety-preflight.js`, `scripts/prisma-safe.js`/`db-identity.js`/
`verify-db-safety.js`) was not modified this phase. Re-ran
`pnpm --filter @matsrc/db db:verify-safety` — all synthetic-data safety
tests still pass. No destructive command was run against any database
this phase; all verification was read-only (`SELECT count(*)` /
`findUnique` style checks against the existing development database).

## Test Results

- `apps/api`: 274/275 passing (+4 net new: 2 anomaly geographic-isolation
  tests, 2 ingestion PARTIAL/SUCCEEDED-classification tests). 1
  pre-existing, unrelated failure: `src/whatsapp/whatsapp.controller.spec.ts`
  (webhook-verify test) — confirmed via `git diff` untouched by this or any
  prior phase.
- `apps/web`: 61/61 passing, unchanged.
- `apps/supplier`: 31/31 passing, unchanged.
- `apps/admin`: no test runner configured (pre-existing state, not
  introduced or removed this phase).
- TypeScript: `apps/web`, `apps/supplier`, `apps/admin` all `tsc --noEmit`
  clean.
- `prisma validate`: schema valid, unchanged.

## Remaining Core Gaps

1. Admin UI has no automated test coverage (documented, not closed —
   out of scope per explicit instruction).
2. Playwright and PDF extraction code paths do not exist (not required by
   any currently-approved source; documented, not implemented
   speculatively).
3. RANGE/ON_REQUEST price-text parsing gap in normalization remains
   (pre-existing technical debt, unrelated to this phase's scope).
4. Watchlist-bridge duplicate logic (NestJS vs Next.js) remains
   unconsolidated (pre-existing, flagged, not a defect).
5. 33 pre-existing compliance violations in seed data remain (documented
   in Phase 6F-1 report; a separate compliance decision, not a platform
   defect).

## Production Readiness Matrix

See `docs/pricing/core-platform-readiness-6g.md` for the full table.

## AGNI Deferred Work

```
AGNI_STEELS = DEFERRED SOURCE

Future work (not performed this phase):
1. Compliance/ToS review
2. Controlled state-level ingestion
3. Validate Tamil Nadu applicability
4. Validate public-display rules
5. Run controlled end-to-end pipeline
6. Consider production enablement
```

Verified unchanged this phase: `AGNI_STEELS.isEnabled=false`,
`tosReviewedAt=NULL`. JINDAL_PANTHER's 23 raw rows remain untouched
(`rawLocationText="Delhi"`, `parseStatus=PENDING`) — not used as Tamil Nadu
validation data, no Delhi district/state created.

## Final Recommendations

1. The fix made this phase is sufficient to close the one genuine core
   architectural gap found; no further core-platform engineering work is
   blocking a compliance/AGNI decision.
2. Before any AGNI-related work: obtain explicit compliance/ToS approval
   (administrative, not engineering).
3. Consider introducing a lightweight Admin UI test harness in a future,
   separately-scoped phase — not urgent for backend correctness, but a
   real gap for regression safety on that surface.
4. No other core platform work is recommended before proceeding to a
   compliance-gated AGNI validation phase, if and when that is separately
   approved.
