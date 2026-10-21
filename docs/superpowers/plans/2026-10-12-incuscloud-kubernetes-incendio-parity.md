# IncusCloud Kubernetes: Incendio parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kubernetes back in Platform, with Incendio's create form, list and cluster page over an IncusCloud API that accepts every option the form has.

**Architecture:**
- **Server:** a `K8sSpec` stored on each cluster drives quota, the CAPI manifest (ClusterClass `incuscloud-v1` gains `workerInstance`) and the endpoint. lxc and oci load balancers are forwarded; kube-vip and OVN use their host. New read endpoints: status, activity, MetalLB. MetalLB is installed into the workload cluster with IncusCloud's own kube client.
- **Web:** Incendio's pages are copied into `incuscloud/web/src/pages/kubernetes/` under the same names, with hooks against `/api/v1/kubernetes/:id`. Incendio's pure helpers are imported.

**Tech Stack:** Bun, Elysia, drizzle (Postgres/pglite), React 19, react-router 7, TanStack Query, `@canonical/react-components`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-incuscloud-kubernetes-incendio-parity-design.md`

## Global Constraints

- Machine sizes are CAPN flavors `c<cores>-m<GiB>` (GiB may be fractional). A control plane needs at least 2 CPUs and 1700 MiB.
- Counts: control planes 1, 3 or 5; workers 0–20. Load-balancer types: `lxc`, `oci`, `kube-vip`, `ovn`.
- Defaults: pod CIDR `10.244.0.0/16`, service CIDR `10.96.0.0/12`.
- Backwards compatibility: `size` is still accepted. A request with neither `size` nor `spec` gets `size: "medium"`; both together is a 422.
- No kubectl or clusterctl at runtime.
- The CAPN-derived ClusterClass keeps its Apache-2.0 notice.
- Incendio's helpers (`util/k8s/capn`, `util/k8s/metallb`, `MetalLBAddressInput`, `util/k8s/download`, `packages/k8s/src/lib/{activity,metallb}.ts`) are imported, never copied.
- UI copy keeps Incendio's wording. "Member" is used for Incus cluster members, "node" only for Kubernetes nodes.

## Review Focus

1. **A tenant member** creates a cluster with custom flavors. The quota counts those flavors, not a size, and a scale-up is checked against the same flavors.
2. **kube-vip and OVN clusters** never get a forward. Deleting one never tries to remove a forward.
3. **Old clusters (rows with only `size`)** still list, scale and delete, and their page shows the backfilled spec.
4. **The Platform Kubernetes list for a tenant member** shows only their tenants' clusters. The list's `?cluster=` filter combines with tenant visibility rather than widening it.
5. **Old inventory URLs** (`/all/kubernetes`, `/ui/project/<p@c>/kubernetes/<name>`, `/inventory/<c>/kubernetes`) land on the new pages.

---

### Task 1: The spec model, storage and quota

**Files:**
- Modify: `incuscloud/server/src/k8s/model.ts` (add `MachineSpec`, `LbSpec`, `K8sSpec`, `parseFlavor`, `specFromSize`, `usageOfSpec`, `specError`)
- Modify: `incuscloud/server/src/db/schema.ts` (`spec` jsonb not null, `size` nullable, drop `k8s_clusters_size` check → allow null)
- Create: `incuscloud/server/drizzle/0012_kubernetes_spec.sql` (add column, backfill from size, size nullable) and its journal entry
- Modify: `incuscloud/server/src/api/kubernetes.ts`:
  - `POST` takes `spec` or `size`, and `controlPlanes` 1|3|5;
  - quota from the spec;
  - `PATCH` quota from the stored spec;
  - `view` gains `spec`;
  - `GET versions` returns `defaults` (the spec of `medium`) and keeps `sizes`.
- Test: `k8s/model.test.ts`, `api/kubernetes.test.ts`

**Interfaces (Produces):**
```ts
export type MachineType = "container" | "virtual-machine";
export interface MachineSpec { type: MachineType; flavor: string; profiles: string[]; target: string }
export type LbSpec =
  | { type: "lxc" | "oci"; flavor: string; profiles: string[]; target: string }
  | { type: "kube-vip"; host: string; interface: string }
  | { type: "ovn"; host: string; networkName: string };
