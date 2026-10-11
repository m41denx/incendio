#!/bin/sh
# Points a development cluster (an Incus running in an instance of the host's
# Incus) at the dev Hydra: installs the dev CA in its trust store, restarts
# incusd so Go reloads the system roots, and sets oidc.*.
#   scripts/dev-cluster-oidc.sh <project> <instance> <issuer-url>
#   e.g. scripts/dev-cluster-oidc.sh incuscloud-dev cluster-b https://10.133.241.1:4444/
# Production clusters are configured by the reconciler (P3).
set -eu
cd "$(dirname "$0")/.."
project=$1 instance=$2 issuer=$3
run() { sudo incus exec --project "$project" "$instance" -- "$@"; }
sudo incus file push --project "$project" .dev/tls/ca.crt "$instance/usr/local/share/ca-certificates/incuscloud-dev.crt"
run update-ca-certificates >/dev/null
run systemctl restart incus
run incus config set oidc.issuer="$issuer" oidc.client.id=incus-cli oidc.audience=incuscloud oidc.claim=sub
echo "$instance: oidc.issuer=$(run incus config get oidc.issuer)"
