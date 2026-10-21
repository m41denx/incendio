# IncusCloud P5 — Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One view over every cluster's instances, members and storage. The worker keeps an inventory and short metrics history. The API answers a global instance search. The UI shows an instance list, instance pages with charts, cluster capacity and a fleet dashboard.

**Architecture:**
- A second leased loop in the worker (`fleet/worker.ts`, lease `inventory`) visits each enabled cluster every `IC_INVENTORY_INTERVAL` (default 60 s).
- It uses the control plane's admin client (D6), never the gateway.
- `collect.ts` reads the cluster into a normalised snapshot.
- `store.ts` writes the snapshot: upserts, removes what disappeared, derives rates from the previous counters and appends `metrics_samples`.
- The API filters by what the caller may see: platform viewers see everything; others see instances in projects of tenants they belong to (join on `placements`).

**Tech Stack:** as P1–P4 (Bun, Elysia, Drizzle, PGlite tests, FakeIncus; React/Vanilla UI, Vitest). Charts are small inline SVG components, with no chart library.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (§1 "global inventory, metrics", §3.2 inventory tables, D6, P5 row).

## Global Constraints

- **Reads only.** P5 never changes a cluster, and inventory uses the admin client (D6). One cluster failing never stops the others; its error is kept on the cluster row and shown.
- **Tenants never see:** other tenants' instances, cluster members, capacity or storage pools. Capacity is for platform viewers.
- **Bounded metrics.** Samples older than `IC_METRICS_RETENTION` hours (default 24) are pruned on every pass.
- **Clustered and standalone Incus both work.**
  - Clustered (`environment.server_clustered`): `/1.0/cluster/members` and `/1.0/cluster/members/<m>/state`.
  - Standalone: `/1.0/resources`, with the server name as the only member.
  - Both: `/1.0/instances?recursion=2&all-projects=true`, `/1.0/storage-pools?recursion=1`, `/1.0/networks?recursion=1&all-projects=true`.
- **No secrets stored.** Instance `config` is never stored. Only the fields listed in Task 1 are kept (limits, image os/release).

## Review Focus

