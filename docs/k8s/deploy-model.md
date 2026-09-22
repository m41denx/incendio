# Kubernetes on Incus — how we actually deploy & manage clusters

This is the **source of truth for the deploy/manage model** and supersedes the
earlier "k3s-in-Incus management cluster" sketch. It captures the decisions
locked with the maintainer (2026-09-22) after working through the CAPN
quick-start, the kubeadm profile/image references, and the ESXi/vCenter analogy.

Sources: capn.linuxcontainers.org quick-start, the kubeadm profile reference,
and the default simplestreams server reference. CRD/variable specifics live in
[`capn-reference.md`](./capn-reference.md).

## 0. The mental model (ESXi / vCenter analogy)

- **Incus hosts = ESXi.** They stay **pure hypervisors**. We never install k8s
  tooling, Docker, or a management cluster on them. They only ever receive
  Incus API calls (create VM/container, attach devices, etc.).
- **Operator VM = vCenter / VCSA.** A single dedicated appliance VM hosts the
  Cluster API **management cluster** and the `@incendio/k8s` agent. This is the
  only long-lived control-plane component we run.
- **Workload clusters = the VMs/pods vCenter provisions.** Each workload cluster
  is a set of Incus instances (control-plane + workers, optionally an LB node)
  living in its **own Incus project**.

Conflating the three planes is the usual source of confusion; keep them
separate.

## 1. Locked decisions

1. **One kubeadm toolchain everywhere — no k3s.** The management cluster and
   every workload cluster are bootstrapped with **kubeadm**. This keeps one
   mental model, one upgrade story, and reliable etcd.
2. **Operator appliance VM** hosts the management cluster + the agent. Incus
   hosts remain pure hypervisors.
   - Starts **single-node** (`kubeadm init` → CNI → `clusterctl init -i incus`).
     This is a **non-HA appliance**, exactly like a single VCSA.
   - **HA is a later mode:** 3 control-plane VMs for etcd quorum. Model it now
     as "1 operator VM today, optional HA-mode = 3 later."
   - It is a **VM, not a container**: clean kernel, reliable etcd, and it avoids
     the privileged/nesting LXC profile that container *nodes* need. Simplestreams
     ships VM kubeadm images, so it uses the same image family as the nodes.
   - Lives in its own project (`user.incendio.role=management`).
