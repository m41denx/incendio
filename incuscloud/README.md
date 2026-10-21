# IncusCloud

A multi-cluster control plane for [Incus](https://linuxcontainers.org/incus/):
one sign-in, one API endpoint and one UI in front of many Incus clusters,
with tenants, service accounts and an audit log. Design:
[`docs/superpowers/specs/2026-10-11-incuscloud-design.md`](../docs/superpowers/specs/2026-10-11-incuscloud-design.md).

Licensed under GPL-3.0 (see `LICENSE`).

**Installing:** [`docs/INSTALL.md`](docs/INSTALL.md) (Docker Compose or Helm).

**Documentation site:** [`site/`](site/) holds the landing page and the full docs (concepts, installation, guides, operations, reference). Run it with `cd site && bun install && bun run dev`.

## Status

| Phase | What | State |
| --- | --- | --- |
| P0 | Spikes: Hydra tokens in Incus, authenticating proxy, cross-cluster moves | done ([results](docs/spikes.md)) |
| P1 | Server core: config, database, identity, sessions, authorization, platform API, cluster enrolment | done |
| P2 | Gateway: authenticated pass-through to each cluster's API, Incendio per cluster | done |
| P3 | Reconciler: cluster OIDC/OpenFGA configuration, tenant projects | done |
| P4 | Platform UI: clusters, tenants, users, service accounts, logs | done |
| P5 | Fleet: inventory, metrics, global instance search, capacity | done |
| P6 | Mobility: migration with pre-flight, jobs, replication, failover | done |
| P7 | Backups: S3 targets, schedules with retention, restore anywhere | done |
| P8 | Balancing: ProxLB's model per cluster, member maintenance, cross-cluster suggestions | done |
| P9 | Tenant cloud: one quota across clusters, usage, self-service create with placement | done |
| P10 | Kubernetes: clusters on any Incus cluster through one Cluster API install, no appliance per cluster | done |
| ACL 1 | Permissions: privileges, roles and paths with Proxmox-style resolution; entries on the platform, clusters and tenants, granted in Incus too | done |
| ACL 2 | Permissions: ownership, the User role, project, instance and Kubernetes paths; every API call by privilege | done |
| ACL 3 | Permissions: groups, tenants' default groups, cluster-group paths, `restricted.cluster.groups` | done |
| ACL 4 | Quotas: per instance, snapshots, backups, Kubernetes clusters, users' shares inside a tenant | done |
| ACL 5 | Sign-in through OpenID Connect providers; their groups claim mapped onto IncusCloud groups | done |
| ACL 6 | Leases: per-tenant time to live, extensions, stop or delete when a lease ends | done |
| P13 | Packaging: image, Docker Compose, Helm chart, release workflow, installation guide | done |

## How it fits together

- **Identity**: [Ory Hydra](https://www.ory.sh/hydra/) issues JWT access tokens
  (audience `incuscloud`). IncusCloud serves Hydra's login, consent and
  device-code pages and keeps the users. The stock `incus` CLI signs in with
  the device flow; the browser uses a server-side session.
- **One origin.** Set Hydra's issuer to IncusCloud's public URL (`urls.self.issuer: <IC_PUBLIC_URL>/`). IncusCloud then serves Hydra's public endpoints itself: `/oauth2/*`, `/.well-known/openid-configuration`, `/.well-known/jwks.json` and `/userinfo`.
  - Browsers, the `incus` CLI and the clusters only ever see the public URL. Hydra's own port need not be exposed.
  - IncusCloud's back-channel calls (token exchange, JWKS) still go to `IC_HYDRA_PUBLIC_URL` directly.
  - With an issuer on another origin, IncusCloud redirects there instead.
- **Clusters trust Hydra directly** (`oidc.issuer`, `oidc.audience=incuscloud`,
  `oidc.claim=sub`, set by the reconciler), so a token works against every
  cluster and each cluster still enforces access itself.
- **Authorization**: IncusCloud's permissions (see [Permissions](#permissions))
  live in its database and are resolved by IncusCloud itself. Each enrolled
  cluster has its own OpenFGA store (`incuscloud-cluster-<cluster id>`) with
  the grants the reconciler writes for it, so Incus enforces them too.
- **Enrolment**: `incus config trust add incuscloud` on the cluster gives a
  token; `POST /api/v1/clusters` redeems it with a client certificate
  generated for that cluster, pinned by fingerprint.

## Using clusters through IncusCloud

Every enrolled cluster is reachable two ways, always as yourself (your token
is forwarded; IncusCloud never adds credentials and never uses its own
cluster certificate for your requests):

- **API clients** (`incus` CLI, Terraform): `https://<cluster>.<IC_CLUSTER_DOMAIN>`.
  ```sh
  incus remote add prod https://prod.clusters.example.com --auth-type=oidc
  ```
  The CLI follows the device flow: open the printed URL, sign in to
  IncusCloud, done. Tokens refresh by themselves.
- **Browsers**: `https://<public>/clusters/<cluster>/ui/` serves Incendio for
  that cluster with your IncusCloud session; its API calls go to
  `/clusters/<cluster>/1.0`.

Access needs `can_access` on the cluster (platform viewers and up, or
membership in a tenant placed on it). Requests that change something, and
every websocket/file transfer, are logged (`GET /api/v1/gateway-requests`);
reads are sampled with `IC_GATEWAY_SAMPLE_READS`.

The reconciler configures each enrolled cluster so that Incus enforces access
itself:

- `oidc.*` points at Hydra (see above).
- `authorization.openfga.*` points at the cluster's own store,
  `incuscloud-cluster-<cluster id>`, with `authorization.client.oidc=openfga`
  and `authorization.client.tls=allow`.
- Each tenant placed on the cluster gets a restricted Incus project, with
  `limits.*` set to its share of the tenant's quota (see *Tenant cloud*). Its default profile gets a root
  disk and a NIC (copied from the `default` project) and, where the project
  has quotas, per-instance defaults Incus requires (1 CPU, 1 GiB memory, a
  10 GiB root disk, each capped at the quota). The tenant owns the profile
  afterwards; only missing values are filled in.
- Unplacing a tenant revokes its grants but keeps its project: it may still
  hold instances, and the reconciler never deletes what it did not create.
- Grant tuples: tenant owners, admins and members get `operator` on the
  tenant's project, viewers get `viewer`. Never `admin`: an Incus project
  admin can edit the project itself and lift its restrictions. Platform admin, operator and
  viewer get the same role on `server:incus`.

A tenant member's token works directly against the cluster, with the same
limits as through the gateway.

## Platform UI

`incuscloud/web` (`@incuscloud/web`) is the platform's web UI: sign in at
`https://<public>/`. It is one console over every cluster, laid out as an
inventory (as vSphere's), in Incendio's look; Incendio's own pages run
inside it through the federation facade. What each person sees follows
their roles; the API (and Incus) decides every request.

- **Sidebar.** View buttons (Instances, Projects, Members, Networks,
  Storage), then the inventory tree: All clusters → each cluster → what the
  view lists (members and their instances, projects with their instances,
  networks, pools). Each row has its kind's icon tinted by status, and
  running/total counts. Below the tree: the platform's pages (Tenants,
  Kubernetes, Jobs, Replication, Backups, Balancing, and for managers
  Users, Permissions, Service accounts and the logs) and the account. It can be
  dragged 240–360 px wide; the view and width are remembered.
- **Selection.** The URL is the selection. Above the page: a breadcrumb
  back up the tree, and the object's one row of tabs (what does not fit
  goes into More). Objects whose Incendio page has its own tabs (member,
  instance, network, pool, profile) get only the breadcrumb.
  - All clusters (`/`, `/all/…`): Summary (the dashboard), Clusters
    (operators), Instances, Warnings (with a Cluster column).
  - A cluster (`/inventory/<cluster>/<tab>[/<page>]`): Summary, Members,
    Groups, Projects, Networks, Storage, Operations, Access,
    Configure. Tabs with several pages list them in a side menu: cluster and
    placement groups; networks, ACLs, address sets, zones, IPAM,
    integrations; pools, volumes, buckets, custom ISOs; who has access,
    identities, groups, IdP groups, OpenFGA grants and check; IncusCloud's
    settings for it, server and cluster settings, links, replicators,
    certificates, logging, ACME, warnings. Server-wide pages are for
    platform viewers only.
  - A project (`/ui/project/<project@cluster>/…`): Instances, Profiles,
    Networks, Storage, Images, Usage, Access, Configure. Projects
    are never merged across clusters: a project is one cluster's.
- **Kubernetes** is a platform page, like Tenants, made of Incendio's
  Kubernetes pages. The list (`/kubernetes`, `?cluster=` or `?tenant=` to
  filter) has each cluster's status and why, version, nodes, endpoint,
  tenant and Incus cluster. Create (`/kubernetes/new`) is Incendio's form
  with a tenant and an Incus cluster to pick: Cluster (name, version,
  image, load balancer, MetalLB) and Machines (count, type, CPU and memory
  or a CAPN flavor, profiles and target for the control plane and the
  workers; pod and service CIDRs, flannel, kubeadm), with what
  it uses of the tenant's quota. A cluster's page (`/kubernetes/<id>`) is
  Incendio's: General, Kubeconfig, Control plane, Workers, Load balancer,
  Load balancer services (MetalLB), Activity and Conditions, with Scale,
  Upgrade and Delete. The old inventory addresses
  (`…/kubernetes` of a cluster or project) lead there.
- **Access tabs** show who has access to a cluster or project from
  IncusCloud's roles, and what each gives in Incus (what the reconciler
  grants): platform roles on the server, tenant roles on the tenant's
  project.
