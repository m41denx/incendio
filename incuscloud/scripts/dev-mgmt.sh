#!/bin/sh
# The management cluster for Kubernetes (P10) in dev: k3s in a privileged
# container on the dev host (ic-mgmt, project incuscloud-dev), with Cluster
# API and CAPN installed, and .dev/mgmt.kubeconfig for IncusCloud
# (scripts/dev.sh picks it up). Safe to run again: it only adds what is
# missing. In production any Kubernetes cluster works, with the same
# `clusterctl init` (see the README).
#   IC_MGMT_POOL=… IC_MGMT_NETWORK=… scripts/dev-mgmt.sh
set -eu
cd "$(dirname "$0")/.."
DEV="$PWD/.dev"
POOL="${IC_MGMT_POOL:-default}" NET="${IC_MGMT_NETWORK:-incusbr0}"
CAPI=v1.14.3 CAPN=v0.9.1
ARCH=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
I="sudo incus --project incuscloud-dev"
X="$I exec ic-mgmt --"

if ! $I info ic-mgmt >/dev/null 2>&1; then
  $I launch images:ubuntu/24.04 ic-mgmt -s "$POOL" -n "$NET" -d root,size=15GiB \
    -c security.nesting=true -c security.privileged=true -c limits.memory=3GiB \
    -c raw.lxc="lxc.apparmor.profile=unconfined
lxc.cgroup2.devices.allow=a
lxc.mount.auto=proc:rw sys:rw
lxc.cap.drop=" </dev/null
  # The kubelet reads the kernel log.
  $I config device add ic-mgmt kmsg unix-char source=/dev/kmsg path=/dev/kmsg >/dev/null
  for i in $(seq 30); do $X true 2>/dev/null && $X getent hosts github.com >/dev/null 2>&1 && break; sleep 2; done
fi

$X mkdir -p /etc/rancher/k3s /root/.cluster-api /root/.kube
# kube-proxy cannot raise the conntrack table size from inside a container.
printf 'kube-proxy-arg:\n  - conntrack-max-per-core=0\n' | $X tee /etc/rancher/k3s/config.yaml >/dev/null
# CAPN is not in clusterctl's built-in provider list.
printf 'providers:\n- name: incus\n  type: InfrastructureProvider\n  url: https://github.com/lxc/cluster-api-provider-incus/releases/latest/infrastructure-components.yaml\n' | $X tee /root/.cluster-api/clusterctl.yaml >/dev/null

$X sh -ec 'command -v curl >/dev/null || { apt-get update -q && apt-get install -y -q curl; }'
$X sh -ec 'command -v k3s >/dev/null || curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik --disable servicelb --write-kubeconfig-mode 600" sh -'
$X sh -ec 'for i in $(seq 90); do k3s kubectl get nodes 2>/dev/null | grep -q " Ready" && exit 0; sleep 2; done; echo "k3s did not become ready" >&2; exit 1'
$X sh -ec "command -v clusterctl >/dev/null || { curl -sfLo /usr/local/bin/clusterctl https://github.com/kubernetes-sigs/cluster-api/releases/download/$CAPI/clusterctl-linux-$ARCH && chmod +x /usr/local/bin/clusterctl; }"
$X cp /etc/rancher/k3s/k3s.yaml /root/.kube/config
if ! $X k3s kubectl get namespace capn-system >/dev/null 2>&1; then
  # ClusterClass topologies and ClusterResourceSets (flannel) are what IncusCloud uses.
  $X env CLUSTER_TOPOLOGY=true EXP_CLUSTER_RESOURCE_SET=true clusterctl init \
    --core "cluster-api:$CAPI" --bootstrap "kubeadm:$CAPI" --control-plane "kubeadm:$CAPI" --infrastructure "incus:$CAPN" --wait-providers
fi

# IncusCloud reaches k3s on the container's own address (not k3s's cni0 or flannel ones).
IP=$($I list ic-mgmt -f csv -c 4 | grep -oE '([0-9]+\.){3}[0-9]+ \(eth0\)' | cut -d' ' -f1 | head -1)
umask 077
$X cat /etc/rancher/k3s/k3s.yaml | sed "s#https://127.0.0.1:6443#https://$IP:6443#" > "$DEV/mgmt.kubeconfig.new"
mv "$DEV/mgmt.kubeconfig.new" "$DEV/mgmt.kubeconfig"
echo "management cluster ready: $DEV/mgmt.kubeconfig (https://$IP:6443)"
