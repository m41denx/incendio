# IncusCloud P10 — Kubernetes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Tenant members create Kubernetes clusters on any Incus cluster their tenant is placed on, from IncusCloud's API and UI.
- No appliance runs in each Incus cluster. One CAPI + CAPN install in the control plane's own Kubernetes (the *management cluster*) drives them all (spec D13).
- They scale, upgrade, give a kubeconfig, and delete. Their nodes count against the tenant's quota.

**Architecture (proven by a spike on 2026-10-12, see "Spike K"):**
- **Management cluster.** IncusCloud reaches it through a kubeconfig (`IC_K8S_KUBECONFIG`; unset turns Kubernetes off, and the API answers 409 `kubernetes_disabled`).
  - CAPI v1.14 and CAPN v0.9 are installed there by the operator (`clusterctl init --infrastructure incus`, documented). IncusCloud applies everything else.
  - `k8s/kube.ts` is a small REST client: server-side apply (`PATCH`, `application/apply-patch+yaml`, field manager `incuscloud`), get, list, delete. It uses `fetch` with the kubeconfig's CA and client certificate or token, and parses YAML with `Bun.YAML`.
- **Our ClusterClass** `incuscloud-v1`. It is derived from CAPN's `capn-v1beta2` (Apache-2.0, attribution kept) with two changes:
  - `skipDefaultKubeadmProfile: true`. Tenant projects are restricted: no host paths, no kernel modules.
  - `security.nesting=true` on container nodes.

  It is applied, with its templates, in namespace `incuscloud-system`.
- **Per tenant**, namespace `ic-<slug>` holds:
  - the flannel ClusterResourceSet and ConfigMap;
  - identity secrets;
  - the clusters, which reference the class across namespaces.
- **Credentials per (tenant, Incus cluster).** The worker generates a client certificate (`generateClientCertificate`) and trusts it on the Incus cluster as `restricted` to the tenant's project. It writes the CAPN identity secret `incus-<incus cluster name>`: server URL, server cert, client cert/key, `project`.
  - The key exists only in that Secret. The fingerprint is kept in `k8s_credentials`, so the certificate can be revoked when the last Kubernetes cluster there is deleted.
- **Unprivileged nodes.** Variable `privileged: false`. Tenant projects get `restricted.containers.nesting=allow` (still unprivileged).
  - Spike K: a control plane and a worker came up in a restricted project, with only `security.nesting` on the nodes. The host must have `br_netfilter`, `overlay`, `ip_vs` and `nf_nat` available; documented.
- **API endpoint.** The management cluster must reach each workload API server, and the nodes must reach it too.
  1. CAPN's LXC load balancer (haproxy) runs in the tenant project, pinned with `loadBalancer.lxc.target` to one member.
  2. IncusCloud presets `Cluster.spec.controlPlaneEndpoint` to that member's address and a port allocated from `IC_K8S_PORTS` (default `16443-16999`). The port is unique per member address.
  3. An Incus network forward on the bridge of the project's default NIC (in the default project) maps `<member address>:<port>` to `<LB address>:6443`. On a clustered Incus it is created on that member (`?target=`).
  4. The sync loop keeps the forward's target equal to the LB's current address.
  - Spike K: kubeadm accepted the preset endpoint, the API was reached through the forward from the management cluster, and nodes joined through it (hairpin).
- **Data.** Migration 0011 adds two tables.
  - `k8s_clusters`: id, tenantId, clusterId, name, namespace, version, controlPlanes, workers, size, endpointHost, endpointPort, status (`creating|provisioning|ready|degraded|deleting|error`), statusMessage, nodesReady, nodes, createdBy, createdAt. Unique (tenantId, name) and (clusterId, endpointHost, endpointPort).
  - `k8s_credentials`: tenantId, clusterId, fingerprint, createdAt.
- **Jobs.**
  - **`k8s-create`:**
    1. tenant namespace bundle;
    2. credentials;
    3. apply the Cluster;
    4. wait for the LB instance (by `user.cluster-name`, `user.cluster-namespace`, `user.cluster-role=loadbalancer`), then add the forward;
    5. wait until the control plane is available (`ControlPlaneAvailable=True`), with a 30 min deadline.
  - **`k8s-delete`:**
    1. delete the Cluster;
    2. wait until it is gone (CAPN removes its instances);
    3. remove our forward port;
    4. revoke the credentials if no other cluster of the tenant uses that Incus cluster;
    5. delete the row.
- **Scale and upgrade** are a `PATCH` that server-side applies the Cluster topology, with no job. Scale-up is checked against the quota first.
  - Upgrades go one minor version at a time, to a version in `KUBERNETES_VERSIONS` (versions with prebuilt CAPN kubeadm images): `v1.34.0`, `v1.35.5`, `v1.36.4`, `v1.37.0`.