- **The facade's scope.** A request is one cluster's when it names the
  cluster (a qualified name), else when the console sends
  `X-IncusCloud-Scope` (`all` or a cluster), else when the page it comes
  from is a cluster's (its Referer); otherwise it is every cluster's.

The per-cluster console remains Incendio at `/clusters/<name>/ui/`.

```sh
cd incuscloud/web
bun run build        # → build/, served at / when IC_WEB_DIR points at it
bun run watch        # rebuild on change while scripts/dev.sh serves it
bun run test         # component tests (Vitest, jsdom)
```

`e2e/ui-e2e.cjs` drives a real browser (Playwright) through sign-in,
creating a user and a tenant, placing it on a cluster, a service account,
the console and a tenant member's view; `server/scripts/e2e-cleanup.ts`
removes what it created.

## Fleet

The worker reads every enabled cluster's inventory with the control
plane's admin certificate (never through the gateway), once per
`IC_INVENTORY_INTERVAL`:
- instances in all projects, with their state;
- cluster members (or the standalone server);
- storage pool space per member, and managed networks.

Between two passes it works out each running instance's CPU use (in cores)
and network rates. It keeps `IC_METRICS_RETENTION` hours of samples for
instances and members. Instance configuration is never stored.

The platform UI's **Instances** page searches across every cluster:
- words match the name, project, cluster, member, description, image or addresses;
- filters narrow by cluster, tenant, status and type;
- each instance has a page with its CPU, memory and network charts and a link to its console.

