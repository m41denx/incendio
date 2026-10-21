# IncusCloud P7 — Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Back up instances to S3 targets, on demand or on a schedule with retention.
- Restore a backup to any cluster the caller may use, under any free name.

**Architecture:**
- **Targets.** `backup_targets` are S3 endpoints (endpoint URL, region, bucket, key prefix, access key, secret key sealed with `IC_SECRET_KEY`). Platform operators manage them. Everyone who may back up an instance may choose any enabled target. Secrets never leave the server.
- **Blob store.** `backups/store.ts` defines `BlobStore`. Two implementations:
  - `s3Store(target)` on `Bun.S3Client`, path-style, streaming multipart upload.
  - `memoryStore()` for tests.
- **Backup job (`backup`).** The cluster makes an Incus backup (`POST /1.0/instances/<n>/backups`). Its tarball reaches the store in one of two ways:
  - **direct**: Incus uploads it itself (API extension `backup_s3_upload`; the cluster must reach the endpoint).
  - **relay**: the control plane streams `GET …/backups/<b>/export` into the store.
  - **auto** tries direct when the cluster has the extension and falls back to relay. This is the same pattern as P6's transports.

  The cluster-side backup is always deleted afterwards. It is also created with a one-day `expires_at` so Incus removes it if we die.
- **Restore job (`restore`).** Checks the target (project, free name, pool), then streams the object from the store into `POST /1.0/instances` (`Content-Type: application/octet-stream`, `X-Incus-name`, `X-Incus-pool`). The restored instance is tagged `user.incuscloud.restored-from=<backupId>` and optionally started.
- **Policies.** `backup_policies` hold one instance, a target, `intervalS`, `keep` (count) and `enabled`. The job runner's `beforeTick` queues due runs, like replication. After a successful run, the policy's oldest ready backups beyond `keep` are deleted (object first, then row). Manual backups are never pruned by a policy.
- **Restricted projects.** Incus blocks backups in restricted projects (`restricted.backups` defaults to `block`). Tenant projects get `restricted.backups=allow` from the reconciler (also applied to existing projects).

**Tech Stack:** as P6. Bun's built-in `S3Client` (no new dependency). MinIO (Alpine package) in a dev container `ic-s3` for live tests.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (§1 Backups, §3.2 `backup_policies`, `backup_targets`, `backups`, §5 jobs, D6 admin certificates, P7 row).

## Global Constraints

