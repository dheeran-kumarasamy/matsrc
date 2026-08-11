# Phase 6F-1 — Database Safety Hardening: Implementation Report

## Incident Context

During Phase 6F (Geographic Pricing Hierarchy), while investigating a
schema diff, `prisma migrate diff --shadow-database-url` was run with the
production `DIRECT_URL` supplied as the shadow database URL, instead of a
genuinely isolated scratch database. `migrate diff` treats its
`--shadow-database-url` target as fully disposable scratch space — it
replays every migration from scratch against that target to compute the
diff — so pointing it at production wiped most application table data
(schema/DDL was never dropped; only row data was lost).

This was caught within the same session via a manual data-integrity check
(row counts unexpectedly at zero), reported immediately, and recovered via
a Neon Instant Restore to a timestamp just before the incident. Post-restore
row counts were verified to exactly match the pre-incident baseline before
the (already-correct) Phase 6F migration was safely re-applied via `prisma
db execute` against a reviewed `.sql` file — never via `migrate diff`
again.

**Why it happened:** no tooling in this repository distinguished a
production connection string from a disposable one, and no dedicated
scratch/shadow database existed to supply instead. The mistake was
available to make because nothing structurally prevented it.

**Safeguards added in this phase:**
- `databaseSafetyPreflight()` — blocks `migrate-diff` outright unless an
  explicit `SHADOW_DATABASE_URL` is set, and blocks it if that shadow URL
  resolves to the same database identity as `DATABASE_URL`/`DIRECT_URL`.
- A safe wrapper (`prisma-safe.js`) that runs the preflight before ever
  invoking the real `prisma` binary.
- A read-only identity diagnostic (`db-identity.js`) to make it easy to
  confirm what a shell is actually pointed at before running anything.
- Full documentation of the safe/unsafe command set, the correct migration
  workflow, and a recovery runbook, so the next incident (of any kind) has
  a documented, repeatable response.

## Database Command Inventory

| Command | File(s) | Purpose | Can modify DB? | Can destroy DB? | Production-safe? |
|---|---|---|---|---|---|
| `prisma generate` | `packages/db/package.json` (`db:generate`), all 3 Next.js `vercel.json` build commands | Regenerates Prisma Client from schema | No | No | Yes |
| `prisma migrate dev` | `packages/db/package.json` (`db:migrate`), `AGENTS.md` example | Interactive dev migration; can prompt to reset on drift | Yes | Yes | **No** |
| `prisma db push` | `packages/db/package.json` (`db:push`), `AGENTS.md` example | Pushes schema directly, no migration file, can be lossy | Yes | Yes | **No** |
| `prisma studio` | `packages/db/package.json` (`db:studio`) | Interactive data browser/editor | Yes (manual edits) | Only if a human edits/deletes rows | Conditionally (must confirm target first) |
| `prisma migrate diff --shadow-database-url` | Used ad hoc during Phase 6F investigation (not a package.json script) | Computes a schema diff by replaying migrations against a scratch DB | Yes, against the **shadow** target | **Yes — the incident** | **No, unless the shadow target is genuinely isolated** |
| `prisma db execute --file ... --url ...` | Used to apply the Phase 6F migration safely | Runs exactly the given SQL against the given URL | Yes | Only if the SQL itself is destructive | Yes, when the SQL and URL are both reviewed |
| `prisma validate` / `prisma format` | Used throughout Phase 6F for schema checks | Static schema checks/formatting | No | No | Yes |
| Seed scripts (`seed-catalog.js`, `seed-pricing.js`, `seed-pricing-tiers.js`, `seed-pricing-endpoints.js`, `backfill-catalog-master-data.js`, `assign-products-to-suppliers.js`, `create-admin-user.js`) | `packages/db/scripts/*.js` | Idempotent upsert-based seeding/backfill via `new PrismaClient()` reading `DATABASE_URL`/`DIRECT_URL` from the environment | Yes (writes) | Not by design (upsert-based), but writes to whatever `DATABASE_URL` resolves to | Conditionally — always confirm identity first |
| `verify-pricing-source-compliance.js`, `verify-pricing-fingerprint.js`, `verify-pricing-dedupe-hash.js` | `packages/db/scripts/*.js` | Read-only / pure-logic checks | No | No | Yes |
| **New:** `prisma-safe.js` | `packages/db/scripts/prisma-safe.js` | Safety-gated wrapper around the above `prisma` subcommands | Depends on wrapped command | Depends on wrapped command | Yes — this is the safety layer itself |
| **New:** `db-identity.js` | `packages/db/scripts/db-identity.js` | Read-only identity/version diagnostic | No | No | Yes |
| **New:** `verify-db-safety.js` | `packages/db/scripts/verify-db-safety.js` | Pure-logic regression test of the safety module, using only synthetic connection strings | No | No | Yes |