- **Sizes:** `small` = c2-m2, `medium` = c2-m4, `large` = c4-m8 (control plane minimum c2-m2). The LB is c1-m1.
  - Quota check: nodes and the LB are counted as instances; the flavor's CPUs and memory; 10 GiB of disk per instance (the profile's default root size, P3). It goes through the same per-tenant advisory lock as instance creates.
  - Pending `k8s-create` jobs count, through a `usage` field in their payload. `pendingOf` reads `payload.usage` when present.
- **Sync** (`K8sWorker`, lease `kubernetes`, every 15 s). For each row it reads the Cluster's conditions and its Machines, and sets status, `nodes` and `nodesReady`. It also refreshes the forward target.
- **API** (`/api/v1/kubernetes`):
  - list: visible tenants;
  - get;
  - create: tenant members+ and platform operators;
  - `PATCH {workers?, controlPlanes?, version?}`: members+;
  - `DELETE`: tenant admins+ and operators;
  - `GET :id/kubeconfig`: members+, audited; from the `<name>-kubeconfig` Secret;
  - `GET kubernetes/versions`.

  Unplacing a tenant from a cluster, or deleting a tenant, is refused (409) while it has Kubernetes clusters there.
- **UI:**
  - a "Kubernetes" nav entry;
  - the list;
  - a create form (tenant, Incus cluster from ready placements, name, version, control planes 1 or 3, workers 0–20, size);
  - a detail page (status, endpoint, nodes, scale, upgrade, Download kubeconfig, Delete);
  - job labels.

**Tech Stack:** as P9. The management cluster in dev is `ic-mgmt` (k3s 1.36 in a privileged container on the dev host, `/dev/kmsg` passed through, kube-proxy `conntrack-max-per-core=0`). Live tests use cluster-b.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (D13, P10 row, data model `k8s_clusters`).

## Global Constraints

- **No appliance per Incus cluster**, and no `clusterctl` or `kubectl` at runtime. The server talks to the Kubernetes API directly.
- **CAPN only ever gets a certificate restricted to the tenant's own project.** It never gets the control plane's admin certificate.
- **The client key never touches our database.** It lives only in the management cluster's Secret.
- **Nodes are unprivileged containers.** Nothing loosens the project beyond `restricted.containers.nesting=allow`.
- **Never delete what we did not create.** Forward ports are ours only when their description says `incuscloud k8s <id>`. A shared forward is kept while other ports remain.
- **Audit:** create, scale, upgrade, delete, kubeconfig download.
- **Do not copy PegaProx code.** CAPN templates are Apache-2.0: keep the notice in the derived ClusterClass.

## Review Focus

- **Two creates at once on the same member.** They must get different ports: the unique index, plus allocation inside the transaction.
- **The LB instance changes address** after a restart or an evacuation. The sync re-targets the forward.
- **Delete while still provisioning, or when the management cluster is unreachable.** The job retries and fails visibly, and the row stays `deleting`, not lost.
- **A tenant's last cluster on an Incus cluster is deleted.** The certificate is revoked. With one left, it is kept.
- **Scale-up over the quota** is refused with the same message style as instance creates. Scale-down is always allowed.

---

### Spike K (done, 2026-10-12)