Who sees what:
- Tenant members see the instances in their tenants' projects.
- Platform viewers see everything, plus each cluster's members, storage and capacity (on the cluster page and the dashboard).

A cluster whose inventory fails keeps its last one and shows the error.
`server/scripts/fleet-e2e.ts` checks this on a live cluster.

## Mobility

Instances move and copy between clusters as **jobs**. The worker runs them
(`IC_JOB_CONCURRENCY` at a time), and the API and the **Jobs** page show
their progress. A job can be cancelled, and one left running by a worker
that stopped ends as failed ("interrupted").

**Migration** (the instance page's *Move or copy…*, or
`POST /api/v1/instances/:id/migrations`). A pre-flight on both clusters
checks the target project and name, architecture, storage pool, profiles,
networks, attached volumes and whether a live move is possible.

Then the data moves as Incus migration, in one of two ways:
- **Direct:** the target waits in push mode and the source connects to it.
  Incus refuses pull mode into restricted projects, which all tenant projects are.
- **Relay:** when the source cannot reach the target, the control plane carries
  the operation websockets between them, with backpressure.

How a move proceeds:
- A running container is stopped for a move. Only a running VM with
  `migration.stateful` moves live.
- The order is copy, verify, start the copy, and only then delete the source.
- Until the delete, a failure or cancel removes the copy (tagged with its job)
  and restarts the source.

Who may migrate:
- Tenant owners and admins, between their tenant's placements.
- Platform operators, anywhere, choosing the project, pool and transport.

**Replication** (the *Replication* page, or `/api/v1/replication-policies`).
A policy keeps a stopped replica of an instance on another cluster:
- The first run copies it, tagged with the policy. Later runs refresh it every
  `intervalS` (60 s to 7 days).
- An instance of the same name that is not the policy's replica is never touched.
- **Failover** optionally stops the source (best effort; it may be the cluster
  that is gone), promotes the replica to an ordinary instance and starts it.
  The policy then stops.

`server/scripts/mobility-e2e.ts` runs all of this between two live clusters.

## Backups

Instances are backed up to **S3 targets**: any S3-compatible store, path-style. Platform admins add targets under *Backup targets*:
- The secret key is sealed with `IC_SECRET_KEY` and never returned.
- *Check* writes, reads and deletes a probe object.

A backup is a job: by hand from the instance page (*Back up now…*), or scheduled by a **policy** (*Backup schedule…*: every 1 h to 30 days, keeping the newest N). The cluster makes an Incus backup (a gzip tarball), which reaches the bucket one of two ways:
- **Uploaded by the cluster** (`backup_s3_upload`). This needs the cluster to reach the S3 endpoint.
- **Through the control plane**: streamed with backpressure, straight from the cluster with `direct_backup`, so nothing is stored on the cluster.

*Automatic* tries the first and falls back to the second. A copy kept on the cluster is always removed, and expires after a day regardless.

After a scheduled run succeeds, the policy's oldest ready backups beyond its count are deleted, object first. Manual backups, and those of a deleted policy, stay until deleted.

**Restore** puts a backup on any cluster the caller may use, under a free name; an existing instance is never replaced. Optionally it is started.
- Tenant owners and admins restore into the tenant's ready placements, including next to the original.
- Platform operators restore anywhere and may pick the project and pool.

Incus 7.5 cannot import a backup into a restricted project, which every tenant project is. The fix (2026-10-05) came after 7.5. So a restore into one works like this:
1. The backup is imported into the control plane's own `incuscloud-restore` project on that cluster. Nothing there is started, and tenants have no access to it.
2. It is migrated into the tenant project, which keeps file ownership right.
3. The staged copy is always removed.

Tenant projects get `restricted.backups=allow` from the reconciler; Incus blocks backups in restricted projects otherwise.

`server/scripts/backups-e2e.ts` runs all of this against MinIO and two live clusters. A crashed upload can leave an incomplete multipart upload in the bucket; set a lifecycle rule that aborts those after a day.

## Tenant cloud

