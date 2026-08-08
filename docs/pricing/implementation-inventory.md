# District-Wise Price Intelligence — Implementation Inventory (6E-1)

Status: DRAFT (produced from Phase 6E-1 audit). This is a read-only inventory;
no code was modified to produce this document.

## Purpose
Enumerate every file that is part of the Price Intelligence / Watchlist /
Alerting system, its purpose, phase of origin, and dependencies, so that the
remaining Phase 6E workstreams (testing, security audit, performance,
production readiness) have a verified map of the system to work from.

---

## 1. Database Layer (packages/db)

| File | Purpose |
|---|---|
| `packages/db/prisma/schema.prisma` (Pricing* models ~lines 1214-1795, `Watchlist` ~377-389) | Source of truth schema: `PricingDistrict`, `PricingCostIndex`, `PricingMaterialCategory`, `PricingBrand`, `PricingCanonicalSku`, `PricingSkuAlias`, `PricingUnitConversion`, `PricingSource`, `PricingSourceEndpoint`, `PricingScrapeRun`, `PricingRawObservation`, `PricingObservation`, `PricingAnomaly`, `PricingDistrictPriceDaily`, `PricingTrendMonthly`, `PricingAlertEvaluation`, and pre-existing `Watchlist`. |
| `packages/db/prisma/seeds/pricing/districts.json` | Seed data: district list (TN districts) used for resolution. |
| `packages/db/prisma/seeds/pricing/categories.json` | Seed data: material categories + valid units. |
| `packages/db/prisma/seeds/pricing/unit-conversions.json` | Seed data: unit conversion factors. |
| `packages/db/prisma/seeds/pricing/sources.json` | Seed data: pricing sources + license class (INTERNAL_ONLY vs public). |
| `packages/db/prisma/seeds/pricing/source-endpoints.json` | Seed data: per-source scrape endpoints. |
| `packages/db/scripts/seed-pricing.js` | Plain Node script to load the above seed JSON into DB. |
| `packages/db/scripts/seed-pricing-endpoints.js` | Plain Node script to seed source endpoints specifically. |
| `packages/db/lib/pricing-fingerprint.js` | Pure fingerprint hashing helper for canonical SKU dedupe. |
| `packages/db/lib/pricing-dedupe-hash.js` | Pure hash helper used by ingestion for `dedupeHash` idempotency. |
| `packages/db/scripts/verify-pricing-fingerprint.js` | Standalone verification script for fingerprint uniqueness. |
| `packages/db/scripts/verify-pricing-dedupe-hash.js` | Standalone verification script for dedupe hash correctness. |
| `packages/db/scripts/verify-pricing-source-compliance.js` | Standalone verification script — checks source license compliance. |

**Gap identified:** No `pricing:validate` aggregate command yet exists (required for 6E-3). The three `verify-pricing-*.js` scripts are narrow/single-purpose and would need to be unified or wrapped by a new script.

---

## 2. Backend Pipeline (apps/api/src/pricing)

| File | Purpose | Phase |
|---|---|---|
| `pricing-config.service.ts` | Env-driven feature flags (e.g. `PRICING_FEATURE_ENABLED`), freight rate config. | 1 |
| `apify-actor-client.ts` | Stub vs Live Apify actor client abstraction for scraping. | 1-2 |
| `pricing-ingestion.service.ts` | Per-source raw field parsing + dedupe-hash based idempotent landing into `PricingRawObservation`. | 2 |
| `pricing-normalization.service.ts` | Alias resolution (exact-only), unit conversion, price text parsing, quarantine of ambiguous/unconvertible records. | 2-3 |
| `pricing-stats.util.ts` | Pure stats helpers: `median`, `percentile`, `scaledMedianAbsoluteDeviation`, `sortNumeric`. | 3 |
| `pricing-anomaly-detection.service.ts` | OUTLIER_MAD / IMPLAUSIBLE_RANGE / STALE_AS_OF checks; soft-exclusion (never hard delete). | 3 |
| `pricing-derivation.util.ts` | Pure derivation math: DERIVED_INDEX, DERIVED_FREIGHT, DERIVED_BLENDED; returns `null` if insufficient real data (never fabricates). | 4 |
| `pricing-daily-rollup.service.ts` | Idempotent daily upsert into `PricingDistrictPriceDaily`; two-pass (OBSERVED then DERIVED_*); computes `publicDisplayAllowed`. | 4 |
| `pricing-monthly-rollup.service.ts` | Re-aggregates daily rows into `PricingTrendMonthly`; confidence = min of daily confidences; MoM/YoY %. | 4 |
| `pricing-scheduler.service.ts` | Cron wiring: `EVERY_DAY_AT_2AM` (anomaly→rollup→alert-eval, alert-eval isolated in its own try/catch), `EVERY_DAY_AT_3AM` (monthly). Feature-flag gated. | 4-6D |
| `public-pricing.controller.ts` | Unauthenticated public routes `GET /public/pricing/district-daily`, `GET /public/pricing/trend-monthly`; `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` on both. | 5 |
| `pricing.module.ts` | NestJS DI wiring for all of the above. | all |

