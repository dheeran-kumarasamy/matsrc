# Migration Safety Checklist

Phase 6F-1. Use this checklist before running any migration against
staging or production. See `docs/database/database-safety.md` for the full
policy this checklist enforces, and
`docs/database/production-recovery-runbook.md` for what to do if something
still goes wrong despite following it.

## Pre-migration checklist

```
[ ] Correct environment confirmed
    - Ran `pnpm --filter @matsrc/db db:identity` and visually confirmed the
      printed environment + host + database match the intended target.

[ ] Target database confirmed
    - The redacted host/database printed by db:identity is the one you
      actually intend to modify — not copy-pasted from a different .env.

[ ] Backup/restore point available
    - Neon's Instant Restore history window covers "now" (see project
      Settings -> Instant Restore in the Neon Console for the configured
      retention).

[ ] Shadow database is isolated (if `prisma migrate diff` is used at all)
    - `SHADOW_DATABASE_URL` is set, and it is NOT the same identity as
      DATABASE_URL/DIRECT_URL. `pnpm --filter @matsrc/db db:safe:migrate-diff`
      enforces this automatically and blocks otherwise.

[ ] Migration reviewed
    - Every generated/hand-authored .sql file has been read line by line by
      a human, not merely generated and trusted.

[ ] Migration tested on scratch/staging
    - The exact migration file has been successfully applied to a
      non-production database first.

[ ] Expected destructive operations identified
    - Any DROP COLUMN / DROP TABLE / NOT NULL tightening / unique-constraint
      change in the migration is explicitly called out and justified.

[ ] Row-count baseline captured where appropriate
    - For every table the migration touches, capture `SELECT count(*)`
      immediately before applying, so a post-migration comparison is
      possible (see the Phase 6F migration file's own documented baseline
      for the pattern to follow).

[ ] Production migration explicitly approved
    - A human has explicitly said "apply this to production now" — this is
      never an automatic/scheduled/CI-triggered step in this repository
      today (see `docs/database/phase-6f-1-safety-hardening-report.md`
      §CI/CD Findings).
```

## Recommended commands

```bash
# 1. Confirm identity first, always.
pnpm --filter @matsrc/db db:identity

# 2. Apply a reviewed migration (preferred: already-committed migration
#    files via migrate deploy).
pnpm --filter @matsrc/db db:safe:migrate-deploy

# 3. Or, for a hand-authored one-off migration file (as used for Phase 6F):
pnpm --filter @matsrc/db db:safe:db-execute -- --file prisma/migrations/<name>/migration.sql --url "$DIRECT_URL"
```

Do not run `prisma migrate dev`, `prisma migrate reset`, `prisma db push`,
or `prisma migrate diff --shadow-database-url` against anything other than
a disposable local/scratch database. See
`docs/database/database-safety.md` §"Unsafe Prisma command patterns".