- **Counter resets:** an instance restarted between passes, or a migration that resets its counters, gives a negative delta. The rate must be null, not a negative or huge number.
- **Disk usage:** Incus reports -1 (unknown) for some drivers. Store it as null and show it as "—".
- **Renames, deletions, moves:** an instance renamed or deleted in Incus disappears from the list on the next pass. An instance moved to another project or member is updated, not duplicated.
- **Search text:** `%`, `_` and `\` in `q` match literally. Several words must all match, in any field.
- **Large clusters:** the instances call is one request. A cluster whose pass times out records the error and keeps the last inventory, marked by `inventory_at`.

---

### Task 1: Schema

**Files:**
- Create: migration `drizzle/0005_fleet.sql` (generated) and `src/fleet/schema.test.ts`.
- Modify: `src/db/schema.ts`.

**Interfaces (tables):**
- `clusters` += `inventory_at timestamptz`, `inventory_error text not null default ''`.
- `cluster_members` (cluster_id fk cascade, name; pk both):
  - `url`, `status`, `roles jsonb`, `architecture`;
  - `cpu_threads int`, `memory_total bigint`, `memory_used bigint`, `load1 real null`, `uptime_s bigint null`, `updated_at`.
- `instances` (id uuid pk; unique (cluster_id, project, name)):
  - identity: `type`, `status`, `location`, `description`, `architecture`, `created_at_incus timestamptz`;
  - image and limits: `image_os`, `image_release`, `limits_cpu text`, `limits_memory text`;
  - counters: `cpu_ns bigint null`, `memory_used bigint null`, `memory_total bigint null`, `disk_used bigint null`, `net_rx bigint null`, `net_tx bigint null`;
  - rates: `cpu_cores real null`, `net_rx_bps real null`, `net_tx_bps real null`;
  - `addresses jsonb string[]`, `search text` (lower-case haystack), `seen_at`;
  - index (cluster_id), index on (search).
- `storage_pools` (cluster_id, member, name; pk all three): `driver`, `status`, `space_total bigint null`, `space_used bigint null`.
- `networks` (cluster_id, project, name; pk all three): `type`, `managed bool`, `status`, `description`.
- `metrics_samples` (bigserial id):
  - `at`, `cluster_id` fk cascade, `kind` (`instance` | `member`), `ref` (instance id, or member name);
  - `cpu_cores real null`, `memory_used bigint null`, `net_rx_bps real null`, `net_tx_bps real null`, `load1 real null`;
  - index (kind, ref, at), index (at).

- [ ] **Test:** the migration applies on PGlite. Deleting a cluster cascades to all five tables.

### Task 2: Collector

**Files:**
- Create: `src/fleet/collect.ts` and `src/fleet/collect.test.ts`.
- Modify: `src/clusters/fake-incus.ts`, adding fixtures for `fleet` (clustered and standalone shapes).

**Interfaces:**
```ts
export interface Snapshot {
  clustered: boolean;
  members: Array<{ name: string; url: string; status: string; roles: string[]; architecture: string; cpuThreads: number; memoryTotal: number; memoryUsed: number; load1: number | null; uptimeS: number | null }>;
  instances: Array<{ project: string; name: string; type: string; status: string; location: string; description: string; architecture: string; createdAt: string; imageOs: string; imageRelease: string; limitsCpu: string; limitsMemory: string; cpuNs: number | null; memoryUsed: number | null; memoryTotal: number | null; diskUsed: number | null; netRx: number | null; netTx: number | null; addresses: string[] }>;
  pools: Array<{ member: string; name: string; driver: string; status: string; spaceTotal: number | null; spaceUsed: number | null }>;
  networks: Array<{ project: string; name: string; type: string; managed: boolean; status: string; description: string }>;
}
export async function collectInventory(client: Pick<IncusAdminClient, "request">): Promise<Snapshot>;
```

How each field is derived:
- **Instance counters:**
  - `memoryTotal` is the state's `memory.total`, or null when 0.
  - `diskUsed` is the root disk's usage, or the sum of all disks; -1 or a missing value gives null.
  - Network counters sum every interface except loopback.
- **Addresses:** global addresses from non-loopback interfaces, excluding `fe80::/10`.
- **Stopped instances:** no state, so counters are null.
- **Pools (clustered):** space comes from each member's state `storage_pools` (keyed by pool name).
- **Pools (standalone):** space comes from `/1.0/storage-pools/<p>/resources`. A failure there gives null space.

- [ ] **Tests:**
  - A standalone fixture maps to one member named after `environment.server_name`, with CPU threads and memory from `/1.0/resources`.
  - A clustered fixture maps member state, `load1` and per-member pool space.
  - Instance mapping covers addresses (no loopback or link-local), summed network counters, disk -1 as null, and a stopped instance with null counters.

### Task 3: Store and rates

**Files:**
- Create: `src/fleet/store.ts` and `src/fleet/store.test.ts`.

**Interfaces:**
- `applySnapshot(db, clusterId, clusterName, snap, now: Date, retentionMs): Promise<{ instances: number }>`, running in one transaction.
- Instances upsert by (cluster, project, name).
- Rates against the stored row:
  - `cpu_cores = (cpuNs - prev.cpu_ns) / ((now - prev.seen_at) in ns)`; network rates in bytes/s.
  - Null when there is no previous value, the delta is negative or the elapsed time is ≤ 0.
- `search = lower(join(" ", name, project, clusterName, location, description, imageOs, imageRelease, type, status, ...addresses))`.
- Removals: instances, members, pools and networks not in the snapshot are deleted.
- Samples: one `instance` sample per running instance (with rates and memory) and one `member` sample per member (memory used, load1).
- Pruning: samples with `at < now - retentionMs` are deleted.
- The cluster row gets `inventory_at = now` and `inventory_error = ''`.

- [ ] **Tests:**
  - The first pass gives null rates.
  - The second pass, 60 s later with +30e9 ns of CPU, gives 0.5 cores; the network rate is correct.
  - A counter reset gives a null rate.
  - Removal: an instance deleted in the snapshot is removed, and its samples stay until pruned.
  - A project move keeps one row per (cluster, project, name), so the old row goes.
  - Pruning works.
  - Search text contains the IP and is lower-case.

### Task 4: Fleet worker

**Files:**
- Create: `src/fleet/worker.ts` and `src/fleet/worker.test.ts`.
- Modify: `src/config.ts` (`IC_INVENTORY_INTERVAL` in seconds, default 60, 0 disables; `IC_METRICS_RETENTION` in hours, default 24), `src/main.ts`, `.env.example`, `scripts/dev.sh` (`IC_INVENTORY_INTERVAL=15` in dev) and README.

**Interfaces:**
- `class FleetWorker { constructor(deps: { db; secretKey }, opts: { holder; intervalMs; retentionMs; pollMs?; leaseMs?; collect? }); tick(); start(); stop() }`, with lease `inventory`.
- Due clusters: those not disabled with `inventory_at` null or older than the interval.
- One cluster at a time. A failure sets `inventory_error` (the message) and `inventory_at = now`, so a broken cluster is not retried every poll, and the previous inventory is kept.

- [ ] **Tests:**
  - A due cluster is collected and stored.
  - A fresh cluster is skipped.
  - A disabled cluster is skipped.
  - A failing collect records the error and keeps the old rows.
  - No lease means no work.
  - `stop()` releases the lease.

### Task 5: API

**Files:**
- Create: `src/api/fleet.ts` and `src/api/fleet.test.ts`.
- Modify: `src/app.ts`, `src/api/common.ts` (`visibleTenants(db, authz, p): Promise<"all" | string[]>`, shared with `GET /tenants`) and the README API table.

**Interfaces:**
- `GET /api/v1/instances?q&cluster&tenant&status&type&limit(≤500, default 100)&offset` returns `{ items: InstanceView[], total }`.
  - `InstanceView` = row fields plus `clusterId`, `clusterName`, `tenantId | null` and `tenantSlug | null` (left join on placements and tenants), with `inventoryAt` from the cluster.
  - Order: cluster name, project, name.
  - Platform viewers see everything. Everyone else sees only rows whose (cluster, project) is a placement of a visible tenant. An empty visible set gives an empty result.
  - `q`: each whitespace-separated term is matched with `search LIKE %term%`, escaped.
- `GET /api/v1/instances/:id` returns an `InstanceView`, or 404 when the instance is not visible.
- `GET /api/v1/instances/:id/metrics?hours=1..168 (default 24)` returns `{ samples: [{ at, cpuCores, memoryUsed, netRxBps, netTxBps }] }`, with the same visibility.
- `GET /api/v1/clusters/:id/inventory` returns `{ inventoryAt, inventoryError, members, pools, networks, instances: { total, running } }`, for platform viewers only (403 otherwise).
- `GET /api/v1/clusters/:id/metrics?hours` returns `{ members: { [name]: samples[] } }`, for platform viewers only.
- `GET /api/v1/fleet/summary` returns `{ instances: { total, byStatus }, clusters?: [{ id, name, status, inventoryAt, inventoryError, instances, running, cpuThreads, memoryTotal, memoryUsed, storageTotal, storageUsed }] }`.
  - `clusters` is present for platform viewers only.
  - Instance counts follow visibility.

- [ ] **Tests:**
  - Visibility: a platform viewer sees all. A tenant member sees only their placement's project, and is refused another tenant's instance by id with 404. A service account sees only its tenant's instances.
  - Search: several words match across fields; `%` matches literally.
  - Filters: cluster, tenant, status, type; limit and offset, with the total.
  - Metrics come back ordered by time, within the window.
  - Inventory and summary are refused for non-platform callers.

### Task 6: UI — instances list (Haiku)

**Files:**
- Create: `web/src/pages/instances/{InstanceList.tsx, instances.spec.tsx}` and `web/src/lib/format.ts` (`bytes(n)` and `rate(n)`, moved from GatewayLog's `formatBytes`).
- Modify: `api/types.ts` (`Instance`, `InstanceList`, `MetricSample`, `ClusterInventory`, `FleetSummary`).

**Behaviour:**
- Search box (`q`, debounced URL param, same as the logs pages).
- Filters: cluster (platform viewers), tenant (when there is more than one), status and type.
- Table: Name (link to `/instances/:id`), Cluster, Project (with the tenant slug), Status (badge), Type, Location, IPv4 (first one), CPU (cores, 2 decimals), Memory (used / limit).
- "Load more" paging, and an empty state.
- A "Last synced" note gives the oldest `inventoryAt` among the shown clusters.

- [ ] **Tests:**
  - Rows render.
  - Search updates the URL and the query.
  - Filters reach the API.
  - The cluster filter is hidden for tenant members.
  - "Load more" requests `offset`.

### Task 7: UI — instance page and charts

**Files:**
- Create: `web/src/components/Sparkline.tsx`, `web/src/pages/instances/InstanceDetail.tsx` and tests.

**Behaviour:**
- `Sparkline({ points: Array<{ at, value | null }>, format, label })`:
  - An inline SVG with a path that has gaps at nulls.
  - Shows the latest value and the max.
  - Has `role="img"` and an `aria-label` that includes the latest value.
- Instance page:
  - Key-values: cluster, project/tenant, status, location, type, image, limits, addresses, created, last synced.
  - Links: "Open in console" goes to `/clusters/<cluster>/ui/project/<project>/instance/<name>`.
  - Charts (24 h): CPU cores, memory, network in and out. The data refreshes every 60 s.

- [ ] **Tests:**
  - The sparkline path skips nulls, and its label shows the latest value.
  - The detail page renders the fields and the console link.
  - A 404 shows "Not found".

### Task 8: UI — cluster capacity and fleet dashboard

**Files:**
- Modify: `ClusterDetail.tsx` (a "Members and storage" section from `/inventory`, for platform viewers), `Dashboard.tsx` (fleet summary), `Shell.tsx` (an "Instances" nav item for everyone) and `App.tsx`.
- Create: `components/Meter.tsx` (a used/total bar with a label).

**Behaviour:**
- Cluster page:
  - Members table: name, status, roles, CPU threads, memory meter, load.
  - Pools table: member, pool, driver, space meter.
  - "Inventory: synced x ago", or the error in a caution notification.
- Dashboard:
  - Instance counts by status, for everyone (visible ones).
  - For platform viewers, a capacity table per cluster: instances running/total, CPU threads, memory meter, storage meter, last synced.

- [ ] **Tests:**
  - Members and pools render for platform viewers. Tenant members get no section and no request.
  - The dashboard shows counts. The capacity table is shown to platform viewers only.
  - The nav shows Instances for a tenant member.

### Task 9: Live check

**Files:**
- Create: `incuscloud/server/scripts/fleet-e2e.ts`.
- Modify: the `web/e2e/ui-e2e.cjs` member section (the member sees their instance in `/instances`) and README "Fleet".

**Live flow:**
1. Create a tenant and a member, place the tenant on cluster-b and wait until it is ready.
2. The member launches a small container through the gateway (the CLI, as in tenant-e2e).
3. Wait for the inventory to show it with an address.
4. The member searches by IP and finds it; the admin finds it too; a second tenant's member does not.
5. After two passes, the instance has a CPU sample.
6. Clean up.

Then run the UI e2e and take screenshots of the instances list, the instance page, the cluster capacity section and the dashboard.

- [ ] `bun scripts/fleet-e2e.ts` prints `FLEET E2E OK`; `ui-e2e.cjs` prints `UI E2E OK`; then clean up.