A tenant's **quota** (instances, CPUs, memory, disk; set by platform operators) holds across all the clusters it is placed on.

**Usage** is what Incus counts against `limits.*`: what the tenant's instances are given, not what they use at the moment. The reconciler reads it from each project's state. Each project's limits are then set to its own usage plus whatever the tenant has left across all its clusters. So:
- any one cluster can take all of the remaining quota;
- none can grow once the tenant is at its quota;
- a limit is never set below usage. A quota lowered below usage just stops growth everywhere.

Instances created through IncusCloud are checked exactly. Changes made directly through a cluster's API are held by the project limits, which follow within one reconcile pass. Between passes, the overshoot is at most what was left at that moment.

The tenant page shows usage against the quota, and each cluster's usage and share.

**Create instance** (members and up; platform operators for any tenant) asks for:
- an image (any alias on `IC_IMAGE_SERVER`, with a short list offered);
- a type and a size;
- a placement, either automatic or on a chosen cluster.

Automatic placement takes the tenant's ready placements, optionally only clusters with given labels (`region=eu`), and picks the one with the largest share of memory free after the request.

The request is checked against the quota, counting creates still running. Checks are serialised per tenant, so two requests can never both use the last of the quota. Then a job creates the instance with its limits and a sized root disk on the project's default pool, records the new usage, and asks for the tenant's clusters to be reconciled.

Incus applies a project PATCH's config as the whole config: its `projectPatch` merges the old keys into a copy it then ignores. So the reconciler always writes a project's full config with PUT. A PATCH of the limits alone would have dropped `restricted`.

`server/scripts/tenant-cloud-e2e.ts` runs this against two live clusters:
- the split;
- an automatic create;
- the other share shrinking;
- over-quota refused, by the API and by Incus;
- a lowered quota, with both projects still restricted.

## Kubernetes

