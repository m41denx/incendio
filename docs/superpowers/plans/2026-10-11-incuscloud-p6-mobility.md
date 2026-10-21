# IncusCloud P6 — Mobility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Move or copy an instance between clusters, after pre-flight checks.
- Keep scheduled replicas of instances on another cluster.
- Fail over to a replica when its source is lost.

All of this runs as jobs that survive a worker restart and can be watched and cancelled.

**Architecture:**
- **Jobs runner.** A `jobs` table and a runner in the worker hold the lease `jobs` and run up to `IC_JOB_CONCURRENCY` jobs (default 2). Each job has a type handler with progress and cancellation. A job found running under a dead holder is marked failed ("interrupted"), and the user retries. Spec §5 allows "resumed or failed", and resuming a half-done migration safely is not worth it yet.
- **Transport.** `mobility/transfer.ts` is the transport proven in spike C (`incuscloud/spikes/migrate.ts`, written for this project):
  - The source is put into migration mode. The target pulls from it directly.
  - If the target cannot reach the source, the control plane relays the operation websockets message by message, with backpressure.
  - Refresh mode is the replication primitive.
- **Pre-flight.** `mobility/preflight.ts` is a pure function over what both clusters report. It maps the root pool, NICs and profiles, and it reports problems that block a move and warnings that do not.
- **Never overwrite.** Targets IncusCloud creates are tagged `user.incuscloud.replica-of` or `user.incuscloud.migrated-from`. A replica refresh only ever touches an instance carrying its own policy's tag (spec §5: never delete what we did not create).

**Tech Stack:** as P1–P5, plus `ws` 8.21.3 (already a server dependency) for operation websockets.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (§1 Mobility, §3.2 `jobs` and `replication_policies`, §5 jobs and the never-delete rule, D6 admin certificates, P6 row) and `incuscloud/docs/spikes.md` §C.

## Global Constraints

- **Admin client only.** All cluster calls use the control plane's admin client (D6) and never the gateway. Tenant callers are authorised by the platform API before a job exists.
- **Tenant scope.**
  - Tenant owners and admins may migrate and replicate their tenant's instances, only between the tenant's own projects (ready placements) on its clusters.
  - Platform operators may do this for any instance, and choose the target project.
- **Move = copy, verify, delete.** A move first copies, then verifies the target (it exists with the same type), and only then deletes the source. If any step before the delete fails, the target the job created is removed and the source is restarted if the job stopped it.
- **Live where possible.** Live is offered only for running VMs with `migration.stateful=true` on both ends. Containers are stopped for a move and restarted after. A copy of a running container is a stateless copy of the running instance (how Incus behaves is verified live in Task 9). The UI says so.
- **Audit.** Every job start, cancel and failover is audited.

## Review Focus

- **Concurrent work on one instance.** A second migration or a replication run on the same instance while one is running must be refused (409).
- **Cancellation:**
  - During transfer: the Incus operations are cancelled, the partial target is removed and the source is restarted.
  - After the source was deleted: cancellation is no longer possible, and the job finishes.
- **Name clash.** A target instance name already taken on the target project is a pre-flight problem. It is never overwritten, not even by a replication policy whose replica was replaced by a foreign instance.
- **Cluster down mid-job.** Errors from either side end the job as failed, with a message that names the side.
- **Worker restart.** A running job becomes failed ("interrupted"), and a policy's next run is scheduled normally.

---

### Task 1: Jobs table and runner

**Files:**
- Create: `src/jobs/{schema test,runner.ts,runner.test.ts,types.ts}` and migration `0006_jobs.sql`.
- Modify: `src/db/schema.ts`, `src/config.ts` (`IC_JOB_CONCURRENCY` 1..16, default 2), `src/main.ts`.

**Interfaces:**
- **`jobs` table** (id uuid, `type`, `state`):
  - `state` is one of `queued | running | succeeded | failed | cancelled`.
  - Content: `progress jsonb {stage, percent?, message?}`, `payload jsonb`, `result jsonb`, `error text`.
  - Ownership: `tenant_id uuid null` (visibility), `cluster_ids jsonb string[]`, `instance_key text null` (`<clusterId>/<project>/<name>`, for the one-job-per-instance rule), `actor_type`, `actor_id`.
  - Lifecycle: `cancel_requested bool`, `holder text`, `heartbeat_at`, `created_at`, `started_at`, `finished_at`.
  - A unique partial index on `instance_key` where `state in ('queued','running')`.