- **Admin client only.** All cluster calls use the control plane's admin client (D6), never the gateway.
- **Tenant scope.**
  - Tenant members see their tenants' backups and policies.
  - Tenant owners and admins back up, restore (to the tenant's ready placements only, its project), manage policies and delete backups.
  - Platform operators do everything anywhere, including choosing the target project and pool for a restore.
  - Platform admins manage targets. Everyone signed in may list targets (id and name only).
- **Never overwrite.** A restore never replaces an existing instance (pre-flight problem).
- **Secrets.** The S3 secret key is sealed at rest. It is never returned and never logged. It is sent only to the S3 endpoint, and to the cluster for direct uploads.
- **Audit.** Target changes, backup start, restore start, backup delete and policy changes are audited.
- **Jobs.** Backups and restores are P6 jobs: cancellable, `instanceKey` on the source instance for backups, so a backup never overlaps a migration of the same instance.

## Review Focus

- **Cancel mid-stream.** Cancelling a relay backup aborts both streams, deletes the partial object and the cluster-side backup, and ends the job as cancelled. Cancelling a restore deletes nothing in the store, and Incus removes the half-imported instance.
- **Retention correctness.** Only the policy's own ready backups are pruned, oldest first. A failed run prunes nothing. Manual backups and other policies' backups are untouched.
- **Object deleted outside IncusCloud.** A restore of a backup whose object is gone fails with a clear "not found in the target" message. Deleting such a backup still removes the row.
- **Target unreachable from the cluster.** With auto transport, a direct upload failure falls back to relay, and the result says which transport was used.
- **Large backups.** Nothing buffers a whole backup in memory: export → store and store → import are streams with backpressure.

---

### Task 1: Schema and restricted.backups

**Files:**
- Modify: `incuscloud/server/src/db/schema.ts`, `src/reconcile/projects.ts` (+ test).
- Create: `drizzle/0008_backups.sql`.

**Interfaces:**
- Produces `backupTargets`:
  - id, name (unique), endpoint, region (default `""`), bucket, prefix (default `""`), accessKeyId, secretKeyEnc;
  - enabled (default true), createdAt.
- Produces `backupPolicies`:
  - id, tenantId (cascade), clusterId, project, instanceName, targetId (restrict);
  - intervalS (default 86400, check 3600..2592000), keep (default 7, check 1..365), instanceOnly (default false), enabled;
  - lastRunAt, lastSuccessAt, lastError, lastJobId, createdBy, createdAt;
  - unique (clusterId, project, instanceName, targetId).
- Produces `backups`:
  - id, tenantId (set null), policyId (set null), targetId (restrict), objectKey;
  - clusterId, project, instanceName, instanceType;
  - instanceOnly, sizeBytes (bigint, nullable), state (`creating|ready|failed`), error;
  - jobId, transport, createdBy, createdAt, completedAt.

- [ ] Reconciler test first: `projectConfigFor` includes `restricted.backups: "allow"`, and an existing project missing it gets updated. Then implement (add the key to `UPDATABLE`).
- [ ] Generate the migration; the server suite passes.

### Task 2: Blob store and targets

**Files:**
- Create: `src/backups/store.ts`, `src/backups/store.test.ts`.

**Interfaces:**
- `BlobStore`:
  - `put(key, body: ReadableStream<Uint8Array>, signal?) → {size}`
  - `get(key) → ReadableStream<Uint8Array>` (throws `ApiError(404)` when missing)
  - `delete(key)` (missing is fine)
  - `stat(key) → {size} | undefined`
  - `check() → void` (writes, reads and deletes a small probe object)
- `memoryStore()`.
- `s3Store({endpoint, region, bucket, prefix, accessKeyId, secretKey})`.
- `storeFor(row, secretKey)` opens the sealed secret.
- `objectKey({project, instanceName, at, id})` gives `<project>/<instance>/<iso-compact>-<id8>.tar.gz` under the target prefix.

- [ ] Tests on `memoryStore`: put/get round trip of a multi-chunk stream, stat, delete, a missing get is a 404, and a put aborted by its signal leaves nothing. `objectKey` is tested.
- [ ] `s3Store` streams with `S3Client.file(key).writer()`, awaiting each write for backpressure. It is verified live in Task 8 (no fake S3 in unit tests).

### Task 3: Admin client streams

**Files:**
- Modify: `src/incus/admin-client.ts`, its test, and FakeIncus.

**Interfaces:**
- `download(path, {project, signal}) → ReadableStream<Uint8Array>`: a non-2xx response is a `ClusterError` with the Incus message.
- `upload(path, body: ReadableStream<Uint8Array>, {project, headers, signal}) → IncusResponse`: the Incus envelope, as with `request`.

- [ ] Tests against FakeIncus first:
  - download of a body larger than one chunk;
  - an error JSON on download;
  - an upload body arriving intact, with its headers;
  - abort by signal on both.

### Task 4: Backup job, retention, scheduler

**Files:**
- Create: `src/backups/backup-job.ts`, `src/backups/backup-job.test.ts`.

**Interfaces:**
- `backupHandler(deps?: {storeFor?})`. Payload: `{clusterId, project, instanceName, targetId, instanceOnly, transport, policyId?}`. Result: `{backupId, transport, sizeBytes}`.
- `scheduleBackups(db)`.
- `pruneBackups(db, policyId, keep, storeFor)`.

- [ ] Tests with `stubCluster` (extended for backups and export) and `memoryStore`:
  - **relay** stores the export, the row becomes `ready` with its size, and the cluster backup is deleted;
  - **direct** sends `target` with the bucket, path and keys, and the size comes from `stat`;
  - **auto** without the extension goes relay; with it, a failed direct upload falls back to relay;
  - a cluster error leaves the row `failed`, no object, the cluster backup deleted, and `lastError` set;
  - cancel mid-export: no object, the row is failed with "cancelled";
  - retention keeps the newest `keep` ready backups of the policy, and leaves manual and failed backups alone;
  - the scheduler queues due policies and skips a busy instance.

### Task 5: Restore job

**Files:**
- Create: `src/backups/restore-job.ts`, `src/backups/restore-job.test.ts`.

**Interfaces:**
- `restoreHandler(deps?)`. Payload: `{backupId, targetClusterId, targetProject, targetName, pool?, start}`. Result: `{targetClusterId, targetProject, targetName}`.

- [ ] Tests:
  - the stream reaches `upload` with `X-Incus-name` and the pool;
  - the restored instance is tagged `restored-from`;
  - start when asked;
  - a name clash is refused before any upload;
  - a missing object fails with "The backup is not in its target any more";
  - a restore into a missing project fails clearly.

### Task 6: API

**Files:**
- Create: `src/api/backups.ts`, `src/api/backups.test.ts`.
- Modify: `app.ts`, `jobs/handlers.ts`, `main.ts`.

Routes (all under `/api/v1`):
- `GET/POST backup-targets`, `PATCH/DELETE backup-targets/:id` and `POST backup-targets/:id/check`.
  - Platform admin for writes. A delete is 409 while any backup or policy uses the target.
  - GET returns `{id, name, endpoint, bucket, prefix, region, enabled}` to operators and `{id, name}` to everyone else.
- `POST instances/:id/backups` `{targetId, instanceOnly?}` → 202 job (`backup.create`).
- `GET backups?instance&tenant&policy` and `GET backups/:id`.
- `DELETE backups/:id`: deletes the object, then the row (`backup.delete`); 409 while it is `creating`.
- `POST backups/:id/restore` `{targetClusterId, targetName?, targetProject?, pool?, start?}` → 202 job (`backup.restore`). The target is resolved as in migration (`resolveTarget`); a tenant restore goes to the tenant's own project.
- `GET/POST backup-policies`, `GET/PATCH/DELETE backup-policies/:id` and `POST backup-policies/:id/run` (`backup_policy.*`).

- [ ] The authorisation matrix is tested per route group (member reads, admin acts, an outsider gets 404, an operator can do anything). Then register `backup`/`restore` and chain `scheduleBackups` into `beforeTick`.

### Task 7: UI

- Mine:
  - types, nav ("Backups"), routes;
  - instance page: *Back up now…* (target select, instance-only checkbox → job page) and *Backup schedule…* (create a policy);
  - the Restore modal (cluster, name, start; operators also project/pool).
- Haiku:
  - **Backups** page: a list with filters, a Restore button opening my modal, Delete, and size/age/state; plus a Policies tab with run/pause/delete.
  - **Backup targets** page: operators list them, admins create/edit/check/delete them; the secret is write-only.

### Task 8: Live and docs

- [ ] Dev S3: container `ic-s3` (Alpine, `apk add minio`), HTTP on the incusbr0 address, bucket `incuscloud`. Credentials go in `.dev/s3.env` (git-ignored, never printed).
- [ ] `scripts/backups-e2e.ts`. On cluster-b it launches an instance and writes a marker, then:
  1. backs up by relay and directly;
  2. runs a policy with keep=2 three times, leaving 2 backups;
  3. restores to cluster-c under a new name, and the marker is there;
  4. restores a backup whose object was removed by hand, which fails clearly;
  5. deletes the backups, which removes the objects;
  6. cleans up.

  It prints `BACKUPS E2E OK`.
- [ ] A browser pass with screenshots, and README "Backups" plus API table rows.
