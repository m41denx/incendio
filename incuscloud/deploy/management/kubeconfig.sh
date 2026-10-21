#!/bin/sh
# Prints a kubeconfig for IncusCloud's service account (rbac.yaml applied first), using the
# current kubectl context's API server. IncusCloud must reach that address.
#   ./kubeconfig.sh [api-server-url] > mgmt.kubeconfig && chmod 600 mgmt.kubeconfig
set -eu
server=${1:-$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')}
ns=incuscloud-system
for i in $(seq 30); do
  token=$(kubectl -n $ns get secret incuscloud-token -o jsonpath='{.data.token}' 2>/dev/null | base64 -d) && [ -n "$token" ] && break
  sleep 1
done
[ -n "${token:-}" ] || { echo "no token in $ns/incuscloud-token: apply rbac.yaml first" >&2; exit 1; }
ca=$(kubectl -n $ns get secret incuscloud-token -o jsonpath='{.data.ca\.crt}')
cat <<YAML
apiVersion: v1
kind: Config
clusters:
  - name: management
    cluster:
      server: $server
      certificate-authority-data: $ca
users:
  - name: incuscloud
    user:
      token: $token
contexts:
  - name: incuscloud
    context: { cluster: management, user: incuscloud }
current-context: incuscloud
YAML