- **`enqueueJob(db, {type, payload, tenantId, clusterIds, instanceKey, actor})`** returns the row, or throws `ApiError(409, "busy")` on the partial index.
- **`JobContext`** is `{ db, secretKey, job, signal: AbortSignal, progress(p): Promise<void>, clientFor(clusterId): Promise<IncusAdminClient & {row}> }`.
- **`type JobHandler = (ctx) => Promise<Record<string, unknown> | void>`**, with a registry `Record<string, JobHandler>`.
- **`class JobRunner`** with `tick()`, `start()`, `stop()`:
  - On `tick` with the lease, it marks `running` jobs whose holder is not this runner and whose heartbeat is older than 3× the lease as `failed` (error "interrupted: the worker stopped").
  - It starts queued jobs FIFO up to the concurrency. The heartbeat runs every 10 s.
  - `cancel_requested` is polled every 2 s and aborts the signal. A handler that throws on abort ends the job `cancelled`; other errors end it `failed` (message); success ends it `succeeded` (result).

- [ ] **Tests:**
  - A job runs to `succeeded` with its result and progress.
  - A handler error gives `failed`.
  - A cancel request aborts the signal, giving `cancelled`.
  - Concurrency is respected.
  - A second job for the same instance key is refused (409), and is allowed once the first finished.
  - A stale `running` job of another holder becomes `failed` "interrupted".
  - No lease means nothing runs.

### Task 2: Operation websockets on the admin client

**Files:**
- Modify: `src/incus/admin-client.ts` and its test with FakeIncus (websocket echo exists at `/1.0/ws`; add `/1.0/operations/<id>/websocket?secret=` that echoes when the secret matches).

**Interfaces:**
- `client.websocket(path): Promise<WebSocket>` (from `ws`), pinned with the client certificate.
- `client.cancel(op)` sends `DELETE /1.0/operations/<id>` and ignores 404.

- [ ] **Tests:**
  - It opens with the right secret and echoes.
  - The wrong secret is refused.
  - A pin mismatch is refused.

### Task 3: Pre-flight

**Files:**
- Create: `src/mobility/preflight.ts` and `preflight.test.ts`.

**Interfaces:**
```ts
export interface SourceInstance { name: string; type: "container" | "virtual-machine"; status: string; architecture: string; config: Record<string, string>; devices: Record<string, Record<string, string>>; profiles: string[]; expandedDevices: Record<string, Record<string, string>>; stateful: boolean }
export interface TargetFacts { architectures: string[]; pools: string[]; networks: string[]; profiles: string[]; instanceNames: string[]; defaultProfileDevices: Record<string, Record<string, string>>; projectExists: boolean; apiExtensions: string[] }
export interface PreflightInput { source: SourceInstance; target: TargetFacts; targetName: string; mode: "copy" | "move"; live: boolean; pool?: string }
export interface Preflight { ok: boolean; problems: string[]; warnings: string[]; request: { name: string; type: string; architecture: string; config: Record<string, string>; devices: Record<string, Record<string, string>>; profiles: string[] } }
export function preflight(i: PreflightInput): Preflight
```