3. **Project-per-workload-cluster.** Each cluster gets a dedicated Incus
   project. Clean grouping, real isolation via `limits.*`, and one-shot teardown
   (delete project → the cluster's instances/networks/profiles go with it).
4. **Project metadata is the source of truth — not the name.** Detection reads
   `user.incendio.*` config keys, never the project name. See §5.
5. **Public simplestreams kubeadm images** for nodes (eval); mirror/build our
   own for production. `INSTALL_KUBEADM=false` (use the prebuilt image) is the
   default.

## 2. The three planes

### a) Infrastructure — the Incus server(s)
Standalone or clustered Incus with the HTTPS API exposed. CAPN authenticates
with a client cert stored in a Kubernetes Secret (`lxc-secret`: `server`,
`server-crt`, `client-crt`, `client-key`, `project`). Phase 0 already generates
this. The nav item is gated behind `isClustered` (single-member clusters
count), because the tested CAPN path expects a clustered endpoint.

### b) Management cluster — the operator VM
Cluster API is a set of Kubernetes controllers, so **you need a Kubernetes
cluster to create Kubernetes clusters** (chicken-and-egg). We run that cluster
inside the operator VM. It hosts:
- core Cluster API (CAPI),
- the kubeadm **bootstrap** provider (CABPK) and kubeadm **control-plane**
  provider (KCP),
- the CAPN **infrastructure** provider (`capn-controller-manager`).

The **agent runs inside this VM** and drives it with `clusterctl` (init
providers, generate manifests, fetch kubeconfig) and `kubectl` (apply Cluster
manifests, watch status). No operator tooling ever touches the Incus hosts.

### c) Workload cluster — the nodes CAPN provisions
The actual cluster the user wants, one Incus **project** per cluster. Each
control-plane/worker node is an Incus container or VM; a load-balancer node
(haproxy container) fronts the API server for the `lxc`/`oci` flavors.

## 3. What kubeadm does, and why the dedicated image

**kubeadm** is the upstream node bootstrapper that runs *inside each node
instance* — it is NOT an operator tool. CAPN's kubeadm providers render
cloud-init that, inside the instance:
- `kubeadm init` on the first control-plane: PKI/CA, etcd, control-plane static
  pods (kube-apiserver, controller-manager, scheduler), kubelet, bootstrap
  tokens;
- `kubeadm join` on further control-plane/worker nodes.

**Dedicated `kubeadm/vX.Y.Z` images** (Ubuntu 24.04 at
`https://images.linuxcontainers.org/capn/`, added as the `capi` simplestreams
remote) come pre-baked with matching kubelet/kubeadm/kubectl, containerd,
kernel prerequisites and pre-pulled control-plane images. Two knobs:
- default `INSTALL_KUBEADM=false` → use the prebuilt image for
  `KUBERNETES_VERSION` (recommended);
- `INSTALL_KUBEADM=true` + `LXC_IMAGE_NAME=<plain ubuntu>` → install at boot via
  cloud-init (flexible, slower, needs internet).

The VM kubeadm image variants (`VIRTUAL-MACHINE`) are what the **operator VM**
boots from too, so both layers share one image family.

Separately, a **kubeadm Incus profile** (privileged / unprivileged / kind
variants) configures kernel modules (ip_vs, br_netfilter, overlay, …),
`security.nesting`, apparmor unconfined, and `/dev/kmsg` + `/boot` mounts so
kubelet/containerd run inside LXC **containers**. This is orthogonal to the node
image, and it is why *container* nodes need privilege while the *operator VM*
does not.

## 4. The agent, re-scoped: a day-0 bootstrapper that steps aside

`@incendio/k8s` **runs inside the operator VM**, not on an Incus host. Flow:

```
UI (Incendio SPA)
  |  (1) plain Incus API: create operator VM (kubeadm VM image, mgmt project)
  |       with cloud-init that drops in the trusted client cert + installs the agent
  v
Operator VM ── agent ──> (2) kubeadm init mgmt cluster → CNI
                          → CLUSTER_TOPOLOGY=true clusterctl init -i incus
                          → create lxc-secret(s)
  ^
  |  (3) UI → agent: submit a workload-cluster spec
  |       agent runs clusterctl generate | kubectl apply, streams status back
  |
  +── (4) hypervisors stay pure; all control-plane logic lives here (CAPI).
          The agent is a thin convenience API over clusterctl/kubectl.
```

1. **UI → Incus API (plain):** create the operator VM. There is no CAPI yet, so
   this first VM is created with the ordinary Incus API — an unavoidable
   chicken-and-egg. cloud-init (a) installs the trusted Incus client cert and
   (b) installs the incendio agent.
2. **Agent on the VM:** `kubeadm init` the single-node mgmt cluster → install a
   CNI → `CLUSTER_TOPOLOGY=true clusterctl init -i incus` → create the
   `lxc-secret`(s).
3. **UI → agent:** POST the first workload-cluster spec; the agent runs
   `clusterctl generate cluster` + `kubectl apply` and streams status back
   (mirroring `clusterctl describe cluster`).
4. After bootstrap, **Incus hosts stay pure** and all lifecycle logic lives in
   the operator VM.

### The agent is a thin persistent broker, never an orchestrator

The vCenter analogy cuts both ways: VCSA is not a day-0 tool that disappears —
it is a **persistent, thin management endpoint** the client talks to forever.
Our agent plays the same role:

- **Day-0:** bootstrap the management cluster and create the `lxc-secret`.
- **Day-2 (persistent but dumb):** stay alive as the appliance's stable,
  browser-friendly endpoint — submit specs, read status, fetch kubeconfig,
  scale/delete. It brokers UI ↔ CAPI; it does not reconcile anything.

**CAPI/CAPN controllers inside the mgmt cluster own all reconciliation.** The
agent therefore has **no reconcile loop of its own** — it reads CAPI status on
demand. We keep it thin precisely because CAPI does the hard part. (Concretely:
the `reconcile` cron placeholder was removed from the agent app.)

Why not let the browser talk to the Kubernetes API directly and drop the agent?
Because a browser can't cleanly hit the raw k8s API (kubeconfig/token in the
browser, CORS, cert trust). The thin agent is what makes the appliance
vCenter-like.

**Failure domain:** a single operator VM is a single point of *management*
failure — it holds etcd/CAPI state for the mgmt cluster. If it dies, **workload
clusters keep running** (their control planes are independent); you lose
management/console until restore. Same tradeoff as a single VCSA — mitigated by
backups / `clusterctl move` and HA-mode (3 control VMs) later.

## 5. Project metadata schema (`user.incendio.*`)

