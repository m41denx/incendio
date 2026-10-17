#!/bin/sh
# Prepares a Docker Compose install of IncusCloud in this directory:
#   .env             secrets and names for docker-compose.yml
#   incuscloud.env   IncusCloud's own settings (IC_*)
#   certs/           an internal CA, Hydra's certificate and, unless you bring
#                    your own, a certificate for IncusCloud signed by that CA
#   k8s/             where the management cluster's kubeconfig goes (optional)
#
#   ./setup.sh --host cloud.example.com --cluster-domain clusters.example.com \
#              --admin admin@example.com [--openfga-host 10.0.0.5]
#
# Safe to run again: existing secrets, settings and certificates are kept.
set -eu
cd "$(dirname "$0")"

host="" domain="" admin="" fga_host=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) host=$2; shift 2 ;;
    --cluster-domain) domain=$2; shift 2 ;;
    --admin) admin=$2; shift 2 ;;
    --openfga-host) fga_host=$2; shift 2 ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done

command -v openssl >/dev/null || { echo "setup.sh needs openssl" >&2; exit 1; }
umask 077
rand() { openssl rand -hex "$1"; }

if [ ! -f .env ]; then
  [ -n "$host" ] && [ -n "$domain" ] && [ -n "$admin" ] || { echo "first run: --host, --cluster-domain and --admin are required" >&2; exit 2; }
  cat > .env <<ENV
# docker-compose.yml's settings, made by setup.sh. Keep this file private.
PUBLIC_HOST=$host
CLUSTER_DOMAIN=$domain
# The image to run (docker-compose.build.yml builds it from this repository instead).
INCUSCLOUD_IMAGE=ghcr.io/m41denx/incuscloud:latest
# Addresses to publish IncusCloud (443) and OpenFGA (8080) on.
IC_BIND=0.0.0.0
OPENFGA_BIND=0.0.0.0
# The user the containers run as: the owner of ./certs.
IC_UID=$(id -u)
IC_GID=$(id -g)
POSTGRES_PASSWORD=$(rand 24)
HYDRA_DB_PASSWORD=$(rand 24)
OPENFGA_DB_PASSWORD=$(rand 24)
INCUSCLOUD_DB_PASSWORD=$(rand 24)
HYDRA_SECRET=$(rand 32)
OPENFGA_KEY=$(rand 32)
ENV
  echo "wrote .env"
fi
# shellcheck disable=SC1091
. ./.env

if [ ! -f incuscloud.env ]; then
  [ -n "$admin" ] || { echo "--admin is required to write incuscloud.env" >&2; exit 2; }
  cat > incuscloud.env <<ENV
# IncusCloud's settings, made by setup.sh (every IC_* variable: incuscloud/server/.env.example).
IC_PUBLIC_URL=https://$PUBLIC_HOST
IC_CLUSTER_DOMAIN=$CLUSTER_DOMAIN
IC_TLS_CERT=/certs/public/tls.crt
IC_TLS_KEY=/certs/public/tls.key
IC_DATABASE_URL=postgres://incuscloud:$INCUSCLOUD_DB_PASSWORD@postgres:5432/incuscloud
# Seals cluster client keys and refresh tokens. Back it up: losing it loses every enrolled cluster.
IC_SECRET_KEY=$(openssl rand -base64 32)
IC_HYDRA_PUBLIC_URL=https://hydra:4444
IC_HYDRA_ADMIN_URL=https://hydra:4445
IC_HYDRA_CA_FILE=/certs/ca.crt
IC_OPENFGA_URL=http://openfga:8080
IC_OPENFGA_TOKEN=$OPENFGA_KEY
# OpenFGA as the Incus clusters reach it (this host, port 8080).
IC_OPENFGA_CLUSTER_URL=http://${fga_host:-$PUBLIC_HOST}:8080
# The first platform administrator, created while there is none. Change the password after signing in.
IC_BOOTSTRAP_ADMIN_EMAIL=$admin
IC_BOOTSTRAP_ADMIN_PASSWORD=$(rand 12)
IC_RECONCILE_INTERVAL=60
IC_INVENTORY_INTERVAL=60
IC_LOG_LEVEL=info
# Kubernetes: the management cluster's kubeconfig, copied to ./k8s/.
#IC_K8S_KUBECONFIG=/etc/incuscloud/k8s/mgmt.kubeconfig
ENV
  echo "wrote incuscloud.env (the first admin's password is IC_BOOTSTRAP_ADMIN_PASSWORD there)"
fi

mkdir -p certs/public k8s
umask 022
c=certs
if [ ! -f $c/ca.crt ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout $c/ca.key -out $c/ca.crt \
    -days 3650 -subj "/CN=IncusCloud internal CA" 2>/dev/null
  chmod 600 $c/ca.key
  echo "made the internal CA: certs/ca.crt"
fi
sign() { # name, subjectAltName, key file, certificate file
  openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "$3" -out "$4.csr" -subj "/CN=$1" 2>/dev/null
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\n' "$2" > "$4.ext"
  openssl x509 -req -in "$4.csr" -CA $c/ca.crt -CAkey $c/ca.key -CAcreateserial -out "$4" -days 825 -extfile "$4.ext" 2>/dev/null
  rm -f "$4.csr" "$4.ext"
  chmod 600 "$3"
}
[ -f $c/hydra.crt ] || { sign hydra "DNS:hydra" $c/hydra.key $c/hydra.crt; echo "made Hydra's certificate"; }
if [ ! -f $c/public/tls.crt ]; then
  sign "$PUBLIC_HOST" "DNS:$PUBLIC_HOST,DNS:*.$CLUSTER_DOMAIN" $c/public/tls.key $c/public/tls.crt
  echo "made a certificate for $PUBLIC_HOST and *.$CLUSTER_DOMAIN, signed by the internal CA."
  echo "  Browsers, incus clients and every Incus cluster must trust certs/ca.crt,"
  echo "  or replace certs/public/tls.crt and tls.key with a publicly trusted certificate (INSTALL.md, \"Certificates\")."
fi
echo "ready: docker compose up -d"