### 2a. Alerting subsystem (apps/api/src/pricing/alerting) — Phase 6D

| File | Purpose |
|---|---|
| `alert-suppression-reason.ts` | Const object of suppression reasons (COOLDOWN, LOW_CONFIDENCE, DERIVED_PRICE, CANONICAL_SKU_UNMAPPED, DISTRICT_UNRESOLVED, DUPLICATE_EVALUATION, NO_PRICE, RULE_NOT_TRIGGERED, WATCHLIST_DISABLED*, WATCHLIST_EXPIRED*, INTERNAL_ONLY) + customer-facing copy map. `*` = documented unreachable under current schema (Watchlist has no enabled/expiresAt column). |
| `watchlist-bridge.service.ts` | Resolves Watchlist → canonical SKU (exact `matsrcListingId` match, else unambiguous category+brand match) and → district (builder's most-recent active Site's city, case-insensitive match). Never guesses among multiple candidates. |
| `alert-eligibility.util.ts` | Eligibility gate: rejects `!publicDisplayAllowed` → INTERNAL_ONLY; `confidence === "LOW"` → LOW_CONFIDENCE; `method.startsWith("DERIVED_")` → DERIVED_PRICE; stale (>72h) → NO_PRICE. |
| `pricing-alert-evaluation.service.ts` | Full evaluation engine chained after daily rollup; 24h cooldown; within-run duplicate-evaluation guard (idempotency net 1); `triggerAndRecord()` wraps notification call in try/catch so notification failures never corrupt rollup/evaluation transaction. |

**Known limitation (documented, not to be silently fixed):** `PricingAlertEvaluation` has non-nullable `canonicalSkuId`/`districtId`/`currentPricePerBaseUnit`/`baseUnit`, so CANONICAL_SKU_UNMAPPED and DISTRICT_UNRESOLVED suppressions are only `logger.debug`-logged, not persisted as audit rows. This is a real gap for the future Admin Alert Monitor (these two reasons will never appear in a query of the table) — requires an explicit schema-change proposal + approval if ever addressed, not a silent fix.

### 2b. Notifications (apps/api/src/notifications)

| File | Purpose |
|---|---|
| `notification.service.ts` | Generic notification delivery; `enqueueEnvelopeAndReturnId()` dedups via `findFirst({idempotencyKey})` before create (idempotency net 2); `notifyWatchlistPriceAlert()` builds watchlist-alert envelope; failure handling marks `queued`/`failed` + writes `NotificationDeliveryLog`. |
| `notification.types.ts` | Type defs for notification envelopes/channels. |

---

## 3. Admin Surface (apps/api/src/admin/pricing + apps/admin)