Tenant members create Kubernetes clusters on any Incus cluster their tenant is placed on. Nothing is installed in the Incus clusters: one [Cluster API](https://cluster-api.sigs.k8s.io/) install with the Incus provider ([CAPN](https://github.com/lxc/cluster-api-provider-incus)), in a Kubernetes cluster of the control plane's own (the **management cluster**), drives them all. IncusCloud talks to its API directly; no `kubectl` or `clusterctl` at runtime.

**Setting it up.** In the management cluster, once:

```sh
# ~/.cluster-api/clusterctl.yaml names CAPN's release URL (see scripts/dev-mgmt.sh)
CLUSTER_TOPOLOGY=true EXP_CLUSTER_RESOURCE_SET=true clusterctl init \
  --core cluster-api:v1.14.3 --bootstrap kubeadm:v1.14.3 --control-plane kubeadm:v1.14.3 --infrastructure incus:v0.9.1
```

Then give IncusCloud a kubeconfig for it (`IC_K8S_KUBECONFIG`), with rights to manage namespaces, secrets, config maps and Cluster API objects. Without one, Kubernetes is off: the UI says so and the API answers 409 `kubernetes_disabled`. IncusCloud applies everything else itself: its ClusterClass `incuscloud-v1` (derived from CAPN's, Apache-2.0) in `incuscloud-system`, and per tenant a namespace `ic-<slug>` with flannel as a ClusterResourceSet.

The Incus hosts need the kernel modules Kubernetes nodes use loaded (`br_netfilter`, `overlay`, `ip_vs`, `nf_nat`): the nodes are unprivileged containers and cannot load them.

**What a cluster is.**
- Nodes are unprivileged containers (or VMs) in the tenant's project, with `security.nesting` only. Tenant projects allow that (`restricted.containers.nesting=allow`) and member targets (`restricted.cluster.target=allow`), not privileged containers.
- A create gives a `spec` (Incendio's options) or a `size`, not both. The spec has, for the control plane and the workers, the instance type (container or VM), a CAPN flavor `c<cores>-m<GiB>`, profiles and a target (a member or `@group`); the load balancer (below); the node image; flannel; kubeadm installed on boot; the pod and service CIDRs; and MetalLB addresses. A size is a spec with a preset flavor: small (2 CPUs, 2 GiB), medium (2, 4), large (4, 8). One, three or five control plane nodes, up to 20 workers. Versions with prebuilt CAPN images: v1.34.0, v1.35.5, v1.36.4, v1.37.0.
- Nodes and an instance load balancer count against the tenant's quota as instances, at their flavor's size (10 GiB of disk each). A create is checked like an instance create, counting creates still running; scaling up is checked too, scaling down never is.
- CAPN gets a client certificate trusted only for the tenant's project on that Incus cluster. Its key exists only in the management cluster's secret; IncusCloud keeps the fingerprint and revokes the certificate when the tenant's last Kubernetes cluster there is deleted.

**The API endpoint.** The management cluster and the nodes must both reach each cluster's API server. CAPN's load balancer is one of:
- `lxc` or `oci`: haproxy in an instance in the tenant's project, with its own flavor, profiles and target (a member, not a group: the forward goes to its member). It gets an address on the project's network; IncusCloud presets the cluster's endpoint to the Incus cluster's (or member's) address and a port from `IC_K8S_PORTS` (default 16443–16999), and adds a network forward from there to the load balancer's port 6443. The sync worker keeps the forward pointed at the load balancer when its address changes.
- `kube-vip` (an IP address and interface) or `ovn` (an IP address on an OVN network): the endpoint is that address, port 6443, with no forward. An address is one cluster's endpoint only.

**Multi-member Incus clusters.** Without OVN each member's bridge is its own network, so a cluster runs on one member: its load balancer and every node without a target of its own are pinned there, and its endpoint is that member's address. The member is the one asked for, or the online one with the most memory free.

**MetalLB.** Given addresses (ranges or CIDRs), IncusCloud installs MetalLB (`IC_METALLB_MANIFEST_URL`, default v0.16.0 native) in the workload cluster once it is available, with one address pool, so Services of type LoadBalancer get an address. Members change the addresses later (`PUT …/metallb`, a job); through the API, an empty list stops asking for it.

IncusCloud only touches forward ports marked `incuscloud k8s <id>`. A forward on the same address that is not its own is shared, and a port someone else forwards is refused rather than taken over.

**Lifecycle.** A create is a job: namespace, credentials, the Cluster, then the forward once the load balancer has an address, then waiting for `ControlPlaneAvailable` (30 min). The sync worker (lease `kubernetes`, every 15 s) turns Cluster conditions and Machines into ready or degraded, with the reason and nodes ready. Scale and upgrade (one minor version at a time) are applied to the Cluster topology directly. A delete is a job: it stops a create still running, deletes the Cluster and waits for CAPN to remove the nodes, then removes the forward port and, if it was the last, the certificate. The kubeconfig download (members and up, audited) is CAPI's admin kubeconfig. A cluster's status is CAPI's phase and conditions; its activity merges the workload's events with IncusCloud's jobs for it. A tenant with Kubernetes clusters on an Incus cluster cannot be removed from it, and that cluster cannot be deleted, even with `force`.

`server/scripts/k8s-e2e.ts` runs it against a live cluster: a create, the workload API through the endpoint with the downloaded kubeconfig, a worker joining, scaling over the quota refused, and a delete that leaves nothing behind.

## Balancing

Balancing keeps a cluster's members evenly loaded. It follows [ProxLB](https://github.com/gyptazy/ProxLB)'s model (GPLv3, like this project), reimplemented in `server/src/balancing/engine.ts`.

**Spread** is the busiest member's percentage minus the least busy one's, by **memory, CPU or disk**. It is measured either as what instances **use** (what members report) or as what they are **given** (limits).

When the spread exceeds the policy's tolerance, a run plans moves:
1. Pins are enforced.
2. Anti-affinity groups are spread out.
3. Split affinity groups are gathered.
4. While the spread is too high, the busiest member that can still lower it gives up the instance, or the whole affinity group, whose move leaves the lowest spread.

A move must fit its target and strictly lower the spread. No instance moves twice in one run, and a run makes at most the policy's number of moves.

Each move is Incus's own same-cluster move, and the instance is checked again just before:
- A VM with `migration.stateful` moves live.
- A stopped instance moves as it is.
- Another running instance is stopped, moved and started, but only if the policy allows restarts. Otherwise the plan says how many it left alone.
- An instance that changed member or state since the plan is skipped.
- A failed move starts the instance again where it was.

Cancelling a run stops it between moves.

Tenants steer placement with keys on their own instances. Groups are per project, so they never involve another tenant:

| Key | Effect |
| --- | --- |
| `user.incuscloud.affinity=<group>` | keep the group on one member |
| `user.incuscloud.anti-affinity=<group>` | keep the group on different members |
| `user.incuscloud.pin=<member>[,<member>…]` | only on these members |
| `user.incuscloud.balance=false` | never moved by balancing |

Platform operators set a cluster's policy in the *Balancing* section of its page:
- what to balance by;
- the tolerance;
- moves per run;
- whether restarts are allowed;
- excluded members and projects;
- whether to run automatically, and how often.

The same section has *Preview*, a dry run that moves nothing, and *Rebalance now*.

**Member maintenance** is Incus's evacuation. *Evacuate…* moves or stops a member's instances (cluster default, move, move live, or stop), and *Restore* brings them back. Members that are evacuated, offline or excluded are never sources or targets.

The *Balancing* page suggests moves across clusters for tenants placed on several. When a tenant's busiest cluster is more than 20 points of memory above its least busy one, the page lists the tenant's largest running instances there, while each move narrows the gap. *Move…* opens the migration dialog with the suggested cluster chosen. Nothing moves until someone starts it.

Incus's own `cluster.rebalance.*` live-migrates VMs with no notion of these hints. Do not enable it on a cluster that IncusCloud balances, or the two will undo each other's moves.

`server/scripts/balancing-e2e.ts` runs all of this against a live two-member cluster:
- a plan and a run, including a restart;
- a pin;
- anti-affinity;
- evacuating a member and restoring it.

## Permissions

Who may do what is a set of **entries**: a role for a user or service
account on a path. The design is
[the permissions spec](../docs/superpowers/specs/2026-10-12-incuscloud-acl-design.md);
phases 1 and 2 are in.

- **Privileges** are `<object>.<action>` (`instance.console`,
  `cluster.configure`, `acl.manage`, …). **Roles** bundle them:
  Administrator, Operator, Cluster owner, Unrestricted user, User, Tenant
  admin, Auditor and No access can be given now; Group owner comes with
  groups. Unrestricted user is today's tenant member: it does everything in
  the tenant's projects except what tenant admins decide (moving instances
  between clusters, backups and restores, replication, backup schedules,
  deleting Kubernetes clusters).
- **Paths:** `/` (everything), `/clusters/<name>`,
  `/clusters/<name>/projects/<project>`,
  `/clusters/<name>/projects/<project>/instances/<instance>`,
  `/tenants/<slug>` and `/tenants/<slug>/kubernetes/<name>`. A path must
  name something that exists. Unrestricted user goes on tenants and
  projects only for now: on a cluster it would reach every tenant's
  projects there. A tenant entry applies to the tenant's projects on every
  cluster, between the project and the cluster.
- **Ownership and the User role.** Instances and Kubernetes clusters have
  an owner: whoever created them, through IncusCloud (self-service create,
  restore, copy; a move keeps its owner, a replica takes its source's) or
  straight against a cluster (its lifecycle events name the caller).
  Instances nobody claimed go to their tenant's first owner. A **User** may
  create in the tenant (placement chooses where) and acts only on what they
  own: they never see other users' instances, in IncusCloud or in Incus.
  Renaming an instance moves its entries; deleting it deletes them.
- **Resolution** (Proxmox's): the most specific path with an entry for the
  subject decides. Entries further up count only if they propagate.
  No access there means nothing.
- **Today's roles are entries too.** Platform roles are entries on `/`
  (admin = Administrator, operator = Operator, viewer = Auditor). Tenant
  roles are entries on the tenant (owner and admin = Tenant admin,
  member = Unrestricted user, viewer = Auditor), and so are tenant service
  accounts. They are still edited on the Users, Tenants and Service accounts
  pages; Platform › Permissions lists them read-only beside the explicit
  entries.
- **In Incus.** Explicit entries become grants through IncusCloud's own
  `incuscloud-acl-*` groups. A cluster entry gives a server relation
  (Administrator and Cluster owner `admin`, Operator and Unrestricted user
  `operator`, Auditor `viewer`). A tenant entry gives a project relation on
  the tenant's projects (`operator` or `viewer`, never project `admin`). When
  a tenant or project entry gives less than the cluster's, the server
  relation is replaced by project relations on every other project there.
  An instance entry gives an instance relation (`operator` with
  `instance.configure`, `user` with the console only, `viewer`); one that
  gives less than its project replaces the project relation by relations
  on its other instances. A User gets no project relation (in Incus that
  would show every instance in it): the project's create and event
  entitlements, `can_view` on its profiles, networks and images, and
  `operator` on what they own. The console fills in the project page Incus
  refuses them. Subjects without explicit entries keep exactly today's
  grants.
- **Rules.** Changing an entry needs `acl.manage` on its path; only
  administrators give Administrator or Cluster owner (Cluster owner is root
  on that cluster's hosts). A change never reaches someone above the caller:
  nobody who holds, there or above, a privilege the caller lacks, nor a
  tenant's owner unless the caller is an owner or a user administrator, nor
  an entry made by such a person. So a tenant admin can narrow its members
  but not platform staff, and cannot add platform staff as members either. Someone must stay an
  administrator (a platform admin or an Administrator entry on `/`).
  Deleting a cluster, tenant, user or service account deletes its entries.
- **Console.** Platform › Permissions (for `acl.view` on `/`): Entries
  (filter, add, remove), Roles, and Check (what a subject may do on a path,
  and which entries decided it), with project and instance pickers. A
  cluster's or project's Access tab lists the entries that reach it, with
  what each gives in Incus, and adds or removes them for whoever holds
  `acl.manage` there. An instance's page names its owner.
- **The API** checks every call by privilege on the object's path:
  instances (`instance.view`, `instance.relocate` to move between
  clusters, `instance.create` on the tenant to create, `placement.choose`
  to pick the cluster), backups and replication on the instance, jobs on
  their instance or tenant, Kubernetes clusters on their own path, tenants,
  users, service accounts and the logs. Lists show only what the caller may
  view.

## Configuration

Settings are `IC_*` environment variables; `server/.env.example` lists them
all. The reconciler's settings:

- `IC_ROLE`: `api` (HTTP API and gateway), `worker` (reconciler) or `all`
  (both; default). Only one worker replica reconciles at a time, coordinated
  by a lease row in Postgres.
- `IC_OPENFGA_CLUSTER_URL`: OpenFGA's URL as the Incus clusters reach it.
  Default: `IC_OPENFGA_URL`.
- `IC_OPENFGA_CLUSTER_TOKEN`: the API token clusters use. Default:
  `IC_OPENFGA_TOKEN`. See [Security notes](#security-notes).
- `IC_WEB_DIR`: the platform UI build (`incuscloud/web/build`), served at `/`.
- `IC_RECONCILE_INTERVAL`: seconds, 10..86400, default 60. Each cluster is
  reconciled at least this often, and right after any API change that affects it.
- `IC_INVENTORY_INTERVAL`: seconds, 0 (off) or 10..86400, default 60. Each
  cluster's inventory (instances, members, storage, networks) and metrics are
  read this often by the worker.
- `IC_METRICS_RETENTION`: hours of metrics history kept, 1..720, default 24.
- `IC_JOB_CONCURRENCY`: jobs (migrations, replication runs, failovers) the
  worker runs at once, 1..16, default 2.
- `IC_IMAGE_SERVER`: the simplestreams server self-service creates take
  images from, default `https://images.linuxcontainers.org`.
- `IC_K8S_KUBECONFIG`: the management cluster's kubeconfig; unset turns
  Kubernetes off. See [Kubernetes](#kubernetes).
- `IC_K8S_PORTS`: the port range for Kubernetes API endpoints on member
  addresses, default `16443-16999`.
- `IC_METALLB_MANIFEST_URL`: the MetalLB manifest installed for clusters
  that ask for it, default MetalLB v0.16.0's `metallb-native.yaml`.

## Development

```sh
scripts/dev-deps.sh        # once: Hydra and OpenFGA binaries, a development CA
scripts/dev.sh             # Hydra + OpenFGA (state in .dev/openfga.db) + server on https://127.0.0.1:7443
```

Sign in as `admin@incuscloud.dev` with the password in `.dev/admin-password`.

For Kubernetes, `scripts/dev-mgmt.sh` makes a management cluster: k3s in a
privileged container `ic-mgmt` on the dev host, with Cluster API and CAPN, and
`.dev/mgmt.kubeconfig`, which `scripts/dev.sh` then uses. Set `IC_MGMT_POOL`
and `IC_MGMT_NETWORK` for the container's storage pool and network.

To use a dev cluster through the gateway, Hydra and OpenFGA must be reachable
from it: start with `IC_DEV_HOST=<host address on the cluster's network> scripts/dev.sh`,
enrol the cluster (`bun scripts/smoke.ts "$(incus config trust add incuscloud --quiet)"`
on that cluster), then run `scripts/dev-cluster-oidc.sh <project> <instance>`.
That script only installs the dev CA (`.dev/tls/ca.crt`) on the instance; the
reconciler sets `oidc.*` and `authorization.*`. Trust `.dev/tls/ca.crt` or
use `curl --cacert`.

```sh
cd server
bun test                                        # unit tests (PGlite, fakes)
IC_IT_HYDRA=1 IC_IT_OPENFGA=http://127.0.0.1:18080 bun test   # plus live Hydra/OpenFGA
IC_IT_POSTGRES=postgres://… bun test src/db     # migrations on real Postgres
IC_IT_TRUST_TOKEN=$(incus config trust add it --quiet) bun test src/clusters
bun scripts/smoke.ts [trust-token]              # end to end against scripts/dev.sh
bun scripts/cli-e2e.ts [cluster]                # stock incus CLI through the gateway
bun scripts/tenant-e2e.ts [cluster]             # a tenant member, through the gateway and directly
bun scripts/k8s-e2e.ts [cluster]                # a Kubernetes cluster's whole life (needs dev-mgmt.sh)
```

The server tests import `@incendio/api/node`; build it first
(`cd packages/api && bun run build`).

## API (P1)

All under `/api/v1`, bearer token or session cookie. Errors are
`{ "error": { "code", "message" } }`.

| Endpoint | Who |
| --- | --- |
| `GET me` | anyone signed in; `rootPrivileges` are the caller's privileges on `/` |
| `GET acl/roles` | anyone signed in: each role and its privileges |
| `GET acl/entries?path` | entries at and below `path` (default `/`) whose path the caller has `acl.view` on; today's roles as read-only entries with `editedOn` |
| `POST acl/entries`, `DELETE acl/entries/:id` | `acl.manage` on the entry's path; Administrator and Cluster owner by administrators only; the last administrator stays (409) |
| `GET acl/check?subject=user:<id>&path` | `acl.view` on the path: the subject's privileges there and the deciding entries |
| `GET/POST users`, `GET/PATCH/DELETE users/:id` | platform admin (viewers read) |
| `GET/POST tenants`, `GET/PATCH/DELETE tenants/:id` | operators create; tenant admins rename; operators set quotas; owners delete |
| `GET tenants/:id/members`, `POST tenants/:id/members` (by email), `PUT/DELETE tenants/:id/members/:userId` | tenant admins; owners manage owners |
| `GET tenants/:id/placements` | anyone who can see the tenant: its clusters, projects and their status |
| `GET instances?q&cluster&tenant&status&type&limit&offset` | the global instance search: what the caller holds `instance.view` on (a User: their own); `q` words must all match (name, project, cluster, member, description, image, addresses) |
| `GET instances/:id`, `GET instances/:id/metrics?hours` | one instance (with its `owner`) and its CPU (cores), memory and network history |
| `GET access?cluster&project` | who has access to a cluster (or one project on it): platform roles (platform viewers only), each visible tenant's members, and the permission entries that reach it (those the caller may read), each with the Incus relation it gives; project and instance entries too; `canManage` when the caller holds `acl.manage` on the page's path |
| `GET kubernetes?tenant`, `GET kubernetes/:id`, `GET kubernetes/versions` | anyone who can see the tenant: clusters with their spec; versions, whether Kubernetes is on, and the default spec |
| `POST kubernetes`, `PATCH kubernetes/:id`, `DELETE kubernetes/:id` | tenant members create (a spec or a size; 202, a job), scale and upgrade; tenant admins delete (a job) |
| `GET kubernetes/:id/nodes`, `GET kubernetes/:id/status`, `GET kubernetes/:id/activity` | anyone who can see the tenant: machines with their Incus instances, phase, version and readiness; CAPI's phase and conditions; events and jobs |
| `GET/PUT kubernetes/:id/metallb` | MetalLB's addresses and state; tenant members set them (202, a job) |
| `GET kubernetes/:id/kubeconfig` | tenant members: the admin kubeconfig (audited) |
| `GET clusters/:id/inventory`, `GET clusters/:id/metrics?hours` | `cluster.view` on the cluster: members, storage pools, networks, instance counts; member memory and load history |
| `GET fleet/summary` | instance counts by status (what the caller sees); per-cluster capacity for platform viewers |
| `POST instances/:id/migrations/preflight`, `POST instances/:id/migrations` | check, then start a move or copy to another cluster (202, a job) |
| `GET jobs`, `GET jobs/:id`, `POST jobs/:id/cancel` | jobs: one's own, those on instances one may view, a tenant's jobs on no instance for `instance.view` on the whole tenant; cancel by the actor, `tenant.manage` or `cluster.configure` |
| `GET/POST replication-policies`, `GET/PATCH/DELETE replication-policies/:id`, `POST …/:id/run`, `POST …/:id/failover` | replication policies, a run now, a failover (jobs) |
| `GET/POST backup-targets`, `PATCH/DELETE backup-targets/:id`, `POST …/:id/check` | S3 targets (platform admins; others see names) |
| `POST instances/:id/backups`, `GET backups`, `GET/DELETE backups/:id`, `POST backups/:id/restore` | back up now, list, delete, restore (jobs) |
| `GET/POST backup-policies`, `GET/PATCH/DELETE backup-policies/:id`, `POST …/:id/run` | backup schedules with retention |
| `GET/PUT clusters/:id/balancing`, `POST …/balancing/plan`, `POST …/balancing/run` | balancing policy (`cluster.view` reads, `cluster.configure` writes), a dry run, a run (job) |
| `POST clusters/:id/members/:name/evacuate`, `POST …/members/:name/restore` | member maintenance (`node.maintain` on the cluster; jobs) |
| `GET tenants/:id/usage`, `POST tenants/:id/instances`, `GET images` | quota usage across clusters; self-service create (202, a job); image choices |
| `GET balancing/suggestions` | cross-cluster moves for the caller's tenants |
| `GET/POST service-accounts`, `POST service-accounts/:id/rotate`, `DELETE service-accounts/:id` | tenant admins for tenant accounts, platform admins otherwise |
| `GET/POST clusters`, `GET/PATCH/DELETE clusters/:id` | platform admins enrol and delete; `cluster.configure` on the cluster edits labels; each caller sees the clusters it has rights on (tenants: those they are placed on) |
| `GET clusters/:id/tenants`, `PUT/DELETE clusters/:id/tenants/:tenantId` | `cluster.configure` on the cluster places tenants (`cluster.view` lists them) |
| `POST clusters/:id/reconcile` | `cluster.configure` on the cluster; returns 202 |
| `GET audit` | platform viewers; tenant admins with `?tenant=` |
| `GET gateway-requests` | platform viewers; tenant admins with `?tenant=` |

Browser: `/auth/start?return_to=/…`, `/auth/callback`, `/auth/logout`.
Hydra pages: `/auth/login`, `/auth/consent`, `/auth/device`.

## Security notes

- **One OpenFGA token is shared by all clusters.** Incus supports only a single
  static token (`authorization.openfga.api.token`), so the reconciler writes
  the same token to every cluster. Root on any enrolled cluster can read it,
  and OpenFGA accepts a preshared key for every store, so with it root can
  read or write tuples in any store on that OpenFGA, so in other clusters'
  stores. That is, root on one cluster can grant itself access to other
  clusters' Incus. IncusCloud's own permissions are not in OpenFGA, so it
  cannot grant itself rights in IncusCloud.
- What helps today:
  1. A separate `IC_OPENFGA_CLUSTER_TOKEN` keeps the platform's own token off
     the clusters, so it can be rotated independently. It does not limit what
     the cluster token can do.
  2. Keep OpenFGA reachable only from the cluster networks and IncusCloud.
     This limits who can connect, not what a holder of the token can do.
- Planned hardening: a small OpenFGA proxy that issues per-cluster tokens,
  each scoped to that cluster's store. Until then, this is a known and
  accepted limitation.
