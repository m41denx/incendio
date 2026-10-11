# IncusCloud P3 — Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every enrolled cluster converges, without manual steps, to: OIDC trusting the platform's Hydra, authorization through its own OpenFGA store, one restricted project per placed tenant (limits from quotas, a usable default profile), and grant tuples that mirror IncusCloud's roles. After P3, a token used directly against a cluster is exactly as limited as through the gateway (D1).

**Architecture:** A worker loop (leader-elected through a lease row) reconciles each cluster: health → store → cluster config → projects → grants, recording status per cluster and per placement. The API asks for a reconcile after every change that affects a cluster; a periodic pass catches drift. Grants are computed by a pure function from database facts and diffed against the cluster store, touching only tuples IncusCloud owns.

**Tech Stack:** as P1/P2; `@openfga/sdk` for per-cluster stores.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (D1, D3, D4, D5, D8, §5 reconciler), Incus model `~/refs/incus/internal/server/auth/driver_openfga_model.openfga`.

## Facts this plan relies on (checked in Incus source, 2026-10-11)

- Incus names OIDC users `user:<username>`; with `oidc.claim=sub` that is the IncusCloud user id, or `sa-<uuid>` for service accounts (D3).
- Grantable relations: `server:incus` and `project:<name>` have `admin`, `operator`, `user`, `viewer`, each `[user, group#member]`; `group:<name>` has `member: [user]`.
- On first connect to an empty store Incus uploads its model and writes `user:* authenticated server:incus`; it then syncs resource tuples (`server:incus server project:<p>` …) itself, hourly and on changes.
- Keys: `authorization.openfga.api.url|api.token|store.id`, `authorization.client.{oidc,tls,tls-restricted,unix,default}` ∈ allow|deny|openfga|scriptlet (`tls-restricted` also `tls`).

## Global Constraints

- The reconciler never deletes an Incus resource it did not create; resources it creates carry `user.incuscloud.*` keys (§5). Unplacing a tenant revokes its grants but does not delete its project (it may hold instances).
- Grant tuples IncusCloud owns: users/subjects of the form `group:incuscloud-…#member`, and objects of the form `group:incuscloud-…`. Every other tuple in a cluster store (Incus's own, manual grants) is left alone.
- The control plane's TLS identity keeps full access: `authorization.client.tls=allow` (unrestricted certificates are admins in Incus's model anyway); `authorization.client.oidc=openfga`.
- Role mapping (D5): tenant owner/admin → project `admin`; member → `operator`; viewer → `viewer`. Platform admin/operator/viewer → `server:incus` admin/operator/viewer.
- Quotas: `instances` and `cpu` are counts, `memory` and `disk` are GiB; each placement gets the tenant's full quota as project `limits.*` until P9 splits quotas across clusters.
- Code is GPL-3.0.

## Review Focus

- A tenant member's token used **directly** against the cluster (not through the gateway): sees only the tenant project, cannot touch `default`.
- Removing a member, unplacing a tenant, disabling a user or deleting a service account: the cluster grant disappears on the next reconcile (and a reconcile is requested immediately).
- An admin's manual grant written into a cluster store (e.g. via Incendio's Permissions page) survives every reconcile.
- OpenFGA restarted empty or a store deleted: the next pass recreates the store and re-points the cluster; Incus re-uploads its model; grants come back.
- Two workers running: only the lease holder reconciles; a dead holder's lease expires and another takes over.

---

### Task 1: Cluster stores and the grant model

**Files:** Create `incuscloud/server/src/reconcile/grants.ts`, `reconcile/cluster-store.ts`, `reconcile/fake-cluster-store.ts`; Test `reconcile/grants.test.ts`, `reconcile/cluster-store.it.test.ts`

**Interfaces:**
- `groupName(kind: "tenant", tenantId, role) | ("platform", role)` → `incuscloud-tenant-<id>-<role>` / `incuscloud-platform-<role>`.
- `desiredGrants(facts: { placements: Array<{ tenantId: string; project: string }>; members: Array<{ tenantId; subject; role }>; platform: Array<{ subject; role }> }): Tuple[]` — group→object tuples for each placed tenant role and platform role, plus `user:<subject> member group:<…>` for members of placed tenants and platform subjects.
- `isManaged(t: Tuple): boolean`; `diffTuples(desired, current): { writes; deletes }` (deletes only managed).
- `interface ClusterStore { readonly storeId: string; hasModel(): Promise<boolean>; readManaged(): Promise<Tuple[]>; write(writes, deletes): Promise<void> }`; `openClusterStore(cfg: { url; token?; storeId?: string | null; name: string }): Promise<ClusterStore>` (reuses `storeId` if it exists, else finds by name, else creates).