export interface K8sSpec {
  controlPlane: MachineSpec; worker: MachineSpec; loadBalancer: LbSpec;
  image: string; privileged: boolean; flannel: boolean; installKubeadm: boolean;
  podCidr: string; serviceCidr: string; metallb: { addresses: string[] } | null;
}
export function parseFlavor(f: string): { cpu: number; memoryGiB: number } | null;
export function specFromSize(size: Size, member?: string): K8sSpec;
export function usageOfSpec(spec: K8sSpec, controlPlanes: number, workers: number, opts?: { lb?: boolean }): Usage;
export function specError(spec: K8sSpec): string | null; // flavors parse, CP ≥ 2 CPU and ≥ 1700 MiB, CIDRs valid, hosts set
```

- [ ] Step 1: model tests.
  - `parseFlavor("c2-m4")` gives `{2, 4}`; `"c1-m0.5"` gives `{1, 0.5}`; `"t3.micro"` gives null.
  - `specFromSize("medium")` matches today's manifest values: flavor `c2-m4`, `profiles: ["default"]`, an `lxc` LB with `c1-m1`, flannel true, privileged false.
  - `usageOfSpec` equals `usageOf` for every size.
  - `specError`:
    - CP `c1-m4` → "control plane needs at least 2 CPUs";
    - `c2-m1` → "1700 MiB";
    - bad CIDR → its message;
    - kube-vip with no host → its message;
    - a free-text flavor → `must be c<cores>-m<GiB>`.
- [ ] Step 2: run them and see them fail. Step 3: implement them in `model.ts`.
- [ ] Step 4: schema and migration. Backfill: `update k8s_clusters set spec = <specFromSize(size, lb_member)>` per size, done in SQL with `jsonb_build_object` for the three sizes and `lb_member` as the targets. Then `size` drops not null. Add a test in `api/kubernetes.test.ts` that a row inserted with only `size` (as before) reads back with the backfilled spec. If pglite cannot run a migration in that test, check the backfill SQL through `db.test.ts`'s migrate path.
- [ ] Step 5: API tests.
  - Create with a custom spec (CP `c4-m8` ×3, workers `c2-m4` ×2, lxc LB `c1-m1`): the job's usage is `{instances: 6, cpu: 12+4+1, memory: (24+8+1) GiB, disk: 6×10 GiB}`.
  - The same with kube-vip: instances 5, and no LB in the usage.
  - `size` and `spec` together → 422; a bad spec → 422 with `specError`'s message; neither → medium.
  - A scale-up of a spec cluster is checked against its flavors.
  - `GET :id` returns `spec`.
- [ ] Step 6: implement. Step 7: run `server/scripts-test.sh src/k8s/model.test.ts src/api/kubernetes.test.ts` and `bunx tsc --noEmit -p .`. Commit: `incuscloud kubernetes: clusters carry Incendio's machine, load balancer and network options`.

### Task 2: The manifest, the endpoint and the jobs follow the spec

**Files:**
- Modify: `incuscloud/server/src/k8s/clusterclass.yaml`. Add a `workerInstance` variable (`required: false`, same schema as `instance`). In the `workerInstanceSpec` patch, use `{{ $i := .instance }}{{ if .workerInstance }}{{ $i = .workerInstance }}{{ end }}` and `$i.*`. Do the same for `workerInstallKubeadm`'s `enabledIf` (`{{ if .workerInstance }}{{ .workerInstance.installKubeadm }}{{ else }}{{ .instance.installKubeadm }}{{ end }}`).
- Modify: `k8s/manifests.ts`. `clusterManifest(c: ClusterSpec & { spec: K8sSpec })` sets:
  - `clusterNetwork` CIDRs from the spec;
  - the flannel label only when `spec.flannel`;
  - `privileged`;
  - `loadBalancer` per type: `lxc`/`oci` → `{ [type]: { flavor, profiles, target } }`; `kube-vip` → `{ "kube-vip": { host, interface } }`; `ovn` → `{ ovn: { host, networkName } }`;
  - `instance` = the control plane's `{type, flavor, profiles, devices: [], image, installKubeadm, target}`;
  - `workerInstance` = the workers' (same shape).

  `controlPlaneEndpoint` stays `{host: endpointHost, port: endpointPort}`.
