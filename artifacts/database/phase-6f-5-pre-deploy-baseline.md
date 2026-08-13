# Phase 6F-5 — Pre-Deploy Production Baseline

## Timestamp

2026-08-13 — captured immediately before applying `20260813000000_add_sourcing_assistant`

## Production identity

| Attribute | Value |
|---|---|
| Neon project | `bitter-forest-24244420` |
| Production branch | `br-long-star-ao464t6w` |
| Production endpoint | `ep-muddy-meadow-aoh42y8u` |
| Preflight identity detection | YES (PRODUCTION) |
| Shadow (for diff only) | `ep-plain-voice-aoacghjc` — confirmed distinct |

## Migration history state

- Total migrations in `_prisma_migrations`: **21**
- Last applied: `20260810130725_add_pricing_geographic_hierarchy` (applied_steps_count=0 — known state, matches production since Phase 6F)
- `20260813000000_add_sourcing_assistant` present: **NO** (safe to proceed)

## Sentinel counts

| Table | Count |
|---|---|
| User | 7 |
| Product | 16 |
| Order | 27 |
| SupplierProfile | 2 |
| pricing_source | 37 |
| pricing_district | 38 |
| pricing_district_price_daily | 228 |
| pricing_scrape_run | 78 |
| pricing_raw_observation | 23 |
| public tables (total) | 58 |
| Sourcing* tables | 0 (ABSENT — correct) |

## Safety status

| Check | Result |
|---|---|
| Production detected | YES |
| Shadow configured | YES |
| Shadow is production | NO |
| Shadow = DATABASE_URL | NO |
| Shadow = DIRECT_URL | NO |
| CONTROLLED_WRITE permitted | YES |
| PITR evidence branch present | `br-wandering-sea-aokghz6w` — ready |
| Recovery branch present | `production_before_restore_20260812` — ready |

## Migration checksums

| File | SHA-256 |
|---|---|
| `artifacts/database/phase-6f-3a-ai-sourcing-migration.sql` | `f0058ce6cc618eb1e6b809aebaf46501dcc6bf68ee0ae8e3236b2663a3bf2b33` |
| `packages/db/prisma/migrations/20260813000000_add_sourcing_assistant/migration.sql` | `f0058ce6cc618eb1e6b809aebaf46501dcc6bf68ee0ae8e3236b2663a3bf2b33` |
| Files identical | YES |

## Pre-deploy decision

All checks passed. Proceeding with production migration.
