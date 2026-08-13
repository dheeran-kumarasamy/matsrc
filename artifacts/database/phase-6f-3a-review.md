# Phase 6F-3A — Migration Diff Review Report

## Migration metadata

| Attribute | Value |
|---|---|
| Generated | 2026-08-13T05:34:19Z |
| Environment | development |
| DATABASE_URL | dev branch — ep-sparkling-term-aojx078x (NOT production) |
| SHADOW_DATABASE_URL | prisma-shadow branch — ep-plain-voice-aoacghjc (NOT production) |
| Production target | NO |
| Shadow = DIRECT_URL | NO |
| Shadow = production | NO |
| Migration action | SAFE ✓ |
| Audit outcome | ALLOWED |

Shadow endpoint used: `ep-plain-voice-aoacghjc`
Production endpoint: `ep-muddy-meadow-aoh42y8u` (NOT used)

## Artifact

`artifacts/database/phase-6f-3a-ai-sourcing-migration.sql` — 117 lines, SQL only.

## Schema changes

### New enums (2)
- `SourcingSessionStatus`: COLLECTING, SEARCHING, RECOMMENDED, CONFIRMED, ABANDONED
- `SourcingApprovalStatus`: NOT_REQUIRED, PENDING, APPROVED, REJECTED

### New tables (3)
- `SourcingSession` — persistent AI sourcing session state per user/site
- `SourcingRecommendation` — ranked supplier recommendations for a session
- `SourcingToolInvocation` — tool-call audit log (AI function calls)

### New indexes (10)
- `SourcingSession_userId_idx`
- `SourcingSession_userId_status_idx`
- `SourcingSession_userId_updatedAt_idx`
- `SourcingSession_siteId_idx`
- `SourcingRecommendation_sessionId_idx`
- `SourcingRecommendation_supplierId_idx`
- `SourcingRecommendation_sessionId_rank_key` (UNIQUE)
- `SourcingToolInvocation_sessionId_createdAt_idx`
- `SourcingToolInvocation_userId_createdAt_idx`
- `SourcingToolInvocation_tool_idx`

### New foreign keys (6)
- `SourcingSession.userId → User(id)` RESTRICT
- `SourcingSession.siteId → Site(id)` SET NULL
- `SourcingRecommendation.sessionId → SourcingSession(id)` CASCADE
- `SourcingRecommendation.supplierId → SupplierProfile(id)` RESTRICT
- `SourcingRecommendation.productId → Product(id)` SET NULL
- `SourcingToolInvocation.sessionId → SourcingSession(id)` CASCADE

## Destructive operations

| Category | Count |
|---|---|
| Expected destructive | 0 |
| Unexpected destructive | 0 |
| DROP TABLE | 0 |
| DROP COLUMN | 0 |
| TRUNCATE | 0 |

This migration is **purely additive**. No existing table is altered or dropped.
User, Product, SupplierProfile, Order, and all pricing_* tables are unmodified.

## Production safety

| Table | Expected | Actual | OK |
|---|---|---|---|
| User | 7 | 7 | ✅ |
| Product | 16 | 16 | ✅ |
| Order | 27 | 27 | ✅ |
| SupplierProfile | 2 | 2 | ✅ |
| pricing_source | 37 | 37 | ✅ |
| pricing_district | 38 | 38 | ✅ |
| Sourcing* in production | absent | absent | ✅ |

Production modified: NO. Production schema modified: NO. Production data modified: NO.

## Execution result

```
db:safe:migrate-diff: SUCCESS (exit 0)
Timestamp: 2026-08-13T05:34:19Z
Shadow endpoint used: ep-plain-voice-aoacghjc (prisma-shadow)
Production endpoint: ep-muddy-meadow-aoh42y8u (NOT used)
```

## NOT authorized in this phase

No production migration, no deploy, no seed, no Prisma migration file created.
Phase 6F-4 will handle staging validation and production deployment review.
