# Phase 6D — Watchlist Price Alert Engine

## Overview

The alert engine bridges the existing UF-09 `Watchlist` model to the Price
Intelligence "Canonical SKU" serving layer (Phase 6C) and evaluates every
active target-price watchlist item once per day, strictly **after** the
daily rollup job has already committed successfully. It never runs on its
own schedule and never blocks or corrupts the rollup job if it fails.

```
PricingSchedulerService.runDailyJobs()
  └─ PricingDailyRollupService.rollupForDate(today)   (must succeed first)
  └─ PricingAlertEvaluationService.evaluateForDate(today)
       ├─ WatchlistBridgeService.resolveCanonicalSku(productId)
       ├─ WatchlistBridgeService.resolveDistrict(builderId)
       ├─ checkAlertEligibility(...)                  (confidence/method/staleness/publicDisplayAllowed)
       ├─ rule check: currentPrice <= targetPrice
       ├─ cooldown check (24h)
       ├─ NotificationService.notifyWatchlistPriceAlert(...)
       └─ PricingAlertEvaluation row persisted (didTrigger + suppressedReason)
```

The Builder Watchlist UI (`apps/web/app/(builder)/watchlist/page.tsx`,
served by `apps/web/app/api/builder/watchlist/route.ts`) reads the same
serving-layer tables directly (read-only) to show current market price,
confidence/method, gap-to-target, and recent alert-evaluation history —
using a small mirrored resolution helper
(`apps/web/lib/watchlist-pricing.ts`) since the Next.js app cannot import
the NestJS alert engine.

## Rule scope (approved)

Only **Rule A** is implemented: alert when the current verified market
price for the builder's resolved district reaches or drops below the
watchlist's `targetPrice`. No other rule types (e.g. percentage drop,
volatility) are implemented — the `Watchlist` model has no field to
express them and no schema change was approved.

## District resolution heuristic (approved)

A builder's alerting district is resolved as the **single
most-recently-created ACTIVE `Site`** with a non-null `city`, matched
case-insensitively against `PricingDistrict.name`. If a builder has
multiple sites, only the newest active one is used. If no site can be
resolved, evaluation is suppressed with `DISTRICT_UNRESOLVED`. This
mirrors the same resolution pattern already used by the district-pricing
panel, applied consistently on both the NestJS (`watchlist-bridge.service.ts`)
and Next.js (`watchlist-pricing.ts`) sides.

## Safety rules (never alert on)

- `confidence === "LOW"` → `LOW_CONFIDENCE`
- `method` starting with `DERIVED_` → `DERIVED_PRICE`
- `publicDisplayAllowed === false` → `INTERNAL_ONLY`
- Price older than 72 hours → `NO_PRICE`
- Alert already sent for this watchlist in the last 24h → `COOLDOWN`
- No canonical SKU mapping → `CANONICAL_SKU_UNMAPPED`
- No resolvable district → `DISTRICT_UNRESOLVED`
- Already evaluated for this date → `DUPLICATE_EVALUATION`
- No daily price row at all → `NO_PRICE`
- Rule condition not met → `RULE_NOT_TRIGGERED`

All suppression reasons have customer-friendly copy defined in
`apps/api/src/pricing/alerting/alert-suppression-reason.ts` (backend) and
mirrored in `apps/web/lib/watchlist-alert-copy.ts` (frontend, since the two
apps cannot share code).

## Idempotency

Each triggered alert uses a deterministic idempotency key:

```
watchlist-alert:{watchlistId}:{canonicalSkuId}:{districtId}:{YYYY-MM-DD}
```

This is passed into the existing `NotificationService`'s envelope dedupe
logic (`enqueueEnvelopeAndReturnId`), so re-running the same day's
evaluation twice will never create a duplicate notification.

## Notification integration

The alert engine calls `NotificationService.notifyWatchlistPriceAlert(...)`
(an additive method on the pre-existing `NotificationService` — no new
notification infrastructure was created). This uses the existing
`NotificationTemplateType.WATCHLIST_ALERT` enum value (already reserved
for this exact feature) and channel `WHATSAPP`, and returns the created
`Notification` row's id, which is stored on the `PricingAlertEvaluation`
row (`notificationId`). A failure to send a notification is caught and
logged — it never throws, and never marks the daily rollup as failed
(see `pricing-scheduler.service.ts`'s nested try/catch around alert
evaluation).