Checks:
- **Problems:**
  - The target project is missing.
  - The name is taken.
  - The architecture is not among the target members'.
  - The pool is missing (explicit `pool`, else the target default profile's root pool, else the only pool).
  - A source profile is missing on the target.
  - A NIC's network is missing on the target. The target default profile's `eth0` network is used when the source NIC came from the source default profile.
  - `live` is requested for a container, a stopped VM, a VM without `migration.stateful`, or when either side lacks `migration_vm_live`.
- **Warnings:**
  - A running container will be stopped for a move, or copied stateless for a copy.
  - Snapshots are copied too.
  - Unknown device types are copied as-is.
- **The request:**
  - Config without `volatile.*`, except `volatile.base_image`.
  - Devices with the root disk's pool mapped and NICs mapped.
  - The same profiles.

- [ ] **Tests:** one test per problem, the default-profile NIC mapping, the pool choice order, a VM-live happy path and the volatile filter.

### Task 4: Transfer

**Files:**
- Create: `src/mobility/transfer.ts` and `transfer.test.ts`.

**Interfaces:**
- `transfer({ src, dst, srcProject, dstProject, name, request, refresh, live, instanceOnly, transport: "auto" | "pull" | "relay", signal, onProgress })` returns `{ transport: "pull" | "relay" }`.
- **Source side:** `POST /1.0/instances/<name>?project=` with `{migration: true, live, instance_only}`, which returns the operation and its secrets.
- **Pull:** the target gets `POST /1.0/instances?project=` with `{...request, source: {type: "migration", mode: "pull", operation: "<src url>/1.0/operations/<id>", certificate: <src server cert>, secrets, refresh, live, instance_only}}`, then waits.
- **Auto fallback:** if pull fails with a connection error ("Unable to connect", "dial tcp", "no route", "i/o timeout"), the source operation is cancelled and a fresh one is created for relay.
- **Relay:** the target gets `mode: "push"` and returns its secrets. The runner pipes the named websockets (`control` first, then the others) with backpressure (pause above 4 MiB queued), then waits on the target operation.
- **Progress:** every 2 s from the target operation's `metadata` (`fs_progress`, `progress.percent`, `create_instance_from_migration_progress`, …), the first string found.
- **Abort:** both operations are cancelled.
- **Unit tests** cover `pipe()` with two local `ws` servers: framing kept, backpressure pauses, close ends both. The protocol itself is covered by the live check (Task 9).

- [ ] **Tests:**
  - Messages are piped both ways with boundaries intact.
  - A slow receiver pauses the sender (`isPaused` observed).
  - A close on either side closes both.
  - The progress text is picked from the operation metadata shapes.

### Task 5: Migration job and API

**Files:**
- Create: `src/mobility/migrate-job.ts`, `src/mobility/facts.ts` (reads `TargetFacts` and `SourceInstance` with the admin client), `src/api/mobility.ts` and tests.

**Interfaces:**
- `POST /api/v1/instances/:id/migrations/preflight` takes `{ targetClusterId, mode, live?, targetName?, targetProject? (platform operators), pool? }` and returns `Preflight` (without `request`) plus `{ targetProject }`.
- `POST /api/v1/instances/:id/migrations` takes the same body and returns 202 with the job.
  - The pre-flight runs again server-side, and problems give a 409 with the list.
  - The job type is `migrate`, its payload is the input plus the source cluster, project and name, and it is audited `instance.migrate`.
- **Who may:**
  - Platform operators may migrate any instance.
  - Tenant owners and admins may migrate an instance in their tenant's project, to a cluster where the tenant has a ready placement (the target project is that placement's).
  - Everyone else gets 403; an instance they cannot see gets 404.
- **The handler:**
  1. Stops the source if it is a running container and the mode is `move` (it remembers this).
  2. Transfers, tagging the target `user.incuscloud.migrated-from=<cluster>/<project>/<name>`.
  3. Verifies that the target exists with the right type.
  4. For a move: deletes the source.
  5. Starts the target if the source was running (and was not live).
  6. Requests an inventory refresh of both clusters (`inventory_at = null`).
  - On failure or cancel before the delete: it deletes the target only if it carries this job's tag, and restarts the source if the job stopped it.
  - The result is `{ transport, targetClusterId, targetProject, targetName }`.
- **Test:** the handler runs with a fake `transfer` and FakeIncus-like stubs for start, stop and delete, covering move order, rollback on transfer failure, the cancel path and the tag check on rollback.

- [ ] **Tests:**
  - Authorisation matrix: platform operator; tenant admin to a placed cluster; tenant admin to an unplaced cluster (403); a tenant member (403); a stranger (404).
  - Pre-flight problems give 409.
  - A busy instance gives 409.
  - The handler cases above.

### Task 6: Jobs API

**Files:**
- Create: `src/api/jobs.ts` and test.

**Interfaces:**
- `GET /api/v1/jobs?state&type&tenant&limit&before`:
  - Platform viewers see all.
  - Others see the jobs of tenants they belong to, plus their own.
  - Results are newest first.
- `GET /api/v1/jobs/:id` uses the same visibility (404 otherwise).
- `POST /api/v1/jobs/:id/cancel` returns 202 for a queued or running job. It may be called by the job's actor, a tenant owner or admin of its tenant, or a platform operator.
  - A queued job is cancelled at once; a finished one gives 409.
  - It is audited `job.cancel`.

- [ ] **Tests:** visibility; cancelling a queued job; cancelling a running job sets the request; a finished job gives 409; a stranger gets 404.

### Task 7: Replication policies and failover

**Files:**
- Create: `src/mobility/{replicate-job.ts,failover-job.ts,scheduler.ts}`, `src/api/replication.ts`, migration `0007_replication.sql` and tests.

