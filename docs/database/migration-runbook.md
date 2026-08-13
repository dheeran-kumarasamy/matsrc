# Database Migration Runbook

Phase 6F-2. This runbook is the authoritative safe migration procedure after
the Phase 6F-2 architecture hardening. See
`docs/database/database-safety.md` for the full policy and
`docs/database/phase-6f-1-safety-hardening-report.md` for the incident
that made this necessary.

## The two incidents this runbook prevents repeating

### Phase 6F Incident

`prisma migrate diff` was run with `--shadow-database-url "$DIRECT_URL"` where
`DIRECT_URL` pointed to production. Prisma treats its shadow target as fully
disposable scratch space — it replays all migrations against it — wiping all
application row data. Recovered via Neon Instant Restore.

### Why it can happen

Prisma CLI has no built-in protection against supplying a production database
as the shadow target. The only protection is the repository's safety wrapper.

---

## Safe migration workflow

### Step 1: Preflight (always run first)

```bash
pnpm --filter @matsrc/db db:safety:preflight
```

This reports:
- Environment label (development / staging / production)
- DATABASE_URL identity and Neon endpoint ID
- Whether DATABASE_URL resolves to the known production endpoint
- SHADOW_DATABASE_URL identity and whether it is safe
- Live database metadata (server version, table count, migration status)

**Do not proceed if the preflight reports any WARNING or ERROR.**

### Step 2: Generate migration SQL (if using migrate-diff)

**Requires:** DATABASE_URL pointed at dev branch (NOT production) and
`SHADOW_DATABASE_URL` set to the dedicated shadow branch. Use
`packages/db/.env.local` for this (it overrides `.env` automatically via
the `prisma-safe.js` env-loading logic).

```bash
# Option A: env vars from packages/db/.env.local (recommended)
# Ensure .env.local has DATABASE_URL=dev, DIRECT_URL=dev, SHADOW_DATABASE_URL=shadow
pnpm --filter @matsrc/db db:safe:migrate-diff \
  -- --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --script

# Option B: inline env override (for CI or explicit control)
DATABASE_URL="$DEV_DATABASE_URL" \
DIRECT_URL="$DEV_DIRECT_URL" \
SHADOW_DATABASE_URL="$SHADOW_DATABASE_URL" \
pnpm --filter @matsrc/db db:safe:migrate-diff \
  -- --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --script
```

This is the ONLY safe way to run `migrate diff`. The wrapper:
1. Runs databaseSafetyPreflight() — blocks if any check fails
2. Validates SHADOW_DATABASE_URL is set, isolated, and not production
3. Injects `--shadow-database-url` from SHADOW_DATABASE_URL automatically
4. **You must NOT pass `--shadow-database-url` manually** — the wrapper blocks it

**Requires:** `SHADOW_DATABASE_URL` set to a disposable non-production database.

If you do not have a dedicated shadow database, **hand-author migration SQL
instead** (see Step 3b). This is safer because it does not require any live
database to generate the SQL.

### Step 3a: Apply via migrate deploy (preferred)

```bash
pnpm --filter @matsrc/db db:safe:migrate-deploy
```

Applies committed migration files in order. Safe for production.

### Step 3b: Apply a hand-authored migration

```bash
pnpm --filter @matsrc/db db:safe:db-execute \
  -- --file prisma/migrations/<name>/migration.sql \
  --url "$DIRECT_URL"
```

---

## NEVER do this

```bash
# Phase 6F incident — this wiped production data:
prisma migrate diff \
  --shadow-database-url "$DIRECT_URL"

# Also forbidden — other dangerous direct invocations:
prisma migrate dev
prisma migrate reset
prisma db push
npx prisma migrate diff   # bypasses safety checks; also violates AGENTS.md
```

**The safety wrapper blocks `--shadow-database-url` injection manually.**
If you try to pass it yourself, the wrapper exits with an error.

---

## Verifying safety

```bash
# Confirm which database the shell is pointed at (read-only, no data access)
pnpm --filter @matsrc/db db:identity

# Run all safety unit tests (zero network I/O, zero database connection)
pnpm --filter @matsrc/db db:verify-safety

# Run the CI unsafe-pattern checker
pnpm --filter @matsrc/db db:check-unsafe-patterns

# Full preflight report (connects to database, read-only)
pnpm --filter @matsrc/db db:safety:preflight
```

---

## Shadow database provisioning

### Phase 6F-3: Dedicated shadow database — provisioned