No CI/CD workflow files exist in this repository (`.github/`, GitLab CI,
Jenkins, Azure Pipelines — none found). Deployment is via Vercel; each
app's `vercel.json` `buildCommand` only runs `prisma generate` (read-only),
never a migrate command. **No automated production migration pipeline
exists today** — every migration in this repository's history has been
applied manually. This is itself documented as a finding below (§CI/CD
Findings), not changed.

## Environment Detection

Implemented in `packages/db/lib/db-safety.js`'s `detectEnvironment()`,
using this repo's existing signals (`NODE_ENV`, already used in
`packages/db/index.ts`, `apps/web/lib/prisma.ts`,
`whatsapp-alert-config.service.ts`; `VERCEL_ENV`, used in
`apps/web/next.config.js`) plus an optional `DATABASE_ENV` override for
forward-compatibility. Defaults to `development` when nothing is set —
matching the repo's existing convention — and Vercel's `preview` maps to
`staging`, never `production`.

Crucially, environment detection is **not** the sole gate: the Phase 6F
incident occurred with an effectively-development `NODE_ENV` while the
connection string itself was production. `databaseSafetyPreflight()`
therefore also (and primarily, for the `migrate-diff` case) compares actual
database identity (host/port/database/user), independent of the
environment label.

## Shadow Database Protection

`isSameDatabaseIdentity()` normalizes Neon's `-pooler` host suffix before
comparing, so a pooled `DATABASE_URL` and non-pooled `DIRECT_URL` for the
same Neon project correctly compare as "the same database" — exactly the
comparison that would have caught the Phase 6F incident (production
`DIRECT_URL` supplied as `--shadow-database-url`). `migrate-diff` is now
blocked entirely unless `SHADOW_DATABASE_URL` is both set and provably
distinct from `DATABASE_URL`/`DIRECT_URL`.

This repository does not currently have a dedicated scratch/shadow Neon
database provisioned — this is called out explicitly in
`docs/database/database-safety.md` rather than fabricated.

## Production Protection

`databaseSafetyPreflight()` classifies every operation as `READ_ONLY`,
`CONTROLLED_WRITE`, or `POTENTIALLY_DESTRUCTIVE` (unrecognized operations
fail closed to `POTENTIALLY_DESTRUCTIVE`). When the detected environment is
`production` and the operation is `POTENTIALLY_DESTRUCTIVE` (migrate dev,
migrate reset, db push, migrate diff, seed), the operation is **blocked**,
full stop — no silent redirect, no "continue anyway" default. The only
override is `ALLOW_PRODUCTION_DB_OPERATION=true` in the environment
**combined with** an explicit `allowProductionOverride: true` opt-in at the
call site — the environment variable alone is insufficient, so it cannot be
accidentally left on in a shared `.env`. This override is not referenced by
any deploy path today; it exists purely as a documented manual escape
hatch.

## Migration Workflow

Documented in full in `docs/database/database-safety.md` §"Production
migration procedure" (development → staging → production, each stage
requiring a distinct level of review/backup confirmation) and
`docs/database/migration-safety-checklist.md` (the concrete pre-flight
checklist). No new workflow behavior was introduced beyond documentation
and the opt-in `prisma-safe.js` wrapper — the existing `pnpm --filter
@matsrc/db db:migrate`/`db:push`/`db:generate` scripts were left unchanged
(deleting or renaming them was avoidable and out of scope; the safe
alternatives are additive `db:safe:*` scripts).

## Recovery Runbook

`docs/database/production-recovery-runbook.md` documents the exact 9-step
procedure actually used to recover from the Phase 6F incident (detect →
stop writes → identify window → identify restore point → Neon Instant
Restore [marked MANUAL — Neon Console] → verify row counts → verify
critical tables → verify migrations → resume writes only after
validation), generalized for reuse.

