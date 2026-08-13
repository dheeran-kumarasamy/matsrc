# Phase 6F-5 — Post-Deploy Verification Report

## Deployment summary

| Attribute | Value |
|---|---|
| Migration | `20260813000000_add_sourcing_assistant` |
| Production branch | `br-long-star-ao464t6w` |
| Production endpoint | `ep-muddy-meadow-aoh42y8u` |
| Deployment timestamp | 2026-08-13T09:49:07Z |
| Command | `pnpm --filter @matsrc/db db:safe:migrate-deploy` |
| Safety wrapper | YES — `prisma-safe.js migrate-deploy` |
| Safety preflight | SAFE ✓ (CONTROLLED_WRITE, production correctly detected) |
| Audit outcome | ALLOWED |
| Prisma exit code | 0 (SUCCESS) |

## Migration history (post-deploy)

| Migration | applied_steps_count | rolled_back_at |
|---|---|---|
| 20260810130725_add_pricing_geographic_hierarchy | 0 | null |
| **20260813000000_add_sourcing_assistant** | **1** | **null** |

Checksum in `_prisma_migrations`: `f0058ce6cc618eb1e6b809aebaf46501dcc6bf68ee0ae8e3236b2663a3bf2b33`
Matches reviewed artifact SHA-256: **YES** ✅

## New schema in production

### Tables (3)
- `SourcingSession` ✅
- `SourcingRecommendation` ✅
- `SourcingToolInvocation` ✅

### Enums (2)
- `SourcingSessionStatus`: COLLECTING, SEARCHING, RECOMMENDED, CONFIRMED, ABANDONED ✅
- `SourcingApprovalStatus`: NOT_REQUIRED, PENDING, APPROVED, REJECTED ✅

### Indexes (13 = 3 PKs + 10 named)
All 10 named indexes verified present ✅ (including UNIQUE `SourcingRecommendation_sessionId_rank_key`)

### Foreign keys (6) ✅
All 6 verified: userId, siteId, sessionId (×2), supplierId, productId

## Before / after production data comparison

| Table | Before | After | Delta |
|---|---|---|---|
| User | 7 | 7 | 0 ✅ |
| Product | 16 | 16 | 0 ✅ |
| Order | 27 | 27 | 0 ✅ |
| SupplierProfile | 2 | 2 | 0 ✅ |
| pricing_source | 37 | 37 | 0 ✅ |
| pricing_district | 38 | 38 | 0 ✅ |
| pricing_district_price_daily | 228 | 228 | 0 ✅ |
| pricing_scrape_run | 78 | 78 | 0 ✅ |
| pricing_raw_observation | 23 | 23 | 0 ✅ |
| public tables (total) | 58 | 61 | +3 (Sourcing tables) ✅ |
| SourcingSession | (absent) | 0 | new ✅ |
| SourcingRecommendation | (absent) | 0 | new ✅ |
| SourcingToolInvocation | (absent) | 0 | new ✅ |

No existing business data was modified. Migration was purely additive. ✅

## Tests (post-deploy)

| Suite | Result |
|---|---|
| `db:verify-safety` (safety unit tests) | ✅ ALL PASSED |
| `@matsrc/web` unit tests | ✅ 151/151 |
| `@matsrc/api` unit tests | ✅ 274/275 (1 pre-existing failure — whatsapp webhook) |

## Safety verification

| Check | Result |
|---|---|
| Only authorized migration applied | YES |
| Production data modified unexpectedly | NO |
| Unexpected schema changes | NO |
| Destructive SQL executed | NO |
| PITR evidence branch preserved | YES (`br-wandering-sea-aokghz6w`) |
| Recovery branch preserved | YES (`production_before_restore_20260812`) |

## Artifacts

- `artifacts/database/phase-6f-5-pre-deploy-baseline.md`
- `artifacts/database/phase-6f-5-post-deploy-verification.md` (this file)

## Final status

```
PHASE 6F-5 COMPLETE
AI Sourcing Assistant database migration successfully deployed to production.
Migration: 20260813000000_add_sourcing_assistant
Endpoint:  ep-muddy-meadow-aoh42y8u (production)
Timestamp: 2026-08-13T09:49:07Z
```