| File | Purpose |
|---|---|
| `apps/api/src/admin/pricing/admin-pricing.controller.ts` | `@Controller("admin/pricing")`, `OptionalJwtAuthGuard + RoleGuard`, `@Roles("ADMIN")` class-level. Routes: dashboard, sources, endpoints, scheduler, rollups (daily/monthly + preview), anomalies (list/resolve/bulk-resolve/comment), sku/canonical (list/history/merge/rename), sku/alias (action/bulk-assign), sku/unmapped (list/action/bulk-action), search. |
| `pricing-admin-ops.service.ts` | Backing service (848 lines) implementing all controller operations incl. `getDashboardSummary()` (platformHealth/processingSummary/observationTrend/pipelineStatus pattern to follow for any future Alert Monitor extension). |
| `pricing-admin-ops.service.spec.ts` | ONLY existing pricing test file. Establishes `makeFakePrisma()` + `buildService()` vitest mocking pattern to be replicated for new suites. |
| `admin-pricing.module.ts` | DI wiring for admin controller/service. |
| `dto/*.ts` (resolve-anomaly, trigger-rollup, trigger-ingest, update-source-status, update-endpoint-status, merge-canonical-sku, rename-canonical-sku, alias-action, bulk-assign-alias, unmapped-queue-action, bulk-resolve-anomaly) | Request DTOs for the above routes. |
| `apps/admin/components/admin/pricing/PricingDashboardPanel.tsx` | Top-level health/summary widgets. |
| `apps/admin/components/admin/pricing/SourceManagementPanel.tsx` | Enable/disable/manage pricing sources. |
| `apps/admin/components/admin/pricing/EndpointHealthPanel.tsx` | Per-endpoint scrape health. |
| `apps/admin/components/admin/pricing/RollupAdministrationPanel.tsx` | Manual rollup trigger/preview UI. |
| `apps/admin/components/admin/pricing/CoverageMatrixPanel.tsx` | District×category coverage matrix. |
| `apps/admin/components/admin/pricing/CanonicalSkuManagementPanel.tsx` | Merge/rename canonical SKUs. |
| `apps/admin/components/admin/pricing/UnmappedQueuePanel.tsx` | Unmapped alias resolution queue. |
| `apps/admin/components/admin/PricingAnomalyBoard.tsx` | Anomaly review board (note: lives outside the `pricing/` subfolder — inconsistent location, flagged as minor convention drift, not fixed). |
| `apps/admin/components/admin/pricing/DataQualityDashboardPanel.tsx` | Data-quality metrics. |
| `apps/admin/components/admin/pricing/ComplianceDashboardPanel.tsx` | License/compliance status. |
| `apps/admin/components/admin/pricing/CostDashboardPanel.tsx` | Ingestion cost tracking. |
| `apps/admin/components/admin/pricing/SchedulerDashboardPanel.tsx` | Cron/scheduler status. |
| `apps/admin/app/(admin)/pricing/page.tsx` | Wires all above panels together. |
| `apps/admin/lib/pricing-admin-types.ts` | Shared TS types for admin pricing UI. |
| `apps/admin/lib/rbac-shared.ts` | `MENU_CONFIG` incl. `{ key: "pricing", href: "/pricing", label: "Price Intelligence" }`; client-safe menu helpers. |

**Gap identified:** No Admin Alert Monitor yet exists (deferred from Phase 6D per spec) — no route/panel currently surfaces `PricingAlertEvaluation` data to admins.

---

## 4. Builder-Facing Surface (apps/web)

| File | Purpose |
|---|---|
| `app/api/builder/products/[canonicalProductId]/district-pricing/route.ts` | Builder district-pricing panel API. Filters strictly on `publicDisplayAllowed=true`; defensive second-layer filter dropping `licenseClass === "INTERNAL_ONLY"` sources at serialization time; explicit `NO_SKU_MATCH`/`NO_DISTRICT_DATA` empty-reason states (never guesses). |
| `lib/district-pricing.ts`, `lib/district-pricing-types.ts` | District pricing data-shaping helpers/types for the panel. |
| `components/products/district-pricing/*.tsx` (badges, states, MarketTrendChart, DistrictSelector, NearbyDistrictComparisonTable, PriceExplanationCard, HistoricalPriceContext, DistrictPriceIntelligencePanel) | UI components composing the Builder district pricing panel. |
| `lib/watchlist-pricing.ts` | **Duplicate-ish** of `WatchlistBridgeService` logic, reimplemented on the web/Next.js side for watchlist price enrichment. Flagged as duplicate logic (not consolidated — out of scope per no-unrelated-refactor guardrail). |
| `lib/watchlist-alert-copy.ts` | Web-side customer-facing copy for alert states (parallels `alert-suppression-reason.ts` copy map). |
| `app/api/builder/watchlist/route.ts`, `app/api/builder/watchlist/[productId]/route.ts` | Builder watchlist CRUD APIs. |
| `app/(builder)/watchlist/page.tsx` | Builder watchlist UI page. |
| `app/api/builder/analytics/price-intelligence-event/route.ts` | Analytics event logging for price-intelligence panel interactions. |
| `app/api/builder/reports/district-price-intelligence/route.ts` | Report generation endpoint tying into district pricing data. |

---

## 5. Supplier-Facing Surface (apps/supplier)

| File | Purpose |
|---|---|
| `lib/pricing-intelligence.ts` (+ `.spec.ts`) | Supplier-side market-intelligence data shaping; has an existing test file. |
| `lib/market-intelligence-data.ts` (+ `.spec.ts`) | Supplier market intelligence dashboard data source; has an existing test file. |
| `components/supplier/DistrictPricingWidget.tsx` | Supplier dashboard district pricing widget. |
| `components/supplier/MarketIntelligenceReportView.tsx`, `MarketIntelligenceSummaryWidget.tsx`, `MarketIntelligenceDashboardViewedTracker.tsx` | Supplier market intelligence report UI + view-tracking. |
| `app/(supplier)/reports/market-intelligence/page.tsx` | Supplier market intelligence report page. |
| `app/api/supplier/analytics/price-intelligence-event/route.ts` | Supplier-side analytics event endpoint (parallels the Builder one). |