## CI/CD Findings

No CI/CD pipeline exists in this repository. Vercel builds only run `prisma
generate` (read-only). No automated production migration step exists to
guard against — this is a **finding**, reported per §26's instruction
("STOP and report it if fixing it would materially alter production
deployment behavior"), not a gap this phase attempted to close, since doing
so would require introducing new CI infrastructure this repository does not
currently have, which is outside this phase's hard scope boundary
(explicitly forbidden: changing deployment behavior).

## Tests

- `pnpm --filter @matsrc/db db:verify-safety` — new, 100% passing. Covers
  Test A (dev + scratch → SAFE), Test B (dev + production-as-shadow →
  BLOCKED), Test C (production + migrate-dev → BLOCKED), Test D (production
  + migrate-deploy → ALLOWED with notice), Test E (missing shadow →
  BLOCKED), Test F (shadow same identity as production → BLOCKED), Test F2
  (genuinely isolated shadow → SAFE), Test G (credentials never leak into
  preflight output), plus additional coverage for the
  `ALLOW_PRODUCTION_DB_OPERATION` double-gate and fail-closed handling of
  unrecognized operations. All tests use synthetic, fabricated connection
  strings — zero network I/O, zero contact with any real database.
- `apps/api` full suite: 270/271 passing (unchanged from before this
  phase) — 1 pre-existing failure in `src/whatsapp/whatsapp.controller.spec.ts`
  (webhook-verify test), confirmed via `git diff` to be untouched by any
  phase, including this one.
- `apps/web` full suite: 61/61 passing (unchanged).
- `apps/supplier` full suite: 31/31 passing (unchanged).
- `prisma validate`: schema valid (unchanged).
- Live read-only verification (`db-identity.js`) against the real
  development database: environment=development, host/database correctly
  identified, no credentials printed, server version confirmed
  (PostgreSQL 17.10).
- Live read-only Phase 6F data-integrity re-check: `pricing_district=38`,
  `pricing_state=1`, `pricing_source=37`, `pricing_source_endpoint=27`,
  `pricing_raw_observation=23`, `pricing_observation=0`,
  `pricing_district_price_daily=0`, `pricing_trend_monthly=0`,
  `pricing_alert_evaluation=0`, `pricing_anomaly=0`,
  `AGNI_STEELS.isEnabled=false`, `tosReviewedAt=null` — all exactly
  matching the post-Phase-6F baseline. No data was modified by this phase.

## Remaining Risks

- No dedicated scratch/shadow Neon database exists yet. Until one is
  provisioned, `migrate diff` cannot be used at all (by design — it is
  blocked with no valid `SHADOW_DATABASE_URL` to supply). Migrations must
  continue to be hand-authored and reviewed, as was done for Phase 6F.
- `prisma-safe.js` is an opt-in wrapper, not something Prisma itself can be
  forced to route through — a developer can still invoke `pnpm exec prisma
  migrate diff ...` directly, bypassing the wrapper. The real protection
  against that is the documentation in `database-safety.md` plus this
  wrapper being the *recommended* path; a hard technical block at the
  `prisma` binary level is not achievable without forking/patching Prisma
  itself, which is out of scope.
- No CI/CD exists to enforce any of this automatically on every commit —
  the safety net is currently: documentation + opt-in tooling + human
  discipline. This is an accurate, not sensationalized, characterization of
  the current state.
- `ALLOW_PRODUCTION_DB_OPERATION` is a manual escape hatch; like any manual
  override, its safety depends on it never being set persistently in a
  shared environment file.

## Recommendations

1. Provision a genuinely isolated Neon scratch/shadow database (a separate
   Neon project or a dedicated branch never used for anything else) so
   `migrate diff` can be safely re-enabled.
2. Consider wiring `pnpm --filter @matsrc/db db:identity` into any future
   CI/CD pipeline as a pre-migration step, once such a pipeline exists.
3. Consider making `prisma-safe.js` the *only* documented way to run
   `migrate deploy`/`db execute` in onboarding docs, so the safe path is
   the path of least resistance, not an easily-skipped extra step.
4. Revisit this document if/when a real CI/CD pipeline is introduced, to
   wire the preflight check into that pipeline rather than relying solely
   on local developer discipline.
