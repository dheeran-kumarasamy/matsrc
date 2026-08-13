# Phase 6F-4 — Staging Validation Report

## Migration

| Attribute | Value |
|---|---|
| Name | `20260813000000_add_sourcing_assistant` |
| Directory | `packages/db/prisma/migrations/20260813000000_add_sourcing_assistant/` |
| Source artifact | `artifacts/database/phase-6f-3a-ai-sourcing-migration.sql` |
| SQL identical to artifact | YES (verified with `diff`) |
| Lines | 117 |
| Destructive operations | 0 |

## Staging database

| Attribute | Value |
|---|---|
| Branch name | `dev` |
| Branch ID | `br-gentle-block-aokqdued` |
| Endpoint ID | `ep-sparkling-term-aojx078x` |
| Is production | NO |
| Applied timestamp | 2026-08-13T06:36:42.194Z |
| migrate deploy exit code | 0 (SUCCESS) |
| Safe wrapper used | YES (`db:safe:migrate-deploy`) |

## Migration history (dev branch — last 3)

- `20260808133349_add_supplier_profile_region` — steps: 1
- `20260810130725_add_pricing_geographic_hierarchy` — steps: 0 (applied via db execute, same as production)
- **`20260813000000_add_sourcing_assistant` — steps: 1 (newly applied)** ✅

## Schema validation (all verified via verify-sourcing-schema.js)

Tables: SourcingSession (13 cols), SourcingRecommendation, SourcingToolInvocation ✅

Enums:
- `SourcingSessionStatus`: COLLECTING, SEARCHING, RECOMMENDED, CONFIRMED, ABANDONED ✅
- `SourcingApprovalStatus`: NOT_REQUIRED, PENDING, APPROVED, REJECTED ✅

Indexes: 13 total (3 PKs + 10 named) including UNIQUE (sessionId, rank) ✅

Foreign keys: 6 (all verified, CASCADE/RESTRICT/SET NULL behaviors correct) ✅

## Tests

| Suite | Result |
|---|---|
| `db:verify-safety` (safety unit tests) | ✅ ALL PASSED |
| `db:check-unsafe-patterns` | ✅ CLEAN |
| `@matsrc/web` unit tests | ✅ 151/151 |
| `@matsrc/api` unit tests | ✅ 274/275 (1 pre-existing whatsapp webhook failure) |
| `@matsrc/web` type-check | ✅ PASSED |
| `@matsrc/api` type-check | ✅ PASSED (non-spec code) |
| Sourcing CRUD tests | ✅ ALL PASSED |
| Unique (sessionId, rank) constraint | ✅ ENFORCED |
| CASCADE delete | ✅ CORRECT |
| userId authorization isolation | ✅ PASSED |
| `ranking.spec.ts` (10 tests) | ✅ PASSED |
| `requirement-extractor.spec.ts` (19) | ✅ PASSED |
| `product-search.spec.ts` (11) | ✅ PASSED |
| `session-authorization.spec.ts` (8) | ✅ PASSED |
| `ai-fallback.spec.ts` (7) | ✅ PASSED |
| `no-data.spec.ts` (11) | ✅ PASSED |
| `approval-boundary.spec.ts` (13) | ✅ PASSED |
| `landed-cost.spec.ts` (11) | ✅ PASSED |
| Prisma Client regeneration | ✅ All 3 models + 2 enums exposed |

## Existing functionality (dev)

User:7, Product:16, Order:27, pricing_source:37, pricing_district:38 — all unchanged ✅

## Production verification

Production modified: NO. Production schema modified: NO. Production data modified: NO.

Sourcing* tables in production: ABSENT ✅

User:7 ✅, Product:16 ✅, Order:27 ✅, SupplierProfile:2 ✅, pricing_source:37 ✅, pricing_district:38 ✅

## Issues

None. No new failures introduced. Pre-existing failures (whatsapp webhook test, @matsrc/ui tsconfig) are documented and unrelated to this migration.

## Rollback

Dev branch can be deleted and recreated from production at any time (additive migration — rollback = drop 3 tables + 2 enums via db execute).

## STOP — Production deployment NOT authorized in this phase

Phase 6F-5 will handle production migration authorization and controlled deployment.
Do NOT run `db:safe:migrate-deploy` against production.