A dedicated `prisma-shadow` branch exists in the same Neon project:

```
Neon project:  bitter-forest-24244420
Branch name:   prisma-shadow
Branch ID:     br-mute-recipe-aoohpl2m
Endpoint ID:   ep-plain-voice-aoacghjc
Database:      neondb
Purpose:       Dedicated disposable shadow for prisma migrate diff ONLY
```

This branch is **NOT** production (`ep-muddy-meadow-aoh42y8u`).  
This branch is **NOT** the PITR evidence branch (`br-wandering-sea-aokghz6w`).  
This branch is **NOT** any recovery evidence branch.

Prisma resets this branch completely during shadow operations. That reset is
fully isolated — it cannot affect production, the PITR branch, or any other
branch.

### Also provisioned: dev branch

```
Branch name:   dev
Branch ID:     br-gentle-block-aokqdued
Endpoint ID:   ep-sparkling-term-aojx078x
Database:      neondb
Purpose:       Local development DATABASE_URL (non-production)
```

Use this as DATABASE_URL/DIRECT_URL when running migrate-diff locally.

### Setting SHADOW_DATABASE_URL

`packages/db/.env` (gitignored) contains the `SHADOW_DATABASE_URL` for the
prisma-shadow branch. `packages/db/.env.local` (also gitignored) contains the
full dev-branch overrides for migrate-diff sessions:

```
DATABASE_URL    → dev branch (ep-sparkling-term-aojx078x)
DIRECT_URL      → dev branch (ep-sparkling-term-aojx078x)
SHADOW_DATABASE_URL → prisma-shadow branch (ep-plain-voice-aoacghjc)
```

**Never set SHADOW_DATABASE_URL to production.** The safety wrapper blocks
this automatically.

### To recreate/rotate the shadow branch

If the shadow branch needs to be recreated:

```bash
neonctl branches delete prisma-shadow --project-id bitter-forest-24244420
neonctl branches create --project-id bitter-forest-24244420 --name prisma-shadow --no-default
neonctl connection-string --project-id bitter-forest-24244420 --branch prisma-shadow --database-name neondb
# Update SHADOW_DATABASE_URL in packages/db/.env with the new connection string
```

Prisma's shadow behavior means the database content is reset on every `migrate diff`
run anyway — the branch just needs to exist and be accessible.

### Forbidden shadow targets

**Never use these as SHADOW_DATABASE_URL:**

| Target | Reason |
|---|---|
| `ep-muddy-meadow-aoh42y8u` (production endpoint) | Production data; Prisma would wipe it |
| `br-long-star-ao464t6w` (production branch) | Production branch |
| `br-wandering-sea-aokghz6w` (PITR evidence) | Incident evidence; must be preserved |
| `br-still-tree-aozfdmbj` (pre-restore snapshot) | Recovery evidence |
| Same URL as DATABASE_URL | Shadow must be distinct from primary |
| Same URL as DIRECT_URL | Exact Phase 6F incident pattern |

### Required checks before using any URL as SHADOW_DATABASE_URL

The safety wrapper verifies all of these automatically:
1. `SHADOW_DATABASE_URL` is set (no fallback to DIRECT_URL — ever)
2. Endpoint ID ≠ production (`ep-muddy-meadow-aoh42y8u`)
3. URL does not resolve to the same identity as `DATABASE_URL` (pooler-normalized)
4. URL does not resolve to the same identity as `DIRECT_URL`
5. `isProductionDatabase()` returns false

---

## Production migration deployment

Production migrations must be:
1. Already validated against staging/scratch first
2. Committed to the repository as a numbered migration file
3. Applied via `db:safe:migrate-deploy` (never `migrate dev`/`migrate diff`)
4. Preceded by a Neon Instant Restore checkpoint confirmation

```bash
# Production deployment
pnpm --filter @matsrc/db db:safety:preflight
pnpm --filter @matsrc/db db:safe:migrate-deploy
```

If something goes wrong, follow `docs/database/production-recovery-runbook.md`.

---

## Production identifiers (non-secret)

These are Neon infrastructure identifiers baked into the safety layer:

| Identifier | Value |
|---|---|
| Neon project | `bitter-forest-24244420` |
| Production branch | `br-long-star-ao464t6w` |
| Production endpoint | `ep-muddy-meadow-aoh42y8u` |
| PITR evidence branch | `br-wandering-sea-aokghz6w` (preserve — do not delete) |
