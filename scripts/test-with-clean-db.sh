#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required. Run this through 'make test' so the managed database settings are loaded." >&2
  exit 2
fi

POSTGRES_USER="${POSTGRES_USER:-inkway}"
test_db="ink_test_${$}_${RANDOM}"
handler_only=0
if [[ "${1:-}" == "--handler-only" ]]; then
  handler_only=1
  shift
fi
if [[ ! "$test_db" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  echo "Could not generate a valid temporary database name." >&2
  exit 2
fi

test_database_created=0
cleanup() {
  if [[ "$test_database_created" == 1 ]]; then
    docker compose exec -T postgres psql -X -U "$POSTGRES_USER" -d postgres \
      -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$test_db\" WITH (FORCE);" >/dev/null || {
        echo "Warning: failed to remove temporary database '$test_db'." >&2
      }
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> Creating clean temporary test database '$test_db'..."
docker compose exec -T postgres psql -X -U "$POSTGRES_USER" -d postgres \
  -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$test_db\";" >/dev/null
test_database_created=1

# Preserve credentials and SSL/query options from the managed connection while
# replacing only its database component. Node is already a required workspace
# tool and URL handles escaped credentials without exposing the connection URL.
test_database_url="$(node --input-type=module -e '
  const url = new URL(process.argv[1]);
  url.pathname = `/${process.argv[2]}`;
  process.stdout.write(url.toString());
' "$DATABASE_URL" "$test_db")"
export DATABASE_URL="$test_database_url"

echo "==> Applying the complete current migration set to the temporary database..."
(cd server && go run ./cmd/migrate up)

echo "==> Running Go tests against the clean migrated database..."
if [[ "$handler_only" == 1 ]]; then
  (cd server && go test -race ./internal/handler -count=1 "$@")
else
  bash scripts/test-go.sh "$@"
fi
