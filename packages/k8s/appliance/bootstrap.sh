#!/usr/bin/env bash
# Incendio Kubernetes management-appliance bootstrap.
#
# This script is PUBLISHED to GitHub Releases and pulled by cloud-init when the
# Incendio SPA creates the management container (see
# docs/k8s/management-appliance.md §4). cloud-init has already written the
# agent config + Incus client credentials under /etc/incendio before we run.
#
# It is deliberately the *only* heavy, host-shaped logic in the system: the
# agent stays a thin broker and Incus hosts stay pure. Everything here is
# idempotent so a re-run (or a cloud-init retry) converges rather than breaks.
#
# Environment (with defaults) — overridable via cloud-init:
#   INCENDIO_RELEASE_REPO   GitHub repo hosting the k8s-api binary release.
#   INCENDIO_RELEASE_TAG    Release tag to pin (binary + this script).
#   K3S_VERSION             Pinned k3s channel/version.
#   CLUSTERCTL_VERSION      Pinned clusterctl release.
#   CAPN_VERSION            Pinned cluster-api-provider-incus release.
set -euo pipefail

CONF_DIR=/etc/incendio
OPT_DIR=/opt/incendio
AGENT_BIN=/usr/local/bin/incendio-k8s
ENV_FILE="${CONF_DIR}/agent.env"

INCENDIO_RELEASE_REPO="${INCENDIO_RELEASE_REPO:-m41denx/incendio}"
INCENDIO_RELEASE_TAG="${INCENDIO_RELEASE_TAG:-appliance-v1}"
K3S_VERSION="${K3S_VERSION:-v1.37.0+k3s1}"
CLUSTERCTL_VERSION="${CLUSTERCTL_VERSION:-v1.14.2}"
CAPN_VERSION="${CAPN_VERSION:-v0.9.1}"

log() { printf '[incendio-bootstrap] %s\n' "$*" >&2; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    log "must run as root"
    exit 1
  fi
}

arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) log "unsupported arch $(uname -m)"; exit 1 ;;
  esac
}

# --- 1. nested-container prerequisites -------------------------------------
# k3s/kubelet expect a writable /dev/kmsg and cgroup access. In a privileged,
# nested Incus container these need a light shim; the container profile already
# sets security.nesting=true + security.privileged=true.
prepare_host_shims() {
  if [ ! -e /dev/kmsg ]; then
    log "shimming /dev/kmsg -> /dev/console"
    ln -sf /dev/console /dev/kmsg
  fi
  # Persist the shim across reboots before k3s starts.
  install -d /etc/systemd/system
  cat >/etc/systemd/system/incendio-kmsg-shim.service <<'UNIT'
[Unit]
Description=Incendio /dev/kmsg shim for nested k3s
DefaultDependencies=no
Before=sysinit.target k3s.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c '[ -e /dev/kmsg ] || ln -sf /dev/console /dev/kmsg'
RemainAfterExit=yes

[Install]
WantedBy=sysinit.target
UNIT
  systemctl daemon-reload
  systemctl enable incendio-kmsg-shim.service >/dev/null 2>&1 || true
}

install_base_packages() {
  export DEBIAN_FRONTEND=noninteractive
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y --no-install-recommends curl ca-certificates openssl tar
  fi
}

# --- 2. Incus server cert into the OS trust store --------------------------
# Bun won't trust a self-signed leaf via a `ca` bundle, so the agent relies on
# the OS store to verify the Incus API server cert.
trust_incus_server_cert() {
  if [ -s "${CONF_DIR}/server.crt" ]; then
    install -m 0644 "${CONF_DIR}/server.crt" \
      /usr/local/share/ca-certificates/incus-server.crt
    update-ca-certificates || true
  fi
}

# --- 3. single-node k3s management cluster ---------------------------------
# traefik + servicelb disabled (docs §1); native snapshotter because overlayfs
# is unreliable in a nested container.
install_k3s() {
  if systemctl is-active --quiet k3s 2>/dev/null; then
    log "k3s already running"
    return
  fi
  log "installing k3s ${K3S_VERSION}"
  curl -fsSL https://get.k3s.io \
    | INSTALL_K3S_VERSION="${K3S_VERSION}" \
      INSTALL_K3S_EXEC="--disable=traefik --disable=servicelb --snapshotter=native" \
      sh -
  # Wait for the node to register before we init CAPI into it.
  local kubeconfig=/etc/rancher/k3s/k3s.yaml
  for _ in $(seq 1 60); do
    if k3s kubectl --kubeconfig "${kubeconfig}" get nodes 2>/dev/null \
         | grep -q ' Ready '; then
      log "k3s node Ready"
      return
    fi
    sleep 5
  done
  log "k3s node did not become Ready in time"
  exit 1
}