`ic-mgmt` (k3s) with `clusterctl init --infrastructure incus:v0.9.1` (CAPI v1.14.3, clusterctl config from CAPN's `clusterctl.yaml`).

On cluster-b, tenant `kspike`:
- restricted project plus `restricted.containers.nesting=allow`;
- a restricted certificate for `kspike`;
- the derived ClusterClass;
- a Cluster with the endpoint preset to `10.133.241.74:16443`;
- a forward `10.133.241.74:16443` → LB `:6443`.

Result:
- the control plane is Ready, a worker joined, flannel was applied by CRS, and an nginx pod ran;
- the nodes are unprivileged, with `security.nesting` only;
- the kubeconfig's server is the forwarded endpoint.

### Task 1: Management-cluster client and config

- [ ] `config.ts`: `IC_K8S_KUBECONFIG` (optional path) → `config.k8s?: {kubeconfig: string; ports: [number, number]}`, and `IC_K8S_PORTS` (`a-b`, 1024 ≤ a ≤ b ≤ 65535). Config tests.
- [ ] `k8s/kube.ts`:
  - `parseKubeconfig(yaml)` → `{server, ca?, cert?, key?, token?}` (current context; inline `*-data` only);
  - `class KubeClient implements Kube { apply(obj), get(apiVersion, kind, namespace, name), list(apiVersion, kind, namespace, labelSelector?), delete(apiVersion, kind, namespace, name) }`;
  - resource paths: core `/api/v1`, groups `/apis/<g>/<v>`; plural = lower-case kind + `s` (`es` after `s`); `Namespace` is cluster-scoped.

  Tests against a plain-HTTP `Bun.serve` fake: paths, the SSA content type and `fieldManager`/`force`, 404 → null/false, errors carry the Status message.
- [ ] `k8s/fake-kube.ts`: an in-memory `Kube` for the higher-level tests (apply merges `metadata`/`spec`, keeps `status`).

### Task 2: Manifests and data

- [ ] `k8s/clusterclass.yaml` (derived, with Apache notice) and `k8s/manifests.ts`:
  - `classBundle()`: the ClusterClass objects, namespace `incuscloud-system`;
  - `tenantBundle(slug)`: Namespace `ic-<slug>`, flannel CRS + ConfigMap;
  - `identitySecret({namespace, name, server, serverCert, cert, key, project})`;
  - `clusterManifest(row, {lbTarget?})`: topology with `classRef {name, namespace}`, endpoint, `privileged: false`, flavors from size, `loadBalancer.lxc {flavor: c1-m1, target}`, workers `md-0`.

  Pure tests, including a check that the derived class still carries both changes.
- [ ] Migration 0011: `k8s_clusters`, `k8s_credentials`. Add `k8s` sizes, versions and `usageOf(size, controlPlanes, workers)` in `k8s/model.ts` with tests.
- [ ] `reconcile/projects.ts`: tenant projects get `restricted.containers.nesting=allow` (test).

### Task 3: Incus side — credentials and endpoint

- [ ] `k8s/credentials.ts`: `ensureCredentials(ctx, kube, tenant, cluster, project)` and `revokeCredentials(...)`. FakeIncus learns `POST/DELETE /1.0/certificates` with `restricted`/`projects`. Tests: issued once, reused, re-issued if the Secret is gone, and revoke deletes the trust entry and the row.
- [ ] `k8s/endpoint.ts`:
  - `pickEndpoint(db, cluster, members)`: host = the first online member's URL host (or the cluster URL's), port = lowest free in the range;
  - `findLb(client, project, name, namespace)`;
  - `ensureForward(client, {network, member?, host, port, target, id})`: GET the forward, create or PUT it with our port updated, others untouched;
  - `removeForward(...)`: drop our port; delete the forward only when no port is left and it carries no other config.

  FakeIncus learns network forwards. Tests: shared forward kept, re-target, foreign port untouched.

### Task 4: Jobs and sync

- [ ] `k8s/jobs.ts`: `k8sCreateHandler({kube})` and `k8sDeleteHandler({kube})`, registered in `jobHandlers` when `config.k8s` is set. Tests with FakeKube and FakeIncus: the full create path (the LB appears, then the forward, then `ControlPlaneAvailable`), the delete path, and credential revoke only for the last cluster.
- [ ] `k8s/worker.ts` `K8sWorker` (lease `kubernetes`): status from conditions and machines; forward re-target when the LB address changed. Tests.
- [ ] `api/tenant-cloud.ts` `pendingOf` reads `payload.usage` for `k8s-create` (test: a pending k8s create blocks an instance create over quota).

### Task 5: API

- [ ] `api/kubernetes.ts`: list, get, create (validation, roles, quota under the advisory lock, placement must be ready, name unique per tenant, port allocated in the transaction, 202 job), PATCH (scale with quota; upgrade one minor forward), DELETE (job), kubeconfig (audited), versions. The disabled case answers 409.
- [ ] Unplace and tenant delete refuse with 409 while clusters exist.

### Task 6: UI

- Haiku: Kubernetes list page and Create Kubernetes cluster page.
- Haiku: Kubernetes cluster detail (scale, upgrade, kubeconfig download, delete).
- Mine: types, routes, nav entry, job labels and summaries, browser pass.

### Task 7: Live and docs

- [ ] `scripts/k8s-e2e.ts` on cluster-b, with a tenant with a quota:
  1. a create through the API;
  2. the job succeeds;
  3. the workload API answers through the endpoint with the downloaded kubeconfig (`/version`, then nodes Ready);
  4. scale workers 0 → 1, and a node joins;
  5. scale over the quota is refused;
  6. delete: instances, forward port and certificate are gone.
- [ ] `scripts/dev.sh` passes `IC_K8S_KUBECONFIG` when `.dev/mgmt.kubeconfig` exists; `scripts/dev-mgmt.sh` builds `ic-mgmt`.
- [ ] README: a Kubernetes section, the management-cluster install, host kernel modules, the endpoint model and its limits (member address and port; OVN load balancers in P11).