Incus projects carry a free-form config map; `user.*` keys are untouched by
Incus (same guarantee as instances/networks/profiles). Make config the
**source of truth** and treat the name as cosmetic.

| Key                         | Values                              | Purpose                          |
| --------------------------- | ----------------------------------- | -------------------------------- |
| `user.incendio.managed`     | `"true"`                            | **The detector.** Is this ours?  |
| `user.incendio.role`        | `workload` \| `management`          | Which plane the project hosts    |
| `user.incendio.cluster`     | `<clustername>`                     | Cluster this project belongs to  |
| `user.incendio.k8s-version` | `v1.37.0`                           | Pinned Kubernetes version        |
| `user.incendio.operator`    | `<operator-vm-name>`                | Which operator VM manages it     |

- **Detection** = list projects, filter `user.incendio.managed="true"` (then by
  `role`). **Never parse the name for logic.**
- **Naming** `k8s-<clustername>` is fine for humans/URLs, but name-only is
  fragile (renames, collisions, can't carry role/version). This mirrors how CAPN
  already stamps nodes with `user.cluster-name`.
- **Isolation:** make these **restricted** projects with `limits.*` so a cluster
  is a real blast-radius boundary and teardown is one delete.
- Node instances additionally carry the namespaced tags from
  [`README.md`](./README.md) §9 (`user.incendio.k8s.cluster`, `.role`,
  `.flavor`) plus whatever CAPN stamps, so real CAPN clusters light up in the
  discovery view.

## 6. Transport & identity (decide before Phase 1 code)

- **UI ↔ operator transport:** prefer **Incus-mediated** (instance `exec` or an
  Incus proxy device) so we don't expose extra ports or stand up a second trust
  domain. Alternative: the VM serves its own HTTPS (needs a browser-trusted
  cert + CORS, per [`README.md`](./README.md) §7). Leaning Incus-mediated.
- **Agent identity:** the operator VM holds the trusted Incus client cert (same
  material as `lxc-secret`) so CAPN can drive Incus. Incendio can mint it during
  onboarding.
- **Bootstrap identity:** the operator VM itself is created via **plain Incus
  API** (no CAPI exists yet).

## 7. Phased delivery (revised)

**Phase 0 (done):** pure-UI generator. Mints Incus client creds, renders the
`lxc-secret` YAML, the prefilled `clusterctl generate cluster` command, env
exports and the `clusterctl init` prerequisites. The user runs
clusterctl/kubectl themselves. No agent.

**Phase 1 — operator VM + agent-managed provisioning:**
- UI creates the **operator VM** via the Incus API (kubeadm VM image,
  `management` project) with cloud-init that installs the trusted client cert +
  the agent.
- Agent bootstraps the single-node mgmt cluster: `kubeadm init` → CNI →
  `CLUSTER_TOPOLOGY=true clusterctl init -i incus`; creates/updates the
  `lxc-secret`.
- Agent accepts a cluster spec, creates the **per-cluster project** with
  `user.incendio.*` metadata, runs `clusterctl generate cluster` +
  `kubectl apply`, watches Cluster/Machine status, streams it back.
- UI: turn the Phase 0 generator into a real **Create cluster** wizard that
  POSTs the spec and shows live provisioning status; fall back to Phase 0
  copy/paste artifacts when no agent is configured.

**Phase 1.5 — discover & visualize (read-only):** group projects/instances into
clusters via `user.incendio.*` metadata; show control-plane vs worker topology,
health, kubeconfig hints. Works against real CAPN clusters too.

**Phase 2 — lifecycle management + access:**
- Scale (CP/worker counts), upgrade `KUBERNETES_VERSION`, delete (delete the
  project for one-shot teardown).
- Retrieve/download the workload kubeconfig (`clusterctl get kubeconfig`).
- CNI handling (`DEPLOY_KUBE_FLANNEL`), node/pod health.
- **Operator HA mode:** promote the single operator VM to 3 control-plane VMs.
- Optional `clusterctl move` / backup of the management cluster.
- UI: cluster detail pages (nodes, machines, kubeconfig, scale/upgrade/delete).

## 8. Still open

- UI ↔ operator transport: confirm **Incus-mediated exec/proxy** vs the VM
  serving its own HTTPS.
- Agent → CAPI interface: shell out to `clusterctl`/`kubectl` binaries (faster
  to ship) vs a native Go/HTTP CAPI client.
- Image strategy: public `capi` simplestreams remote for eval vs mirror/build
  our own for production (upstream is eval-only and may drop EOL versions).
- CNI default for both the mgmt cluster and workload clusters.
