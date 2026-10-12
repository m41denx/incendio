# IncusCloud Kubernetes: Incendio's pages, at platform level

**Date:** 2026-10-12. **Branch:** `incuscloud`.

## What the user asked

After the inventory redesign the user reviewed the Kubernetes pages and said:

> k8s is still lacking compared to incendio. just copy incendio create cluster stuff and return kubernetes to platform level

So there are two decisions, and both are the user's:

1. **Kubernetes is a platform page again.** It sits in the sidebar's Platform section, as it did before the inventory redesign, not in the inventory tree or in cluster and project tabs.
2. **The pages are Incendio's.** That means its create form (every option it has), its cluster list and its cluster page (kubeconfig, control plane, workers, load balancer, MetalLB, activity, conditions), with Incendio's scale, upgrade and delete actions.

## How

Incendio's Kubernetes pages talk to its management appliance's agent (`/v1/clusters…`), one agent per Incus server. Its create form also carries Incus credentials and clusterctl artifacts. IncusCloud has neither: it drives one Cluster API install for every cluster, with its own credentials per tenant. So the pages are **copied** into `incuscloud/web/src/pages/kubernetes/`, keeping Incendio's file names and layout so the two can be compared. Their hooks talk to IncusCloud's `/api/v1/kubernetes` by id.

Incendio's pure parts are **imported, not copied**, from `@incendio/ui`:
- `util/k8s/capn`: the config model, its defaults and the control-plane size check;
- `util/k8s/metallb`: the address check;
- `MetalLBAddressInput`;
- `util/k8s/download`.

**Left out**, because IncusCloud does these itself or has no equivalent:
- appliance management, agent settings and controller restart;
- the infrastructure-credentials section and the generated clusterctl artifacts;
- node logs (`NodeLogBtn`).

## Console

- Platform › Kubernetes: `/kubernetes` (the list), `/kubernetes/new`, and `/kubernetes/:id` (the cluster page). Every platform user sees the item. The list shows the clusters of the tenants the caller can see, as it does today.
- Removed from the inventory:
  - the Kubernetes tabs on All clusters, on clusters and on projects;
  - Kubernetes clusters in the tree's Projects view;
  - the `k8s` object kind.
- Old URLs redirect:
  - `/all/kubernetes` → `/kubernetes`;
  - `/ui/project/<p@c>/kubernetes[/<name>[/<tab>]]` → the list or the cluster's page, found by project and name;
  - `/inventory/<c>/kubernetes` → `/kubernetes?cluster=<c>`.
- The list takes `?cluster=` and `?tenant=` filters, and Create carries them to the form.

## The create form (Incendio's, sections and fields)

