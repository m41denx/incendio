# IncusCloud P9 — Tenant Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A tenant's quota holds across all its clusters, not once per cluster as today.
- Tenants see their usage.
- Tenant members create instances themselves, on a cluster IncusCloud picks, within quota.

**Architecture:**
- **Usage.** Usage comes from Incus's own accounting. The reconciler reads `GET /1.0/projects/<p>/state` for each placement. That gives `instances`, `cpu`, `memory`, `disk`: what instances are given, as Incus counts it for `limits.*`. It stores the result in `placements.usage`, and the limits it applied in `placements.limits` (migration 0010).
- **Elastic split** (`tenants/quota.ts`, pure). For each quota key, the global free headroom is `F = quota − Σ usage`, over all of the tenant's placements. Each placement gets `limit = usage + max(F, 0)`. So any one cluster may take all of the free headroom, and none can grow when the tenant is at or over quota. Limits are never below usage, which Incus would refuse.
  - The reconciler applies these instead of the full quota.
  - Changes that bypass IncusCloud (the Incus API through the gateway) can overshoot between passes, by at most the free headroom of that moment. Self-service creates are exact, because they are checked and serialised per tenant.
- **Placement** (`tenants/placement.ts`, pure). Candidates are the tenant's ready placements on ready clusters whose labels match the request's selector (`labels: {region: "eu"}`). If the request names a cluster, it must be one of them. The chosen cluster is the one with the most free memory, as a fraction, after the request, among clusters where it fits. Members' memory is summed over online members from the inventory.
- **Self-service create.** `POST /api/v1/tenants/:id/instances` takes:
  - `{name, image, type, cpu, memoryGiB, diskGiB, clusterId?, labels?, start}`;
  - open to tenant members and up.

  Inside a transaction holding a per-tenant advisory lock, it:
  1. adds up usage, the requests of queued or running `create` jobs, and this request;
  2. refuses with 409 if any quota would be exceeded, naming which and by how much;
  3. otherwise places the instance and enqueues a `create` job.

  The `create` job:
  1. checks the name is free;
  2. creates from the image server (`IC_IMAGE_SERVER`, default `https://images.linuxcontainers.org`, simplestreams), with `limits.cpu`, `limits.memory` and a root disk of the requested size on the default profile's pool;
  3. optionally starts it;
  4. asks for a reconcile of all the tenant's clusters (so the split follows) and refreshes the inventory.

  `GET /api/v1/images` returns a short curated list of aliases.
- **Usage API.** `GET /api/v1/tenants/:id/usage` returns `{quota, used, clusters: [{clusterId, name, project, usage, limits}]}`. It is visible to the tenant's viewers and to platform viewers.

**Tech Stack:** as P8. Live tests use cluster-b and cluster-c.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (§1 Tenant cloud, D5 "limits.* from the tenant's quota share", P9 row).

## Global Constraints

- **Quotas are platform-admin settings** (as today). Tenants read their usage; they never set limits.
- **Never set a project limit below its usage.** If the tenant is over quota, limit = usage: nothing new anywhere.
- **Creating instances is for tenant members and up.** Viewers can only read. Platform operators may create for any tenant.
- **The name must be free in the chosen project.** It is checked in the job, not only in the API.
- **Audit:** quota changes (existing) and creates.

## Review Focus

- **Two concurrent creates that each fit, but not together.** One is refused (advisory lock plus pending jobs).
- **Quota lowered below usage.** Limits equal usage, the reconcile succeeds, and nothing breaks.
- **A placement whose cluster is unreachable.** Its last known usage still counts. It is never chosen.
- **Unit mismatch.** Quota memory and disk are in GiB, usage is in bytes, and limits are written as bytes. This needs to be verified live.
- **A tenant with no quota.** No limits are written (as today), and placement still works.

---

### Task 1: Usage and the elastic split

- [ ] `tenants/quota.ts`: `splitLimits(quota, usages)`, `sumUsage`, `exceeds(quota, used, request)`, with tests:
  - an empty quota;
  - free headroom shared;
  - over quota;
  - several keys at once.
- [ ] Reconciler:
  - read each placement's project state;
  - store `usage`;
  - apply split `limits.*` (bytes for memory and disk);
  - unset keys whose quota is gone.

  Reconcile tests with the stub.
- [ ] Migration 0010 (`placements.usage`, `placements.limits`).

### Task 2: Usage API and placement

- [ ] `GET /api/v1/tenants/:id/usage`, with visibility tests.
- [ ] `tenants/placement.ts` `choose()`, with tests:
  - the label selector;
  - an explicit cluster;
  - not ready, or not fitting;
  - most free memory wins;
  - deterministic ties.

### Task 3: Self-service create

- [ ] `POST /api/v1/tenants/:id/instances`: role checks, quota with pending jobs (the concurrency test), placement errors, audit.
- [ ] The `create` job handler with the stub: body shape (image source, limits, root size on the profile's pool), name clash, start, reconcile request.
- [ ] `GET /api/v1/images`.

### Task 4: UI

- Haiku: the tenant page's Quota panel (bars per resource, per-cluster table).
- Haiku: the Create instance page.
- Mine: types, routes, the "Create instance" entry on the Instances page, the job summary.

### Task 5: Live and docs

- [ ] `scripts/tenant-cloud-e2e.ts` on clusters b and c, with a tenant with a quota:
  1. the split is visible on both projects;
  2. a create on automatic placement;
  3. the other project's limits shrink;
  4. over quota is refused by the API;
  5. a direct Incus create beyond the split is refused by Incus;
  6. lowering the quota below usage.
- [ ] Browser pass, then README.