- Modify: `k8s/endpoint.ts`.
  - `pickEndpoint(db, clusterId, ports, want)` is unchanged. The API passes `want = loadBalancer.target` when it is a member name (not `@group`), else the request's `member`.
  - New `vipEndpoint(spec)` → `{ host: spec.loadBalancer.host, port: 6443, member: "" }`.
- Modify: `api/kubernetes.ts`.
  - For kube-vip/ovn, use `vipEndpoint`, with no port allocation from the range.
  - The endpoint uniqueness constraint still holds: two VIP clusters on one host:6443 are a 409 `conflict`.
  - When the request's targets are empty and the Incus cluster has several members, both machine targets and an lxc/oci LB target default to the picked member (today's behaviour).
- Modify: `k8s/jobs.ts` (create: skip the LB wait and the forward unless lxc/oci; delete: skip `removeForward` unless lxc/oci) and `k8s/worker.ts` (skip `retarget` unless lxc/oci).
- Test: `k8s/manifests.test.ts`, `k8s/jobs.test.ts`, `k8s/worker.test.ts`, `api/kubernetes.test.ts`

- [ ] Step 1: tests.
  - The manifest for a custom spec has both instance variables, the CIDRs and no flannel label when it is off.
  - kube-vip: `loadBalancer` is `{"kube-vip": {...}}` and the endpoint is the VIP:6443.
  - The ClusterClass YAML contains a `workerInstance` variable, and the worker patch reads it (string checks on the template).
  - The create job for kube-vip never calls `findLb` or `ensureForward`, and the delete job never calls `removeForward`.
  - The worker never retargets a VIP cluster.
  - The API: a VIP create allocates no port; a second VIP create on the same host → 409.
- [ ] Step 2: watch them fail. Step 3: implement. Step 4: run the k8s and api tests and tsc. Commit: `incuscloud kubernetes: the manifest, endpoint and jobs follow the cluster's spec`.

### Task 3: Status and activity endpoints

