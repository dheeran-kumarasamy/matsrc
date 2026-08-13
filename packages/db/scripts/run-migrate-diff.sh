#!/usr/bin/env bash
# packages/db/scripts/run-migrate-diff.sh
# Phase 6F-3A — warm-and-run for prisma migrate diff via safety wrapper.
# Keeps shadow endpoint alive with a background psql while Prisma runs.
# Does NOT bypass the safety wrapper. Does NOT touch production.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env files: .env.local first (higher priority), then .env.
# Only set variables not already in the environment.
_load_env() {
  local envfile="$1"
  [[ -f "$envfile" ]] || return 0
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    local key="${BASH_REMATCH[1]}"
    local val="${BASH_REMATCH[2]}"
    # Strip surrounding quotes
    val="${val%\"}"
    val="${val#\"}"
    val="${val%\'}"
    val="${val#\'}"
    # Only set if not already in environment
    if [[ -z "${!key+x}" ]]; then
      export "$key=$val"
    fi
  done < "$envfile"
}
_load_env "$DB_DIR/.env.local"
_load_env "$DB_DIR/.env"

if [[ -z "${SHADOW_DATABASE_URL:-}" ]]; then
  echo "SHADOW_DATABASE_URL is not set. Aborting." >&2
  exit 1
fi

echo "Waking shadow endpoint with psql..." >&2
for i in 1 2 3 4 5; do
  if psql "$SHADOW_DATABASE_URL" -c "SELECT 1" -t --no-psqlrc 2>/dev/null | grep -q 1; then
    echo "Shadow endpoint awake (attempt $i)" >&2
    break
  fi
  echo "Wake attempt $i failed, retrying..." >&2
  sleep 2
done

echo "Starting background keepalive psql (pg_sleep 90)..." >&2
psql "$SHADOW_DATABASE_URL" -c "SELECT pg_sleep(90)" --no-psqlrc >/dev/null 2>&1 &
KEEPALIVE_PID=$!
echo "Keepalive PID: $KEEPALIVE_PID" >&2
sleep 2

echo "Invoking safety wrapper (prisma-safe.js migrate-diff)..." >&2
# All safety-wrapper output (preflight, audit) goes to stderr.
# Prisma SQL output goes to stdout only.
cd "$DB_DIR"
node scripts/prisma-safe.js migrate-diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --script
DIFF_EXIT=$?

kill "$KEEPALIVE_PID" 2>/dev/null || true
wait "$KEEPALIVE_PID" 2>/dev/null || true

if [[ $DIFF_EXIT -ne 0 ]]; then
  echo "migrate-diff exited with code $DIFF_EXIT" >&2
  exit $DIFF_EXIT
fi

echo "migrate-diff completed successfully." >&2
