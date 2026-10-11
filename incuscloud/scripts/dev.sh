#!/bin/sh
# Runs IncusCloud for development: Hydra and OpenFGA (in memory, started if
# their ports are free), then the server with an embedded PGlite database
# in .dev/db. First run: scripts/dev-deps.sh.
#   https://127.0.0.1:7443  IncusCloud   (sign in: admin@incuscloud.dev / see .dev/admin-password)
#   https://127.0.0.1:4444  Hydra public
set -eu
cd "$(dirname "$0")/.."
DEV="$PWD/.dev"
mkdir -p "$DEV/logs"
[ -s "$DEV/secret-key" ] || head -c 32 /dev/urandom | base64 > "$DEV/secret-key"
[ -s "$DEV/admin-password" ] || head -c 18 /dev/urandom | base64 | tr -d '/+=' > "$DEV/admin-password"

up() { curl -sk -o /dev/null "$1"; }
pids=""
if ! up https://127.0.0.1:4444/health/alive; then
  scripts/dev-hydra.sh > "$DEV/logs/hydra.log" 2>&1 & pids="$pids $!"
fi
if ! up http://127.0.0.1:18080/healthz; then
  scripts/dev-openfga.sh > "$DEV/logs/openfga.log" 2>&1 & pids="$pids $!"
fi
trap 'for p in $pids; do kill $p 2>/dev/null; done' EXIT INT TERM

export IC_LISTEN_PORT=7443
export IC_PUBLIC_URL=https://127.0.0.1:7443
export IC_TLS_CERT="$DEV/tls/server.crt" IC_TLS_KEY="$DEV/tls/server.key"
export IC_DATABASE_URL="pglite:$DEV/db"
export IC_SECRET_KEY="$(cat "$DEV/secret-key")"
export IC_HYDRA_PUBLIC_URL=https://127.0.0.1:4444 IC_HYDRA_ADMIN_URL=https://127.0.0.1:4445 IC_HYDRA_CA_FILE="$DEV/tls/ca.crt"
export IC_OPENFGA_URL=http://127.0.0.1:18080 IC_OPENFGA_TOKEN=dev-openfga-key
export IC_CLUSTER_DOMAIN=127.0.0.1.nip.io
export IC_BOOTSTRAP_ADMIN_EMAIL=admin@incuscloud.dev IC_BOOTSTRAP_ADMIN_PASSWORD="$(cat "$DEV/admin-password")"
export IC_LOG_LEVEL="${IC_LOG_LEVEL:-info}"
cd server && bun src/main.ts