**Note:** Supplier surfaces must never expose Builder watchlist data, other-supplier competitor identity, or alert history — to be verified explicitly in 6E-4 security audit.

---

## 6. Existing Documentation (docs/pricing)

| File | Status |
|---|---|
| `docs/pricing/alerting.md` | Exists — covers Phase 6D alerting design; needs review/update in 6E-12. |
| `docs/pricing/seed-review-checklist.md` | Exists — seed data review checklist; needs review in 6E-12. |
| `docs/pricing/implementation-inventory.md` | This document (new, 6E-1 deliverable). |

Not yet found in repo (candidates to author in 6E-12 if in scope): `normalization.md`, `caching.md`, `source-runbook.md`, `triage-guide.md`, production runbook, `production-readiness.md`.

---

## 7. Existing Automated Test Coverage (as of this audit)

Only test files found relevant to this system:
- `apps/api/src/admin/pricing/pricing-admin-ops.service.spec.ts`
- `apps/supplier/lib/pricing-intelligence.spec.ts`
- `apps/supplier/lib/market-intelligence-data.spec.ts`
- `apps/web/lib/district-pricing.spec.ts`
- `apps/web/lib/price-forecast.spec.ts`

**No test coverage exists yet** for: price parsing, unit conversion, district/SKU resolution, decimal arithmetic, dedupe idempotency, rollup idempotency, derived-pricing null-safety, license-gating (INTERNAL_ONLY leakage), alert eligibility scenarios, alert idempotency/cooldown, notification-failure isolation, or RBAC/IDOR on pricing & alerting endpoints. This is the primary scope of Phase 6E-2.

---

## 8. Cross-Cutting Discrepancies / Risks Identified (for follow-up, not fixed here)

1. **Caching contract mismatch:** `public-pricing.controller.ts` serves `no-store` on all public pricing routes (matching `PublicInsightsController` convention per in-code comment), not the `s-maxage=300, stale-while-revalidate=1800` contract sometimes assumed elsewhere. Appears intentional; to be confirmed/documented (not changed) in 6E-6.
2. **PricingAlertEvaluation non-nullable columns** prevent persisting CANONICAL_SKU_UNMAPPED / DISTRICT_UNRESOLVED suppression rows — documented Phase 6D deferred limitation; any fix requires a schema-change proposal and explicit approval.
3. **Price parser simplicity:** `PricingNormalizationService.parsePriceText()` only strips `₹`/commas/whitespace and regex-matches a plain decimal; does not appear to implement RANGE (`"5,200 - 6,400"`) or ON_REQUEST (`"Get Price Quote"`) detection. Tests written in 6E-2 must assert actual current behavior, and this gap should be logged as technical debt rather than assumed away.
4. **Duplicate watchlist-bridge logic** between `apps/api/src/pricing/alerting/watchlist-bridge.service.ts` (NestJS) and `apps/web/lib/watchlist-pricing.ts` (Next.js) — both implement equivalent resolution rules independently. Flagged for awareness; consolidation is out of scope (no unrelated refactors).
5. **Admin panel location inconsistency:** `PricingAnomalyBoard.tsx` lives at `apps/admin/components/admin/` instead of `apps/admin/components/admin/pricing/` alongside its siblings. Cosmetic/convention drift only.
6. **No Admin Alert Monitor** currently exists — deferred item from Phase 6D, in scope for 6E-10 if this workstream continues in a follow-up session.

---

## 9. Note on Scope of This Document

This inventory was produced under a hard context-budget constraint. It reflects a thorough but time-boxed read-only audit (~25 core files read directly, plus 3 parallel research passes) of the Price Intelligence/Watchlist/Alerting system. It is accurate for the files listed above but does not yet include line-level references for every file (only the most architecturally significant ones). The remaining Phase 6E workstreams (6E-2 through 6E-13 — automated tests, data-integrity validator, security/license audit, alert-safety audit, caching/API validation, performance benchmarking, DB index audit, failure/recovery testing, Admin Alert Monitor implementation, end-to-end regression, documentation/runbooks, and the final production-readiness report) have **not** been executed and remain outstanding. See recommendation below.