## Known limitation: unresolved SKU/district evaluations are not persisted

`PricingAlertEvaluation.canonicalSkuId`, `.districtId`,
`.currentPricePerBaseUnit`, and `.baseUnit` are all **non-nullable** in the
existing (pre-approved, additive) schema. When a watchlist item's product
cannot be mapped to a canonical SKU (`CANONICAL_SKU_UNMAPPED`) or the
builder has no resolvable district (`DISTRICT_UNRESOLVED`), there is no
real value for these fields, so **no `PricingAlertEvaluation` row is
written** for these two suppression reasons — they are only visible in
service logs (`this.logger.debug(...)` in
`pricing-alert-evaluation.service.ts`).

Practical impact:
- The Builder Watchlist UI's alert-history list will never show a
  `CANONICAL_SKU_UNMAPPED` or `DISTRICT_UNRESOLVED` entry (only the other
  9 suppression reasons, which do get persisted).
- A future Admin Alert Monitor reading from `PricingAlertEvaluation` will
  have the same blind spot.

This was a deliberate choice to avoid writing schema-violating sentinel
values (e.g. an empty string SKU id) that could corrupt joins/reports.
Resolving it properly would require either:
1. A schema change making these fields nullable (needs explicit
   approval — not sought as part of Phase 6D per the "no schema changes
   without approval" constraint), or
2. A separate lightweight `PricingAlertSkippedEvaluation` audit table.

No action has been taken on this within Phase 6D; it is documented here
as an accepted limitation for now.

## Performance

The evaluation service batches all reads: watchlists, SKU resolution,
district resolution, current daily price rows, and cooldown-check
evaluations are each fetched in one query per batch, not per watchlist
row (no N+1 queries). Approximate expected work at scale (single daily
run):

| Watchlists | Queries (approx, fixed count) | Notes |
|---|---|---|
| 100 | ~6 | All lookups batched; per-row work is in-memory |
| 1,000 | ~6 | Same query count; larger `IN (...)` lists |
| 10,000 | ~6 | Same query count; larger result sets, still single-pass |
| 100,000 | ~6 | Same query count; recommend running as part of the existing off-peak daily job window, monitor total runtime |

No new indexes were added; the engine relies on existing indexes on
`PricingDistrictPriceDaily` (`[canonicalSkuId, priceDate desc]`,
`[districtId, priceDate desc, publicDisplayAllowed]`) and
`PricingAlertEvaluation` (`[watchlistId, evaluatedAt desc]`,
`[didTrigger, evaluatedAt desc]`).

## Analytics

Not implemented — explicitly deferred. No analytics/telemetry event was
added for alert evaluation or notification delivery in this phase.

## Admin visibility

Not implemented in this phase — the existing Admin Price Intelligence
dashboard was not extended with an Alert Monitor panel. This remains a
documented gap for a future phase.

## Files

**Backend (apps/api)**
- `src/pricing/alerting/alert-suppression-reason.ts`
- `src/pricing/alerting/watchlist-bridge.service.ts`
- `src/pricing/alerting/alert-eligibility.util.ts`
- `src/pricing/alerting/pricing-alert-evaluation.service.ts`
- `src/pricing/pricing.module.ts` (wiring)
- `src/pricing/pricing-scheduler.service.ts` (wiring)
- `src/notifications/notification.types.ts` (additive fields)
- `src/notifications/notification.service.ts` (additive `notifyWatchlistPriceAlert`)

**Frontend (apps/web)**
- `lib/watchlist-alert-copy.ts`
- `lib/watchlist-pricing.ts`
- `app/api/builder/watchlist/route.ts` (enriched GET)
- `app/(builder)/watchlist/page.tsx` (enriched UI)

## Explicitly out of scope for Phase 6D

- Admin Alert Monitor panel / re-evaluate action
- Automated test suite for the alert engine
- Analytics/telemetry
- Any Prisma schema changes
- Alert rule types beyond target-price-reached
