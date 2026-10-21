#!/bin/sh
# Lets a development cluster (an Incus running in an instance of the host's
# Incus) trust the dev Hydra: installs the dev CA in its trust store and
# restarts incusd so Go reloads the system roots. The reconciler sets oidc.*
# and authorization.* once the cluster is enrolled. Production issuers carry
# publicly trusted certificates and need none of this.
#   scripts/dev-cluster-oidc.sh <project> <instance>
#   e.g. scripts/dev-cluster-oidc.sh incuscloud-dev cluster-b
set -eu
cd "$(dirname "$0")/.."
project=$1 instance=$2
run() { sudo incus exec --project "$project" "$instance" -- "$@"; }
sudo incus file push --project "$project" .dev/tls/ca.crt "$instance/usr/local/share/ca-certificates/incuscloud-dev.crt"
run update-ca-certificates >/dev/null
run systemctl restart incus
echo "$instance trusts the dev CA"
