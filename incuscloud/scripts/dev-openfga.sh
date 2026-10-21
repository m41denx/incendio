#!/bin/sh
# OpenFGA for development and integration tests, kept in .dev/openfga.db.
# Clusters connect to it themselves (their stores, spec D4), so it listens on
# IC_DEV_HOST when set (an address the dev clusters can reach).
#   scripts/dev-openfga.sh   → http://${IC_DEV_HOST:-127.0.0.1}:18080, key "dev-openfga-key"
set -eu
cd "$(dirname "$0")/.."
host=${IC_DEV_HOST:-127.0.0.1}
db="file:$PWD/.dev/openfga.db"
.dev/bin/openfga migrate --datastore-engine sqlite --datastore-uri "$db" > /dev/null
exec .dev/bin/openfga run \
  --datastore-engine sqlite \
  --datastore-uri "$db" \
  --http-addr "$host:${OPENFGA_PORT:-18080}" \
  --grpc-addr 127.0.0.1:${OPENFGA_GRPC_PORT:-18081} \
  --playground-enabled=false \
  --metrics-enabled=false \
  --authn-method preshared \
  --authn-preshared-keys "${OPENFGA_KEY:-dev-openfga-key}" \
  --log-level warn