**Interfaces:**
- **`replication_policies` table:**
  - Identity: id, `tenant_id null`, `source_cluster_id`, `source_project`, `instance_name`, `target_cluster_id`, `target_project`, `target_name`.
  - Schedule: `interval_s` (60..604800, default 3600), `enabled`.
  - State: `state` (`active | failed-over`), `last_run_at`, `last_success_at`, `last_error`, `last_job_id`.
  - Audit: `created_by`, `created_at`.
  - Unique (source cluster, project, name, target cluster).
- **Scheduler** (inside the job runner's tick): due policies are those enabled, active, with no queued or running job for the instance key, and `last_run_at` older than the interval. They get a `replicate` job. `last_run_at` is set at enqueue.
- **Replicate handler:**
  - If the target instance is missing, it makes an initial copy (pull or relay, not started, with the tag `user.incuscloud.replica-of=<policy id>`).
  - If it exists with the tag `user.incuscloud.replica-of == policy id`, it refreshes.
  - If it exists without the tag, it fails: "a different instance named X exists on the target; not overwritten".
  - Success sets `last_success_at` and clears `last_error`; a failure sets `last_error`.
- **Failover handler** (`POST /api/v1/replication-policies/:id/failover {stopSource: boolean}`):
  1. Optionally stops the source (best effort, with a warning in the result if unreachable).
  2. Sets the policy to `failed-over` and disabled.
  3. On the target, removes `user.incuscloud.replica-of`, sets `user.incuscloud.promoted-from`, and starts it.
- **API:** `GET/POST /api/v1/replication-policies`, `GET/PATCH(enabled, intervalS)/DELETE /:id`, `POST /:id/run` (enqueue now), `POST /:id/failover`.
  - Authorisation is the same matrix as migration; delete never touches the replica.
  - Every call is audited.

- [ ] **Tests:**
  - The scheduler enqueues a due policy once, and not again while a job is active.
  - The replicate handler copies when the target is missing, refreshes when it is tagged, and refuses when it is untagged.
  - Failover order and state.
  - The API authorisation matrix and validation (target ≠ source cluster).

### Task 8: UI

**Files (web):**
- `pages/instances/MigrateInstance.tsx` (mine): a modal from the instance page with the target cluster (tenant placements, or every other cluster for operators), mode, live (only when allowed), name and pool (operators). "Check" runs the pre-flight and shows problems and warnings; "Start" starts the job and links to it.
- `pages/jobs/{JobList,JobDetail}.tsx` (Haiku): a list with state badges, type, instance, progress text, age and Cancel; a detail page with payload summary, progress, result and error, refreshing every 2 s while it is active.
- `pages/replication/{PolicyList,CreatePolicy}.tsx` (Haiku): a list (instance, source → target, interval, last success, state, last error) with Run now, Enable/Disable, Failover (confirm, with a stop-source checkbox) and Delete. Create comes from the instance page ("Replicate…").
- Types, nav items ("Jobs" for everyone; "Replication" for everyone with a tenant admin role or platform role) and routes (mine).

- [ ] **Tests:** each page's spec in the repo's style (rows, actions reach the API, role-based visibility); the migrate modal shows pre-flight problems and blocks Start, and Start posts and navigates to the job.

### Task 9: Live check

**Files:**
- Create: `incuscloud/server/scripts/mobility-e2e.ts`.
- Modify: README "Mobility" and `.env.example`.

**Setup:** cluster-c, a second nested Incus in `incuscloud-dev`, enrolled and trusting the dev CA (`dev-cluster-oidc.sh`).

**Flow:**
1. Place a tenant on cluster-b and cluster-c, and launch an instance on b with a marker file.
2. Pre-flight to c is ok. Pre-flight with a taken name is a problem.
3. Copy b→c with pull, and check the marker on the copy.
4. Move b→c with a forced relay (`transport: "relay"`, platform operator only). The source is gone, and the target runs with the marker.
5. Create a replication policy c→b (interval 60 s) and run it now. The replica exists, stopped and tagged.
6. Change the marker and run it again; the refresh brings the change.
7. Failover: the replica starts with the new marker, and the policy is `failed-over`.
8. Cancel a running copy; the target is cleaned up.
9. Clean up.

- [ ] `bun scripts/mobility-e2e.ts` prints `MOBILITY E2E OK`. The UI flow (migrate modal → job page) is screenshotted from `ic-browser`.