- **Cluster:**
  - Tenant;
  - Incus cluster, with the placement note when the tenant is not placed there yet;
  - cluster name and Kubernetes version (IncusCloud's offered versions);
  - image name (optional override);
  - load balancer:
    - `lxc` or `oci`: flavor, profiles, target;
    - `kube-vip`: virtual IP, interface;
    - `ovn`: address, OVN network;
  - Install MetalLB, with its address ranges.
- **Machines:** for the control plane and for workers each:
  - count (control plane 1, 3 or 5; workers 0–20);
  - type (container or virtual machine);
  - flavor, or custom CPU and memory;
  - profiles;
  - target (a member or `@group` of the chosen Incus cluster).
- **Networking:** pod CIDR, service CIDR, privileged containers, deploy kube-flannel, install kubeadm on boot.
- The quota line: what the cluster counts against the tenant's quota.

Profiles, members and groups come from the chosen Incus cluster through the facade:
- profiles are those of the tenant's project there (`p@c`);
- members and groups are that cluster's only.

## API

`POST /api/v1/kubernetes` keeps `tenantId`, `clusterId`, `name`, `version`, `controlPlanes` (1|3|5) and `workers`. It gains a `spec`:

```ts
interface MachineSpec { type: "container" | "virtual-machine"; cpu: number; memoryGiB: number; profiles: string[]; target: string }
interface K8sSpec {
  controlPlane: MachineSpec;
  worker: MachineSpec;
  loadBalancer:
    | { type: "lxc" | "oci"; cpu: number; memoryGiB: number; profiles: string[]; target: string }
    | { type: "kube-vip"; host: string; interface: string }
    | { type: "ovn"; host: string; networkName: string };
  image: string;          // "" = CAPN's image for the version
  privileged: boolean;
  flannel: boolean;
  installKubeadm: boolean;
  podCidr: string;        // default 10.244.0.0/16
  serviceCidr: string;    // default 10.96.0.0/12
  metallb: { addresses: string[] } | null;
}
```

- **`size` stays accepted**, as today's sizes. A request with neither `size` nor `spec` gets `size: "medium"`. Requests carry one or the other; both together is a 422.
- **Storage:** the spec is stored as jsonb `spec` on `k8s_clusters`. Existing rows are backfilled from `size`, and `size` becomes nullable.
- **Quota:** usage comes from the spec. Each node counts its CPU, memory and a 10 GiB disk. The load balancer counts the same way, for `lxc` and `oci` only.
- **Endpoint:**
  - `lxc` and `oci` work as today: a forward on the member that holds the load balancer. That member is its target when the target is a member, else IncusCloud's choice.
  - `kube-vip` and `ovn` use their host on port 6443, with no forward. The form says the host must be reachable from IncusCloud's management cluster.
- **Manifest** (`clusterManifest`):
  - the `instance` variable is the control plane's;
  - a new optional `workerInstance` variable in `incuscloud-v1` is the workers'; the worker patch falls back to `instance`;
  - `loadBalancer` comes from the spec;
  - `privileged`, the CIDRs (`clusterNetwork`) and the flannel label follow the spec.
- **Scale and upgrade:** `PATCH` keeps `version`, `controlPlanes` and `workers`, with the quota check from the spec.

New read endpoints, each for anyone who can see the tenant:
- `GET /api/v1/kubernetes/:id/status`: the cluster's CAPI conditions (type, status, reason, message), its phase and why it is not available yet.
- `GET /api/v1/kubernetes/:id/activity`: Incendio's activity format (`time, level, source, object, message, count`), merged from:
  - Kubernetes Events on the cluster's CAPI objects in its namespace;
  - IncusCloud's jobs for the cluster.

  The parsing comes from `packages/k8s/src/lib/activity.ts`, imported.
- `GET` and `PUT /api/v1/kubernetes/:id/metallb`:
  - for members and up; `PUT` is audited;
  - `GET` returns `{ installed, addresses, status }`;
  - `PUT { addresses }` installs or updates MetalLB in the workload cluster through its admin kubeconfig, as the Incendio agent does (`packages/k8s/src/lib/metallb.ts`, imported);
  - when the create request asks for MetalLB, the sync worker installs it once the cluster is ready.

## The cluster page (Incendio's layout)

The page is one column of rows:
- the header: the name, its status label, and Scale, Upgrade and Delete;
- General: status, version, endpoint, tenant, Incus cluster and project, nodes ready, created;
- Kubeconfig (download for members and up, audited);
- Control plane (n) and Workers (n): the machines, with the Incus instance and member they run on;
- Load balancer (lxc or oci);
- Load balancer services (MetalLB);
- Activity;
- Conditions.

A caution notification says why a cluster is not available yet, from `status.message`. A negative one says why it will not come up, when the sync worker can tell.

## Testing

- **Server:** each new endpoint and validation, quota from the spec, the manifest per load-balancer type, and the backfill migration.
- **Web:**
  - the form's sections and the request body it sends;
  - the list's filters;
  - the cluster page's rows from mocked API answers;
  - the redirects from the old inventory URLs.
- **Live:**
  - create a cluster with custom machine specs on cluster-d through the form;
  - check the cluster page fills in;
  - scale it, then delete it.
