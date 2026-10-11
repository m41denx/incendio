#!/bin/sh
# In-memory OpenFGA for development and integration tests.
#   scripts/dev-openfga.sh            → http://127.0.0.1:18080, key "dev-openfga-key"
set -eu
cd "$(dirname "$0")/.."
exec .dev/bin/openfga run \
  --datastore-engine memory \
  --http-addr 127.0.0.1:${OPENFGA_PORT:-18080} \
  --grpc-addr 127.0.0.1:${OPENFGA_GRPC_PORT:-18081} \
  --playground-enabled=false \
  --metrics-enabled=false \
  --authn-method preshared \
  --authn-preshared-keys "${OPENFGA_KEY:-dev-openfga-key}" \
  --log-level warn
