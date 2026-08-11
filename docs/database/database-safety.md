# Database Safety — Authoritative Policy

Phase 6F-1. This document is the authoritative reference for how database
operations (Prisma CLI commands, seed/backfill scripts, migrations) must be
run in this repository, following the Phase 6F production data-loss
incident (see `docs/database/phase-6f-1-safety-hardening-report.md` for the
full account).

## Environment model

Detected by `packages/db/lib/db-safety.js`'s `detectEnvironment()`, in this
precedence order:

1. `DATABASE_ENV` (explicit override; not currently set anywhere in this
   repo's `.env` files — available for a future need, never invented as a
   requirement here).
2. `VERCEL_ENV` (`production` | `preview` | `development` — Vercel sets this
   automatically at build/runtime; `preview` is treated as `staging`, never
   `production`).
3. `NODE_ENV` (`production` | `development` | `test`).
4. Defaults to `development` if none of the above are set.

This mirrors signals already used elsewhere in the codebase (e.g.
`packages/db/index.ts`, `apps/web/lib/prisma.ts`,
`whatsapp-alert-config.service.ts`'s existing `NODE_ENV=production` guard).

**Environment labels are necessary but not sufficient.** The Phase 6F
incident happened while running commands locally (`NODE_ENV` effectively
unset/development) against a connection string that was itself production.
This is why every safety check in this repo is ultimately anchored to
**database identity** (host + port + database + user parsed from the
connection string), not to the environment label alone.

## Database identity

`packages/db/lib/db-safety.js` exposes:

- `parseConnectionString(url)` — parses a `postgres(ql)://` URL into
  `{ host, port, database, user }`. Neon's `-pooler` host suffix is
  stripped before comparison, so a pooled `DATABASE_URL` and a non-pooled
  `DIRECT_URL` for the **same** Neon project correctly compare as the same
  identity.
- `isSameDatabaseIdentity(a, b)` — true only when host/port/database/user
  all match. Deliberately excludes the password (a rotated credential for
  the same database must still compare as "same").
- `redactConnectionString(url)` — returns `protocol://user@host:port/database`
  with the password always stripped. Used for every log line this tooling
  produces.

## Shadow database rules

> Prisma shadow databases must always be isolated from production and
> application databases. No shadow database may share a host, port,
> database name, and user with `DATABASE_URL` or `DIRECT_URL`.

Enforced by `databaseSafetyPreflight()` (see below) for the `migrate-diff`
operation specifically — the exact command involved in the Phase 6F
incident. If `SHADOW_DATABASE_URL` is unset, `migrate-diff` is **blocked**
outright rather than silently falling back to `DATABASE_URL`/`DIRECT_URL`.

This repository does not currently have a dedicated scratch/shadow Neon
database provisioned. Until one exists, `prisma migrate diff
--shadow-database-url` should not be run at all — hand-author migration SQL
(as was ultimately done safely for the Phase 6F migration, via `prisma db
execute` against a reviewed `.sql` file) instead of relying on `migrate
diff` to generate it.

## Safe Prisma commands

| Command | Classification | Notes |
|---|---|---|
| `prisma generate` | READ_ONLY | Never touches a live database's data. |
| `prisma validate` | READ_ONLY | Validates schema syntax only. |
| `prisma format` | READ_ONLY | Formats the schema file only. |
| `prisma migrate deploy` | CONTROLLED_WRITE | Applies already-committed migration files in order. Idempotent — never generates new SQL, never prompts, never resets. Safe against production **when the migrations were already reviewed**. |
| `prisma db execute --file ... --url ...` | CONTROLLED_WRITE | Runs exactly the SQL in the given file against the given URL. Safe when the SQL was reviewed and the URL is intentional (this is how the Phase 6F migration was ultimately, safely, re-applied). |
| `prisma studio` | CONTROLLED_WRITE | Interactive data browser/editor — not itself destructive, but must never be pointed at production without realizing it. |

## Unsafe Prisma command patterns

| Command | Classification | Why |
|---|---|---|
| `prisma migrate dev` | POTENTIALLY_DESTRUCTIVE | Can drop/recreate the shadow database, can prompt to reset on drift, generates and applies new migrations interactively. Development-only. |
| `prisma migrate reset` | POTENTIALLY_DESTRUCTIVE | Drops and recreates the entire database. Never run outside a disposable local/CI database. |
| `prisma db push` | POTENTIALLY_DESTRUCTIVE | Can silently apply data-lossy schema changes without a migration file or review step. |
| `prisma migrate diff --shadow-database-url <URL>` | POTENTIALLY_DESTRUCTIVE | **The command involved in the Phase 6F incident.** `migrate diff` treats its `--shadow-database-url` target as fully disposable scratch space — it drops/recreates that schema to replay migrations. If `<URL>` is production (or resolves to the same identity as `DATABASE_URL`/`DIRECT_URL`), this destroys production data. |
| Any seed/backfill script (`db:seed`-style) | POTENTIALLY_DESTRUCTIVE (by classification) | Even upsert-based seed scripts write to whatever `DATABASE_URL` happens to resolve to — always confirm identity first with `pnpm --filter @matsrc/db db:identity`. |

### Examples of commands that MUST NOT be run

```bash
# NEVER: production URL used as a shadow database.
prisma migrate diff --shadow-database-url "$DIRECT_URL" ...   # if DIRECT_URL is production

# NEVER: interactive/destructive dev commands against production.
DATABASE_URL="<production>" prisma migrate dev
DATABASE_URL="<production>" prisma migrate reset
DATABASE_URL="<production>" prisma db push

# NEVER: copying a production connection string into a local .env "to test something quickly".
```

## Production migration procedure

### Development

```
schema change
  -> hand-author or (once a real scratch DB exists) generate migration SQL
  -> review the generated SQL line by line
  -> apply to a scratch/local database
  -> run tests
```

### Staging

```
reviewed migration
  -> confirm a Neon backup/restore point exists
  -> `prisma migrate deploy` (or `prisma db execute` for a hand-authored
     migration, as used for Phase 6F) against staging
  -> verify row counts / schema shape
```

### Production

```
validated migration (already run successfully against staging)
  -> confirm Neon's Instant Restore window covers "right now"
  -> capture a pre-migration row-count baseline for every affected table
  -> explicit, deliberate decision to deploy
  -> `prisma migrate deploy` or `prisma db execute` (never `migrate dev`,
     `migrate reset`, `db push`, or `migrate diff --shadow-database-url`
     pointed at production)
  -> verify row counts against the baseline immediately after
```

See `docs/database/migration-safety-checklist.md` for the concrete
pre-migration checklist and `docs/database/production-recovery-runbook.md`
for what to do if something still goes wrong.

## Emergency procedure

If a genuinely urgent production database operation is required that this
policy would otherwise block, the only sanctioned path is:

```
ALLOW_PRODUCTION_DB_OPERATION=true
```

set explicitly in the shell/environment for that one invocation. This is
consumed by `databaseSafetyPreflight()` and, even then, **only takes effect
when the calling script also explicitly opts in** (`allowProductionOverride:
true` in code) — the environment variable alone is never sufficient. This
double-gate exists so the override can never be flipped on "by habit" in a
shared `.env` file.

`ALLOW_PRODUCTION_DB_OPERATION` is not currently referenced by any
production deploy path or CI job in this repository — it exists purely as a
documented, auditable manual escape hatch, and its use should be logged
(the preflight result includes an explicit `warning` string when it is
exercised).

## Verification procedure

```bash
# Read-only: confirm exactly which database/environment the current shell
# is pointed at, without ever printing a credential.
pnpm --filter @matsrc/db db:identity

# Pure-logic safety-check regression (no database connection at all).
pnpm --filter @matsrc/db db:verify-safety
```

## Common failure modes

- **`DATABASE_URL` used as `SHADOW_DATABASE_URL`** — blocked by
  `databaseSafetyPreflight()` for `migrate-diff`.
- **`prisma migrate dev` run against production** — blocked when
  `environment` resolves to `production`.
- **`prisma db reset` / `db push` against production** — same block.
- **`prisma migrate diff` with production supplied as its shadow** — the
  exact Phase 6F incident; blocked by identity comparison, not just
  environment label.
- **Copying a production connection string into a local `.env` "to test
  something quickly"** — makes every one of the above failure modes
  possible from a machine that believes itself to be "just local
  development". Always run `pnpm --filter @matsrc/db db:identity` after
  editing any `.env` file and before running any Prisma command.