**Files:**
- Modify: `api/kubernetes.ts`. Add:
  - `GET /api/v1/kubernetes/:id/status` → `{ phase, conditions: Array<{type,status,reason,message,lastTransitionTime}>, message, endpoint }`, from the Cluster object, with `message` from the `Available`/`ControlPlaneAvailable` condition when false;
  - `GET /api/v1/kubernetes/:id/activity` → `{ entries: ActivityEntry[] }`, which merges `eventActivity` (Events in the namespace whose `involvedObject.name` starts with the cluster's name) with the cluster's jobs (`k8sId` in the payload, newest 50), mapped to entries `{time: createdAt, level: failed ? "error" : "info", source: "incuscloud", object: job type, message: progress/error, count: 1}`, newest first.
- Modify: `incuscloud/server/package.json`: add `"@incendio/k8s": "workspace:*"` if it is not resolvable. Import `eventActivity`/`ActivityEntry` from `@incendio/k8s/src/lib/activity.ts` (check its exports with `grep -n "export function" packages/k8s/src/lib/activity.ts`; use the function that turns a `K8sEventList` into entries).
- Test: `api/kubernetes.test.ts` (with `fake-kube.ts` holding a Cluster with conditions and two Events)

- [ ] Step 1: tests.
  - `status` returns the conditions and a message for a not-ready cluster.
  - `activity` lists both the Events and the jobs, newest first.
  - A tenant viewer can read both; an outsider gets 404.
- [ ] Steps 2–4 as usual. Commit: `incuscloud kubernetes: a cluster's conditions and activity`.

### Task 4: MetalLB

**Files:**
- Create: `incuscloud/server/src/k8s/metallb.ts`:
  - `metallbObjects(manifestYaml: string, addresses: string[]): KubeObject[]`: the manifest's documents plus `buildPoolManifest(addresses)` (from `@incendio/k8s/src/lib/metallb.ts`), parsed with the server's YAML parser (`grep -rn "from \"yaml\"\|parseAllDocuments" incuscloud/server/src | head -3` shows which one is used);
  - `installMetalLB(workload: Kube, objects)`: CRDs first, then the rest, then wait for the `controller` Deployment to be available (≤ 180 s), then the pool and advertisement;
  - `metallbState(workload)` → `{ installed, addresses, ready }`.
- Modify: `config.ts`: `IC_METALLB_MANIFEST_URL`, defaulting to MetalLB's native manifest for v0.15.2 on GitHub.
- Modify: `api/kubernetes.ts`. Add:
  - `GET /:id/metallb` (viewers);
  - `PUT /:id/metallb { addresses }` (members, audited `kubernetes.metallb`): validated by `MetalLBBody`, stored into `spec.metallb`, and a `k8s-metallb` job enqueued.
- Modify: `k8s/jobs.ts` (the `k8s-metallb` job: a workload `KubeClient` from CAPI's admin kubeconfig secret, then `installMetalLB`) and `k8s/worker.ts` (when a spec cluster turns ready with `spec.metallb` set and no metallb job done, enqueue one).
- Test: `k8s/metallb.test.ts` (object ordering, pool from addresses), `api/kubernetes.test.ts` (PUT validates, audits, enqueues; GET reads state through an injected workload kube factory)

- [ ] Steps 1–4 as usual. Commit: `incuscloud kubernetes: MetalLB for a cluster's load balancer services`.

### Task 5: Web — Kubernetes back in Platform; the list

**Files:**
- Delete: `incuscloud/web/src/pages/kubernetes/{KubernetesList,KubernetesDetail,CreateKubernetes,K8sStatus,hooks}.tsx|ts` after Tasks 6–7 replace them. Remove them in this task only where the new files take over; keep the build green.
- Create: `incuscloud/web/src/pages/kubernetes/useK8sClusters.ts`: hooks over `/api/v1/kubernetes` (list with `cluster`/`tenant` filters; get, status, nodes, activity, kubeconfig, metallb; create, patch, delete, put metallb) with the record type `K8sCluster` (the API's view, including `spec`).
- Create: `incuscloud/web/src/pages/kubernetes/ClusterList.tsx`, a copy of Incendio's:
  - the same headers: Name, Status, Kubernetes version, Control plane, Workers, API endpoint, then Tenant and Incus cluster in place of Project;
  - links to `/kubernetes/:id`;
  - row actions (download kubeconfig, delete) and the empty state;
  - a "Create cluster" button carrying the filters.
- Create: `ClusterStatusLabel.tsx` (copy).
- Modify: `components/Sidebar` (`console/Sidebar.tsx`): Platform › Kubernetes (`/kubernetes`), for everyone signed in.
- Modify: `App.tsx`:
  - routes `/kubernetes`, `/kubernetes/new`, `/kubernetes/:id`;
  - redirects: `/all/kubernetes` → `/kubernetes`; `/inventory/:cluster/kubernetes` → `/kubernetes?cluster=`; `ui/project/:project/kubernetes` → `/kubernetes?cluster=<c>`; `ui/project/:project/kubernetes/:name/*` → a `KubernetesRedirect` that finds the id by project and name.
- Modify: `console/object.ts`, `views.ts`, `useInventory.ts`, `KindIcon.tsx`: remove the `k8s` object kind, the Kubernetes tabs (root, cluster, project) and the tree's k8s items.
- Test: `pages/kubernetes/kubernetes.spec.tsx` (replace), `console/object.spec.ts`, `console/views.spec.ts`, `console/Sidebar.spec.tsx`, `console/console.spec.tsx` (redirects)

- [ ] Step 1: tests.
  - The Platform menu has Kubernetes.
  - The list shows the copied columns.
  - `?cluster=c1` lists only c1's clusters.
  - No Kubernetes tab on root, cluster or project, and no k8s rows in the Projects view.
  - The redirects from the old URLs work.
- [ ] Steps 2–4. Commit: `incuscloud web: Kubernetes is a platform page again, with Incendio's cluster list`.

### Task 6: Web — Incendio's create form

**Files:**
- Create: `incuscloud/web/src/pages/kubernetes/KubernetesCreate.tsx`, a copy of Incendio's with:
  - the sections Cluster and Machines; Networking stays inside Machines as in Incendio; the credentials and artifacts sections are removed;
  - the Cluster section starting with Tenant and Incus cluster (the current form's pickers, including the placement note and `?cluster=`/`?tenant=` defaults), then Incendio's fields;
  - profiles from `useProfiles("<tenant project>@<cluster>")`;
  - members and groups from the facade with the scope header for that cluster, i.e. `incusAll` with `x-incuscloud-scope: <cluster>`; add `incusAt(cluster, path)` to `api/client.ts`;
  - targets as Incendio's (member names unqualified for the request: `nameOf`);
  - the quota line from `usageOfSpec` (a web copy of the formula in `pages/kubernetes/quota.ts`, tested against the server's numbers in the spec test);
  - submit building the API body: `{tenantId, clusterId, name, version, controlPlanes, workers, spec}`, with the spec from the config: flavors via `resolveFlavor`, profiles split from Incendio's comma lists, and the LB per type.

  Uses `K8sClusterConfig`, `defaultK8sClusterConfig`, `controlPlaneSizeIssue`, `resolveFlavor`, `loadBalancerOptions`, `machineTypeOptions` and `memoryUnitOptions` from `@incendio/ui/util/k8s/capn`; `MetalLBAddressInput` and `metallbAddressesError` from Incendio.
- Test: `pages/kubernetes/create.spec.tsx`

- [ ] Step 1: tests.
  - The sections Cluster and Machines are present, and Credentials is not.
  - Choosing kube-vip shows "Virtual IP address".
  - Submitting with CP ×3 custom 4 CPU / 8 GB and workers ×2 sends the expected spec.
  - A control plane of 1 CPU shows Incendio's size issue and disables Create.
  - Targets list only the chosen cluster's members.
- [ ] Steps 2–4. Commit: `incuscloud web: Incendio's Kubernetes create form`.

### Task 7: Web — Incendio's cluster page

**Files:**
- Create: `ClusterDetail.tsx`, `ClusterNodeTable.tsx`, `ClusterKubeconfig.tsx`, `ClusterMetalLB.tsx`, `ClusterActivity.tsx`, `ScaleClusterBtn.tsx`, `UpgradeClusterBtn.tsx` and `DeleteClusterBtn.tsx`, all copies of Incendio's, with `id` props in place of `name` and hooks from `useK8sClusters.ts`.
  - The rows are General (adds Tenant, Incus cluster, Project), Kubeconfig, Control plane (n), Workers (n), Load balancer (lxc/oci), Load balancer services, Activity and Conditions.
  - The node table links each instance to the console's instance page (`/ui/project/<p@c>/instance/<name>`).
  - Upgrade offers IncusCloud's versions, one minor version forward.
  - Scale covers control plane 1/3/5 and workers 0–20.
- Test: `pages/kubernetes/detail.spec.tsx`

- [ ] Step 1: tests.
  - The rows render from mocked status, nodes and activity.
  - Scale sends a PATCH; Upgrade offers only the next minor version; Delete confirms, then sends DELETE.
  - The MetalLB row shows its addresses and edits through PUT.
- [ ] Steps 2–4. Remove the old pages (`KubernetesList`, `KubernetesDetail`, `CreateKubernetes`, `K8sStatus`, `hooks.ts`) and their spec. Commit: `incuscloud web: Incendio's Kubernetes cluster page`.

### Task 8: Live check and docs

- [ ] Build the web and restart the dev server.
- [ ] As admin, through the form:
  - create `parity` on cluster-d for tenant k8s-6b35c: CP 1 × `c2-m2` container, workers 1 × `c2-m2`, lxc LB, MetalLB off;
  - watch the page fill in (status, nodes, activity, conditions);
  - scale workers to 2, then back to 1;
  - delete it.
- [ ] Do the list, create and cluster page in dark mode, plus the tenant-member list (only kspike's).
- [ ] README's Kubernetes section: the options, the endpoint per load-balancer type, MetalLB, and the new endpoints in the API table.
- [ ] Commit: `docs: Kubernetes with Incendio's options`. Then the final whole-branch review as in executing-plans.
