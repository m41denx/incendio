# IncusCloud

A multi-cluster control plane for [Incus](https://linuxcontainers.org/incus/):
one sign-in, one API endpoint and one UI in front of many Incus clusters,
with tenants, service accounts and an audit log. Design:
[`docs/superpowers/specs/2026-10-11-incuscloud-design.md`](../docs/superpowers/specs/2026-10-11-incuscloud-design.md).

Licensed under GPL-3.0 (see `LICENSE`).

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

## How it fits together

- **Identity**: [Ory Hydra](https://www.ory.sh/hydra/) issues JWT access tokens
  (audience `incuscloud`). IncusCloud serves Hydra's login, consent and
  device-code pages and keeps the users. The stock `incus` CLI signs in with
  the device flow; the browser uses a server-side session.
- **Clusters trust Hydra directly** (`oidc.issuer`, `oidc.audience=incuscloud`,
  `oidc.claim=sub`, set by the reconciler), so a token works against every
  cluster and each cluster still enforces access itself.
- **Authorization**: one OpenFGA store (`incuscloud-platform`) holds platform,
  tenant and cluster roles. Each enrolled cluster also has its own store
  (`incuscloud-cluster-<cluster id>`) with the grants the reconciler writes
  for it. The database is the source of truth; tuples are its projection,
  re-synced at start.
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
`https://<public>/` and manage clusters (enrol, place tenants, reconcile,
console links), tenants (quotas, members, where they run), users, service
accounts (the secret is shown once) and the audit and gateway logs. What
each person sees follows their roles; the API decides every request. The
per-cluster console remains Incendio at `/clusters/<name>/ui/`.

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

## Development

```sh
scripts/dev-deps.sh        # once: Hydra and OpenFGA binaries, a development CA
scripts/dev.sh             # Hydra + OpenFGA (state in .dev/openfga.db) + server on https://127.0.0.1:7443
```

Sign in as `admin@incuscloud.dev` with the password in `.dev/admin-password`.

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
```

The server tests import `@incendio/api/node`; build it first
(`cd packages/api && bun run build`).

## API (P1)

All under `/api/v1`, bearer token or session cookie. Errors are
`{ "error": { "code", "message" } }`.

| Endpoint | Who |
| --- | --- |
| `GET me` | anyone signed in |
| `GET/POST users`, `GET/PATCH/DELETE users/:id` | platform admin (viewers read) |
| `GET/POST tenants`, `GET/PATCH/DELETE tenants/:id` | operators create; tenant admins rename; operators set quotas; owners delete |
| `GET tenants/:id/members`, `POST tenants/:id/members` (by email), `PUT/DELETE tenants/:id/members/:userId` | tenant admins; owners manage owners |
| `GET tenants/:id/placements` | anyone who can see the tenant: its clusters, projects and their status |
| `GET instances?q&cluster&tenant&status&type&limit&offset` | the global instance search: platform viewers see all, others their tenants' projects; `q` words must all match (name, project, cluster, member, description, image, addresses) |
| `GET instances/:id`, `GET instances/:id/metrics?hours` | one instance and its CPU (cores), memory and network history |
| `GET clusters/:id/inventory`, `GET clusters/:id/metrics?hours` | platform viewers: members, storage pools, networks, instance counts; member memory and load history |
| `GET fleet/summary` | instance counts by status (what the caller sees); per-cluster capacity for platform viewers |
| `POST instances/:id/migrations/preflight`, `POST instances/:id/migrations` | check, then start a move or copy to another cluster (202, a job) |
| `GET jobs`, `GET jobs/:id`, `POST jobs/:id/cancel` | jobs: platform viewers see all, others their tenants' and their own |
| `GET/POST replication-policies`, `GET/PATCH/DELETE replication-policies/:id`, `POST …/:id/run`, `POST …/:id/failover` | replication policies, a run now, a failover (jobs) |
| `GET/POST backup-targets`, `PATCH/DELETE backup-targets/:id`, `POST …/:id/check` | S3 targets (platform admins; others see names) |
| `POST instances/:id/backups`, `GET backups`, `GET/DELETE backups/:id`, `POST backups/:id/restore` | back up now, list, delete, restore (jobs) |
| `GET/POST backup-policies`, `GET/PATCH/DELETE backup-policies/:id`, `POST …/:id/run` | backup schedules with retention |
| `GET/PUT clusters/:id/balancing`, `POST …/balancing/plan`, `POST …/balancing/run` | balancing policy (viewers read, operators write), a dry run, a run (job) |
| `POST clusters/:id/members/:name/evacuate`, `POST …/members/:name/restore` | member maintenance (platform operators; jobs) |
| `GET tenants/:id/usage`, `POST tenants/:id/instances`, `GET images` | quota usage across clusters; self-service create (202, a job); image choices |
| `GET balancing/suggestions` | cross-cluster moves for the caller's tenants |
| `GET/POST service-accounts`, `POST service-accounts/:id/rotate`, `DELETE service-accounts/:id` | tenant admins for tenant accounts, platform admins otherwise |
| `GET/POST clusters`, `GET/PATCH/DELETE clusters/:id` | platform admins enrol; tenants see clusters they are placed on |
| `GET clusters/:id/tenants`, `PUT/DELETE clusters/:id/tenants/:tenantId` | platform operators place tenants |
| `POST clusters/:id/reconcile` | platform operators; returns 202 |
| `GET audit` | platform viewers; tenant admins with `?tenant=` |
| `GET gateway-requests` | platform viewers; tenant admins with `?tenant=` |

Browser: `/auth/start?return_to=/…`, `/auth/callback`, `/auth/logout`.
Hydra pages: `/auth/login`, `/auth/consent`, `/auth/device`.

## Security notes

- **One OpenFGA token is shared by all clusters.** Incus supports only a single
  static token (`authorization.openfga.api.token`), so the reconciler writes
  the same token to every cluster. Root on any enrolled cluster can read it,
  and OpenFGA accepts a preshared key for every store, so with it root can
  read or write tuples in any store on that OpenFGA: other clusters' stores
  and the platform store alike. That is, root on one cluster can grant itself
  access elsewhere.
- What helps today:
  1. A separate `IC_OPENFGA_CLUSTER_TOKEN` keeps the platform's own token off
     the clusters, so it can be rotated independently. It does not limit what
     the cluster token can do.
  2. Keep OpenFGA reachable only from the cluster networks and IncusCloud.
     This limits who can connect, not what a holder of the token can do.
- Planned hardening: a small OpenFGA proxy that issues per-cluster tokens,
  each scoped to that cluster's store. Until then, this is a known and
  accepted limitation.