- [ ] Step 1 tests: desired grants for two tenants, one placed (only placed tenant's tuples), platform roles, service-account subjects `sa-…`; isManaged true for our groups and false for `user:alice admin project:x`, `server:incus server project:x`, `user:* authenticated server:incus`; diff writes missing, deletes only managed extras; live: open by name twice → same id; missing id → new store; write/read managed; a foreign tuple survives `readManaged`/diff.
- [ ] Steps 2–5.

### Task 2: Incus cluster configuration and tenant projects

**Files:** Create `reconcile/incus-config.ts`, `reconcile/projects.ts`; Modify `clusters/fake-incus.ts` (in-memory `/1.0` config with PATCH, `/1.0/projects` CRUD, `/1.0/profiles` get/put per project, `/1.0/storage-pools`, `/1.0/networks`); Test `reconcile/incus-config.test.ts`, `reconcile/projects.test.ts`

**Interfaces:**
- `ensureServerConfig(client: IncusAdminClient, want: Record<string, string>): Promise<string[]>` — PATCH only keys whose value differs; returns changed keys; never logs values (tokens).
- `clusterConfigFor({ issuer, audience, clientId, openfgaUrl, openfgaToken, storeId }): Record<string,string>` — `oidc.issuer|client.id|audience|claim=sub`, `authorization.openfga.api.url|api.token|store.id`, `authorization.client.oidc=openfga`, `authorization.client.tls=allow`.
- `projectConfigFor(tenant: { id; quotas }): Record<string,string>` — `restricted=true`, `features.images|profiles|storage.volumes|storage.buckets=true`, `features.networks=false`, `user.incuscloud.tenant=<id>`, `limits.instances|cpu|memory(GiB)|disk(GiB)` when set.
- `ensureProject(client, name, tenant): Promise<"created" | "updated" | "unchanged">` — creates with full config; existing project: refuses (throws `ApiError(409)`) if it lacks `user.incuscloud.tenant=<id>` (not ours); else PATCHes changed `limits.*`/`restricted*` keys.
- `ensureDefaultProfile(client, project)` — if the project's `default` profile has no root disk / NIC, copies them from the `default` project's default profile, else falls back to the first storage pool / first managed bridge.

- [ ] Step 1 tests (fake): config PATCHed once then unchanged; token value never in returned list/logs; project created with exact config; limits update on quota change; a foreign project with the same name → 409, untouched; default profile filled from default project; fallback to first pool/bridge when the default project's profile is empty.
- [ ] Steps 2–5.

### Task 3: Reconcile one cluster

**Files:** Create `reconcile/cluster.ts`; Modify `db/schema.ts` (`clusters.reconciledAt`), migration; Test `reconcile/cluster.test.ts`

**Interfaces:**
- `reconcileCluster(deps: { db; secretKey; stores: (cfg) => Promise<ClusterStore>; issuer; openfga: { url (as clusters reach it); token; }; }, clusterId): Promise<{ status: "ready" | "degraded" | "error"; message: string }>` — order: `GET /1.0` (status, lastSeenAt; `error` if unreachable) → store (persist `fgaStoreId`) → server config → for each placement: project + default profile (placement status `ready`/`error` + message) → grants (skipped with message "waiting for Incus to upload its model" until `hasModel()`) → `clusters.status`, `statusMessage`, `reconciledAt`. A failing placement makes the cluster `degraded`, not `error`.
- Facts for grants: placements of this cluster; tenant members (users) + tenant service accounts (subject `clientId`, role `member`); platform roles of users and service accounts; disabled users excluded.

- [ ] Step 1 tests (fake Incus + fake store): first pass configures, creates projects, writes grants; second pass changes nothing; removed member → its tuple deleted; disabled user excluded; unplaced tenant → its grants removed, project kept; foreign project name → placement error, cluster degraded, others still reconciled; unreachable cluster → `error` with message, nothing else attempted; store id persisted and reused.
- [ ] Steps 2–5.

### Task 4: Worker loop, lease, triggers

**Files:** Create `reconcile/worker.ts`, `reconcile/lease.ts`, `reconcile/triggers.ts`; Modify `db/schema.ts` (`leases(name pk, holder, expiresAt)`), migration; Modify API modules (tenants members/delete, clusters place/unplace/enrol, users disable/delete/role, service accounts create/delete) to call `triggers.request(clusterIds | "all")`; add `POST /api/v1/clusters/:id/reconcile` (platform operator) and expose `reconciledAt` in cluster views; Test `reconcile/lease.test.ts`, `reconcile/worker.test.ts`, API tests extended

**Interfaces:**
- `acquireLease(db, name, holder, ttlMs): Promise<boolean>` (atomic upsert where expired or same holder); `releaseLease`.
- `class Triggers { request(ids: string[] | "all"): void; next(): Promise<Set<string> | "all"> }` (coalescing).
- `class Worker { constructor(deps, { holder, intervalMs = 60_000, leaseMs = 30_000 }); start(); stop() }` — while leader: on trigger or interval, reconcile the requested clusters (all on interval), one at a time per cluster, errors logged and recorded.

- [ ] Step 1 tests: lease exclusive between two holders, renewable by holder, taken over after expiry; triggers coalesce; worker reconciles on trigger and on interval; non-leader does nothing; API mutations trigger the affected clusters (member change → clusters where the tenant is placed).
- [ ] Steps 2–5.

### Task 5: Configuration and roles

**Files:** Modify `config.ts` (`IC_ROLE` = api|worker|all (default all), `IC_OPENFGA_CLUSTER_URL` (default `IC_OPENFGA_URL`), `IC_OPENFGA_CLUSTER_TOKEN` (default `IC_OPENFGA_TOKEN`)), `main.ts` (start the worker for worker/all; serve HTTP for api/all); `scripts/dev-openfga.sh` (sqlite datastore in `.dev/openfga.db`, listen on `IC_DEV_HOST`), `scripts/dev.sh`, `scripts/dev-cluster-oidc.sh` (CA only; the reconciler sets `oidc.*`); README

- [ ] Steps 1–5 (tests: config parsing of the new keys).

### Task 6: Live end to end

**Files:** Create `incuscloud/server/scripts/tenant-e2e.ts`

- [ ] Step 1: against `scripts/dev.sh` + cluster-b: create tenant `acme`, a member user, place `acme` on cluster-b, wait for `ready`; as the member through the gateway with the stock CLI: `incus project list` shows only `acme`; `incus launch … --project acme` works; `--project default` is refused; the same member token **directly** against cluster-b (bypassing the gateway) gets the same answers; remove the membership → the member loses `acme` after the reconcile; platform admin still sees everything. Expected: all assertions pass.
- [ ] Step 2: commit; README "Tenants on clusters".