install_clusterctl() {
  if command -v clusterctl >/dev/null 2>&1; then
    log "clusterctl already installed"
    return
  fi
  log "installing clusterctl ${CLUSTERCTL_VERSION}"
  curl -fsSL -o /usr/local/bin/clusterctl \
    "https://github.com/kubernetes-sigs/cluster-api/releases/download/${CLUSTERCTL_VERSION}/clusterctl-linux-$(arch)"
  chmod +x /usr/local/bin/clusterctl
}

# --- 4. CAPI + CAPN into the mgmt cluster ----------------------------------
# CRDs are authoritative; the agent only caches/reads them. Workload clusters
# are kubeadm via CAPN ("no k3s" applies to workloads only).
init_capi() {
  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
  export CLUSTER_TOPOLOGY=true
  # capn-system is the CAPN target namespace; its presence means init already
  # ran (clusterctl init errors if re-run against an initialised cluster).
  if kubectl get namespace capn-system >/dev/null 2>&1; then
    log "CAPI/CAPN already initialised"
    return
  fi
  # CAPN (cluster-api-provider-incus) is a community infrastructure provider, so
  # it must be registered in a clusterctl config before init — clusterctl has no
  # built-in entry for "incus".
  cfg="${CONF_DIR}/clusterctl.yaml"
  install -d "${CONF_DIR}"
  cat >"${cfg}" <<YAML
providers:
  - name: incus
    url: https://github.com/lxc/cluster-api-provider-incus/releases/download/${CAPN_VERSION}/infrastructure-components.yaml
    type: InfrastructureProvider
YAML
  log "clusterctl init -i incus:${CAPN_VERSION}"
  clusterctl init --infrastructure "incus:${CAPN_VERSION}" --config "${cfg}"
}

# --- 5. the agent binary + its TLS + systemd unit --------------------------
install_agent_binary() {
  log "fetching k8s-api ${INCENDIO_RELEASE_TAG} for $(arch)"
  curl -fsSL -o "${AGENT_BIN}" \
    "https://github.com/${INCENDIO_RELEASE_REPO}/releases/download/${INCENDIO_RELEASE_TAG}/k8s-api-linux-$(arch)"
  chmod +x "${AGENT_BIN}"
}

# Self-signed serving cert for the agent. SANs include 127.0.0.1, the container
# address, and the host address the browser reaches via the proxy device
# (AGENT_TLS_SAN, passed through agent.env). The user approves it once via the
# "Approve K8s manager certificate" link.
generate_agent_tls() {
  local crt key san_ip san_host
  crt="${CONF_DIR}/agent-tls.crt"
  key="${CONF_DIR}/agent-tls.key"
  if [ -s "${crt}" ] && [ -s "${key}" ]; then
    log "agent TLS already present"
    return
  fi
  san_host="$(grep -E '^AGENT_TLS_SAN=' "${ENV_FILE}" | cut -d= -f2- || true)"
  san_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  local sans="IP:127.0.0.1,DNS:localhost"
  [ -n "${san_ip}" ] && sans="${sans},IP:${san_ip}"
  if [ -n "${san_host}" ]; then
    if printf '%s' "${san_host}" | grep -qE '^[0-9.]+$'; then
      sans="${sans},IP:${san_host}"
    else
      sans="${sans},DNS:${san_host}"
    fi
  fi
  log "generating agent TLS (SAN: ${sans})"
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "${key}" -out "${crt}" \
    -subj "/CN=incendio-k8s-agent" -addext "subjectAltName=${sans}"
  chmod 0600 "${key}"
  chmod 0644 "${crt}"
}

install_agent_service() {
  cat >/etc/systemd/system/incendio-k8s.service <<UNIT
[Unit]
Description=Incendio Kubernetes agent
After=network-online.target k3s.service
Wants=network-online.target

[Service]
EnvironmentFile=${ENV_FILE}
ExecStart=${AGENT_BIN}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
  install -d "${OPT_DIR}"
  systemctl daemon-reload
  systemctl enable --now incendio-k8s.service
}

main() {
  require_root
  log "bootstrap start (repo=${INCENDIO_RELEASE_REPO} tag=${INCENDIO_RELEASE_TAG})"
  install_base_packages
  prepare_host_shims
  trust_incus_server_cert
  install_k3s
  install_clusterctl
  init_capi
  install_agent_binary
  generate_agent_tls
  install_agent_service
  log "bootstrap complete; agent listening on :8843"
}

main "$@"
