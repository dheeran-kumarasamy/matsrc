# Production Database Recovery Runbook

Phase 6F-1. This runbook documents the procedure actually used to recover
from the Phase 6F production data-loss incident, generalized for any future
incident of the same class (accidental destructive operation against the
production Neon database). See
`docs/database/phase-6f-1-safety-hardening-report.md` for the specific
incident narrative.

Any step marked **[MANUAL — Neon Console]** cannot currently be scripted
from within this repository and requires a human with Neon project access
(this runbook does not invent Neon CLI/API commands that were not already
established as part of this project's operational procedure).

## 1. Detect incident

Signs an incident may have occurred:
- Application errors indicating missing expected rows (e.g. login/lookup
  failures for data that should exist).
- A manual `pnpm --filter @matsrc/db db:identity`-style row-count check
  returning unexpectedly low counts.
- A destructive-classified Prisma command (see
  `docs/database/database-safety.md` §"Unsafe Prisma command patterns") was
  just run and its target database identity is in doubt.

## 2. Stop all database-writing activity

- Immediately stop any running ingestion/seed/migration script.
- Do not run any further Prisma command (including `db:identity`'s
  read-only `SELECT version()` is fine, but avoid anything else) until the
  scope of the incident is understood.
- Do not attempt to "fix it forward" by re-seeding or re-inserting data —
  this can make an Instant Restore harder to reason about (new rows created
  after the incident would also be rolled back).

## 3. Identify the affected time window

- Note the exact wall-clock time (UTC) the suspect command was run. File
  timestamps on any generated migration/diff output are a reliable anchor
  (this is how the Phase 6F incident's window was established — the
  `/tmp/diff.sql` file's own mtime).
- The restore target should be a timestamp **just before** that command ran
  (a minute or two of safety margin), not "as early as possible" — an
  overly conservative restore point can lose legitimate data created
  between the safe point and the incident.

## 4. Identify the latest valid restore point

**[MANUAL — Neon Console]** Neon Console → Project → Branches → select the
affected branch → confirm the project's Instant Restore history window
(Settings → Instant Restore) covers the timestamp identified in step 3.

## 5. Perform Neon Instant Restore

**[MANUAL — Neon Console or `neonctl`]** Restore the affected branch to the
timestamp identified in step 3. This is a branch-level operation, not a
per-table operation — it restores the entire branch's data (and schema) to
that point in time.

```bash
# If using the Neon CLI (only if already an established part of this
# project's operational tooling — confirm access before assuming this
# command is available):
neonctl branches restore <branch-id> --project-id <project-id> --timestamp <ISO-8601-timestamp>
```

Console path: **Branches → select branch → Restore → "Restore to
timestamp"**.

## 6. Verify row counts

Immediately after restore, run read-only checks against every table
believed affected. This project already has an established ad hoc pattern
for this (a small Node script using `@prisma/client`, e.g.):

```js
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const tables = ["User", "Product", "Order", "Site", "Watchlist" /* ... */];
  for (const t of tables) {
    console.log(t, (await prisma.$queryRawUnsafe(`SELECT count(*) FROM "${t}"`))[0].count.toString());
  }
  await prisma.$disconnect();
})();
```

Compare against the last known-good baseline (see
`docs/pricing/geographic-pricing-implementation-report.md` §4 for the exact
baseline numbers used during the Phase 6F recovery).

## 7. Verify critical tables

Beyond row counts, spot-check that specific known rows still have expected
content (e.g. `AGNI_STEELS.isEnabled === false`, a specific known
`PricingDistrict` row's fields) — a row count matching does not by itself
prove the *content* wasn't altered by an intervening operation.

## 8. Verify migrations

Check `_prisma_migrations` (if the project uses `prisma migrate deploy`
tracking) and re-run `pnpm --filter @matsrc/db db:identity` plus a schema
spot-check (e.g. confirm expected columns/constraints exist via
`information_schema`) to confirm the restore did not also revert a
since-applied, wanted schema migration.

## 9. Resume writes only after validation

Do not resume any ingestion/seed/application write traffic until steps 6-8
are all confirmed. Document the incident (timeline, root cause, what was
restored) before closing it out — see
`docs/database/phase-6f-1-safety-hardening-report.md` as the template for
this kind of write-up.
