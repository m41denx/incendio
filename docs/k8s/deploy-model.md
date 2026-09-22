# Kubernetes on Incus — how we actually deploy & manage clusters

This note reiterates the deploy/manage model for CAPN
(cluster-api-provider-incus) now that we've committed to shipping an agent,
and answers the questions raised while moving the Kubernetes menu under
Clustering. Sources: capn.linuxcontainers.org quick-start, the kubeadm
profile reference, and the default simplestreams server reference.

## 0. Why the menu lives under "Clustering"

CAPN talks to the Incus **HTTPS API** and provisions each Kubernetes node as an
Incus instance. The supported/tested path expects a clustered endpoint — the
official quick-start runs `incus cluster enable <addr>` before generating the
`lxc-secret`. So Kubernetes is a clustering-scoped feature and the nav item is
gated behind `isClustered` (single-member clusters count).

## 1. The moving parts

There are three distinct planes; conflating them is the usual source of
confusion.

### a) Infrastructure — the Incus server
Standalone/clustered Incus with the HTTPS API exposed. CAPN authenticates with
a client cert stored in a Kubernetes Secret (`lxc-secret`: `server`,
`server-crt`, `client-crt`, `client-key`, `project`). This is what Phase 0
already generates.

### b) Management cluster — where Cluster API runs
Cluster API is a set of Kubernetes controllers, so **you need a Kubernetes
cluster to create Kubernetes clusters** (chicken-and-egg). The management
cluster runs:
- core Cluster API (CAPI),
- the kubeadm **bootstrap** provider (CABPK) and kubeadm **control-plane**
  provider (KCP),
- the CAPN **infrastructure** provider (`capn-controller-manager`).

You drive it from an operator host with **`clusterctl`** (init providers,
generate manifests, fetch kubeconfig) and **`kubectl`** (apply the Cluster
manifest, watch status). The quick-start uses a local **kind** cluster (Docker)
for this role.

### c) Workload cluster — the nodes CAPN provisions
The actual cluster the user wants. Each control-plane/worker node is an Incus
container or VM; a load-balancer node (haproxy container) fronts the API
server for the `lxc`/`oci` flavors.

## 2. What does kubeadm do, and why the dedicated image?

**kubeadm** is the upstream Kubernetes node bootstrapper that runs *inside each
node instance* — it is NOT an operator tool. CAPN's kubeadm providers render
cloud-init that, inside the instance:
- `kubeadm init` on the first control-plane: generates PKI/CA, brings up etcd
  and the control-plane static pods (kube-apiserver, controller-manager,
  scheduler), configures kubelet and bootstrap tokens;
- `kubeadm join` on further control-plane/worker nodes.

**Dedicated `kubeadm/vX.Y.Z` images** (Ubuntu 24.04 at
`https://images.linuxcontainers.org/capn/`, add as the `capi` simplestreams
remote) come pre-baked with the matching kubelet/kubeadm/kubectl binaries,
containerd, kernel prerequisites and pre-pulled control-plane images. That
makes node bring-up fast, offline-capable and version-pinned. Two knobs:
- default `INSTALL_KUBEADM=false` → use the prebuilt image for
  `KUBERNETES_VERSION` (recommended);
- `INSTALL_KUBEADM=true` + `LXC_IMAGE_NAME=<plain ubuntu>` → install kubeadm at
  boot via cloud-init (flexible, slower, needs internet). Production is
  expected to build its own images.

Separately, a **kubeadm Incus profile** (privileged / unprivileged / kind
variants, from `capn.linuxcontainers.org/static/v0.1/*.yaml`) configures the
kernel modules (ip_vs, br_netfilter, overlay, …), `security.nesting`, apparmor
unconfined, and `/dev/kmsg` + `/boot` mounts so kubelet/containerd run inside
LXC. This is orthogonal to the node image.

## 3. Are clusterctl/kubectl in kubeadm? Do we need a separate bootstrap container?

No — `clusterctl` and `kubectl` are **not** part of kubeadm and are **not** in
the node images. They are operator-host tools that talk to the management
cluster. So yes: we need a management cluster somewhere, plus clusterctl +
kubectl next to it. Options:

1. **kind + Docker on the host** — the quick-start default. Simple, but forces
   Docker onto an Incus host; not a great product default.
2. **A dedicated bootstrap Incus instance running lightweight k8s** (k3s, or
   kind-in-Incus) that acts as a long-lived management cluster, with
   clusterctl + kubectl installed. This is the Incus-native "separate
   bootstrap container" — clean and self-contained. **Preferred.**
3. Pivot (`clusterctl move`) the management components onto a workload cluster
   later — advanced, optional.

## 4. Where the agent fits (revised phases)

**Phase 0 (done):** pure UI generator. Mints Incus client creds, renders the
`lxc-secret` YAML, the prefilled `clusterctl generate cluster` command, env
exports and the clusterctl-init prerequisites. The user still runs
clusterctl/kubectl themselves. No agent.

**Phase 1 — agent-managed management cluster + provisioning:**
- The `@incendio/k8s` agent owns a **long-lived management cluster** inside an
  Incus instance (option 2 above: k3s in a privileged container using the
  kubeadm profile), and bundles/execs `clusterctl` + `kubectl` (or speaks to
  the mgmt API with a k8s client).
- Agent responsibilities: ensure the management cluster exists and CAPN is
  initialized (`CLUSTER_TOPOLOGY=true clusterctl init -i incus`); create/update
  the `lxc-secret`; accept a cluster spec from the UI; run
  `clusterctl generate cluster` + `kubectl apply`; watch Cluster/Machine
  status and stream it back.
- UI: turn the Phase 0 generator into a real **Create cluster** wizard that
  POSTs the spec to the agent and shows live provisioning status (mirroring
  `clusterctl describe cluster`). When the agent is absent, fall back to the
  Phase 0 copy/paste artifacts.

**Phase 2 — lifecycle management + access:**
- Scale (control-plane/worker counts), upgrade `KUBERNETES_VERSION`, delete
  (`kubectl delete cluster`).
- Retrieve/download the workload kubeconfig (`clusterctl get kubeconfig`).
- CNI handling (the `DEPLOY_KUBE_FLANNEL` toggle) and surface node/pod health.
- Optional `clusterctl move` / backup of the management cluster.
- UI: cluster detail pages (nodes, machines, kubeconfig, scale/upgrade/delete).

## 5. Open decisions to lock before Phase 1

- Management-cluster runtime: **k3s-in-Incus** (preferred) vs kind+Docker.
- Agent → CAPI interface: shell out to `clusterctl`/`kubectl` binaries vs a
  native Go/HTTP CAPI client. Shelling out is faster to ship.
- Where the agent runs: systemd unit on the Incus host vs its own Incus
  container (co-located with the management cluster).
- How the agent authenticates to Incus: reuse the generated client cert (the
  same material as `lxc-secret`).
- Image strategy: use the public `capi` simplestreams remote for evaluation vs
  mirror/build our own images for production (the upstream server is
  eval-only and may drop EOL versions).
