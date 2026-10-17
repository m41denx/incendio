# IncusCloud Permissions Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ownership, the *User* role, project and instance paths, and every tenant-scoped API call decided by privilege. Incus enforces the same, including "Users never see other users' instances".

**Architecture:**
- **Owners.** IncusCloud records an owner for each instance it learns of. A create made through IncusCloud is recorded by the job. A create made straight against Incus (gateway, facade, CLI) is recorded from the cluster's lifecycle events, whose `requestor.username` is the IncusCloud subject. Instances nobody claimed are backfilled to the tenant's first owner.
- **Resolution.** It learns ownership: a role's `ownedOnly` privileges hold only on what the subject owns.
- **Incus grants.** The reconciler turns *User* entries into narrow project entitlements, `can_view` on the project's shared objects, and `operator` on owned instances, all through `incuscloud-acl-*` groups.
- **Facade.** It answers the project object from IncusCloud's records when Incus refuses it to a User.

**Tech Stack:** Bun, Elysia, drizzle (Postgres/pglite), OpenFGA (the clusters' stores), React 19 + TanStack Query + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-incuscloud-acl-design.md` (rev 2, decisions 1–5). Phase 1: `docs/superpowers/plans/2026-10-17-incuscloud-acl-phase1.md`; its ledger rulings carry over.

## Global Constraints

- Decision 5 (2026-10-17): a *User* never gets project `viewer`, `user`, `operator` or `admin` in Incus. Each of these cascades to every instance in the project (measured: `instance.viewer = … or viewer from project`; `instance.user = … or user from project`).
- **Incus object ids:**
  - `project:<p>`
  - `instance:<p>/<name>`
  - `profile:<p>/<name>`
  - `network:<p>/<name>`
  - `image:<p>/<fingerprint>`

  Directly assignable:
  - on projects: `can_create_instances`, `can_create_storage_volumes`, `can_create_storage_buckets`, `can_view_events`, `can_view_operations`;
  - on instances: `operator`, `user`, `viewer`;
  - on profiles, networks and images: `can_view`.
- Migrated tenant members stay *Unrestricted user* (decision 2): nothing in this plan narrows today's roles. Subjects without explicit entries keep exactly today's Incus tuples (phase 1 ruling, Task 5).
- Phase 2 opens:
  - the roles `user` and (still not `group-owner`);
  - the paths `/clusters/<c>/projects/<p>`, `/clusters/<c>/projects/<p>/instances/<i>` and `/tenants/<t>/kubernetes/<name>`.
- Owner subjects are `user:<id>` or `service:<id>`. In Incus a service account's name is its `clientId` (`sa-<id>`).
- Never print `.dev` secrets. Live checks pass passwords from files.

## Review Focus

1. **A User creating through the CLI or Incendio** (straight to Incus) gets `operator` on the new instance within seconds, not at the next 30 s pass. The lifecycle handler requests a reconcile of that cluster.
2. **Rename, move within a cluster, and IncusCloud moves between clusters keep the owner.** A copy belongs to whoever copied it. A delete forgets the owner. A same-named instance created later starts unowned.
3. **Events missed while the listener was down.** The backfill gives the instance to the tenant's first owner, never to nobody. A tenant with no owner leaves it unowned, so only tenant admins and above can manage it.
4. **A User's grants hold no project relation.** The store holds only the direct project entitlements, `can_view` on shared objects and per-instance `operator`. The facade still creates in, and lists, that project.
5. **A User's IncusCloud lists** (instances search, backups, jobs, Kubernetes) show only what they own, plus what other entries give them.

---

### Task 1: Owners table and the ownership API in the ACL

**Files:**
- Create: `incuscloud/server/drizzle/0014_owners.sql`, `incuscloud/server/src/acl/owners.ts`, `owners.test.ts`
- Modify:
  - `src/db/schema.ts`: `instanceOwners`, and `tenantMembers.createdAt`;
  - `src/acl/acl.ts`: the snapshot loads owners; `decide` applies `ownedOnly`;
  - `src/acl/catalog.ts`: confirm User's `ownedOnly`;
  - `src/api/kubernetes.ts`: `createdBy` written as `user:<id>`, with existing rows migrated.

**Interfaces:**
- **Table `instance_owners`:**
  - columns: `cluster_id` (FK clusters, cascade), `project`, `name`, `user_id` (FK users, cascade), `service_account_id` (FK service_accounts, cascade), `source` (`'incuscloud' | 'event' | 'backfill'`), `created_at`;
  - primary key (cluster_id, project, name);
  - check: at most one subject column set (both null = unowned after the owner's deletion).
- **`tenant_members.created_at`** (default now; existing rows get the migration's time).
- **`owners.ts`:**
  - `recordOwner(db, {clusterId, project, name}, subject, source)`: an upsert. A `backfill` row is overwritten by anything; an `incuscloud`/`event` row only by `incuscloud`.
  - `renameOwned(db, from, to)`.
  - `forgetOwned(db, key)`.
  - `backfillOwners(db, clusterId): Promise<number>`: inventory instances in placed projects with no row → the tenant's earliest `owner` member (by `created_at`, then user id), source `backfill`.
- **`Acl`:**
  - `decide(subject, path, opts?: { owner?: string })`. For an instance path the owner is looked up from the snapshot. For other objects the caller passes `owner` (a backup's or Kubernetes cluster's `createdBy`). Privileges in a deciding role's `ownedOnly` are dropped unless `owner === subject`.
  - `can(p, priv, path, opts?)`, `privileges(p, path, opts?)`.

- [ ] **Step 1: Failing tests** (`owners.test.ts`, `acl.test.ts`):
  - "a User on /tenants/acme has instance.create on acme's project, and instance.console only on an instance they own";
  - "backfill gives unowned instances to the tenant's first owner; a tenant without owners leaves them unowned";
  - "an event owner is not overwritten by backfill; a job's owner overwrites both";
  - "a deleted owner leaves the instance unowned";
  - "ownedOnly on a backup follows the owner passed in".
- [ ] **Step 2:** Run `./scripts-test.sh src/acl`. Expected: the new tests fail.
- [ ] **Step 3:** Implement, and generate the migration with `bunx drizzle-kit generate` (check the SQL by hand: the check constraint, the backfill of `created_at`, and kubernetes `created_by` → `user:` prefix).
- [ ] **Step 4:** Run the whole server suite. Expected: 0 fail.
- [ ] **Step 5:** Commit `incuscloud acl: instance owners, and ownership in resolution`.

### Task 2: Owners from lifecycle events and from IncusCloud's own creates

**Files:**
- Create: `incuscloud/server/src/acl/lifecycle.ts`, `lifecycle.test.ts`
- Modify:
  - `src/main.ts`: the worker role starts the listener;
  - `src/clusters/fake-incus.ts`: an events websocket that tests can push lifecycle events to;
  - `src/fleet/worker.ts`: `backfillOwners` after each applied snapshot;
  - the job handlers that create or move instances: `src/tenants/create-job.ts` (create), `src/mobility/*` (move re-keys; copy records the actor), `src/backups/*` restore (as a new instance: the actor).

**Interfaces:**
- `startLifecycle(deps: { db; clusterClient; onOwnerChange(clusterId) }, opts)` connects per ready cluster to `GET /1.0/events?type=lifecycle&all-projects=true` with the admin certificate, reconnecting with backoff (1 s → 60 s) and following enrolments and deletions every inventory interval.
- **Handled actions:**
  - `instance-created`: the owner is the requestor if `protocol === "oidc"` and `username` is a user id or a service account's `clientId`. Admin-certificate requestors are IncusCloud's own jobs, which record their own owner.
  - `instance-renamed`: `context.old_name` → the source's name.
  - `instance-deleted`: forget.

  Each calls `onOwnerChange`, which is `requestReconcile(db, [clusterId])`.
- Step 1 below first captures one real event of each action from cluster-b and pins those as fixtures, so field names are measured rather than assumed.

- [ ] **Step 1: Capture fixtures:** on the dev stack, create, rename and delete an instance as `member@incuscloud.dev` through the gateway. Save the three lifecycle events (requestor included) under `src/test/fixtures/lifecycle/`.
- [ ] **Step 2: Failing tests:**
  - "an oidc create records the requestor and requests a reconcile";
  - "a service account's clientId maps to the account";
  - "admin-certificate creates are left to the job";
  - "rename re-keys, delete forgets";
  - "the listener reconnects after the cluster drops it";
  - "the self-service create job records its actor";
  - "a move keeps the owner, a copy belongs to the actor".
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the whole server suite. Expected: 0 fail.
- [ ] **Step 5:** Commit `incuscloud acl: owners from lifecycle events and IncusCloud's jobs`.

### Task 3: Project, instance and Kubernetes paths; the User role in the API

**Files:**
- Modify: `src/api/acl.ts` and its test; `src/acl/acl.ts` (`sees` counts instance and project entries; the tenant alias for Kubernetes paths already exists via `chain`).

**Interfaces:**
- `POST acl/entries` also accepts:
  - `/clusters/<c>/projects/<p>`, where the project is a placement or appears in the cluster's inventory;
  - `/clusters/<c>/projects/<p>/instances/<i>`, in inventory;
  - `/tenants/<t>/kubernetes/<name>`, an existing Kubernetes cluster;
  - the role `user`.
- `group-owner` and group paths stay refused (phase 3).
- Affected clusters for reconcile: project and instance paths → their cluster; Kubernetes paths → the Kubernetes cluster's cluster.
- Cascades: deleting a Kubernetes cluster deletes the entries under its path. An instance's entries are deleted on its `instance-deleted` event (Task 2), and stale ones are swept by the inventory pass.

- [ ] **Step 1: Failing tests:**
  - "a tenant admin gives User on their tenant and Operator on one of its instances";
  - "an instance path must exist";
  - "group paths and group-owner are still refused";
  - "deleting a Kubernetes cluster deletes its entries";
  - "an entry on an instance makes its cluster visible to the subject".
- [ ] **Step 2–4:** Implement; run the whole server suite. Expected: 0 fail.
- [ ] **Step 5:** Commit `incuscloud acl: project, instance and Kubernetes paths; the User role`.

### Task 4: Instances, mobility and self-service create by privilege

**Files:**
- Modify:
  - `src/api/fleet.ts`: instance search and detail;
  - `src/api/mobility.ts`;
  - `src/api/tenant-cloud.ts`;
  - `src/api/common.ts`: `visibleTenants` is replaced, for instances, by `instanceScope`;
  - the tests beside each.

**Interfaces:**
- `acl.instanceScope(p): Promise<{ all: boolean; projects: Set<string>; instances: Set<string> }>`:
  - `projects`: `<clusterId>/<project>` keys where `instance.view` holds for every instance (not owner-limited);
  - `instances`: `<clusterId>/<project>/<name>` keys owned or entry-granted.

  The search filters with it in SQL (`(cluster_id, project) in … or (cluster_id, project, name) in …`).
- **Privileges per call:**

  | Call | Privilege |
  | --- | --- |
  | instance detail and metrics | `instance.view` |
  | migration pre-flight and start | `instance.migrate` within a cluster, `instance.relocate` across |
  | choosing the target cluster or member | `placement.choose` (else automatic placement) |
  | self-service create | `instance.create` on the tenant (the job records the actor as owner) |

- [ ] **Step 1: Failing tests** (one per row above, each with a User who owns one instance and not another, plus "an operator still sees everything").
- [ ] **Step 2–4:** Implement; run the whole server suite. Expected: 0 fail; no existing test changes behaviour.
- [ ] **Step 5:** Commit `incuscloud acl: instances, mobility and create by privilege`.

### Task 5: Backups, replication, jobs and Kubernetes by privilege

**Files:**
- Modify: `src/api/backups.ts`, `replication.ts`, `jobs.ts` and `kubernetes.ts` (`needRole` is removed), and their tests.

**Interfaces:**
- **Backups:**
  - `backup.view`, `backup.create`, `backup.restore` and `backup.delete` are checked on the instance path, with `owner: createdBy`;
  - schedules need `backup.schedule`;
  - targets need `platform.settings` (writes); everyone signed in reads names.
- **Replication:** `replication.view` and `replication.manage` on the instance path.
- **Jobs:** visible if the caller is the actor, or holds `instance.view` on the job's instance, or `tenant.view` on its tenant (for jobs without an instance). Cancel needs the actor, or `tenant.manage`, or `cluster.configure` on its cluster.
- **Kubernetes:** paths are `/tenants/<t>/kubernetes/<name>`, with `owner: createdBy`:
  - list and get: `k8s.view`;
  - create, scale, upgrade and MetalLB: `k8s.provision` (create on the tenant path);
  - kubeconfig: `k8s.kubeconfig`;
  - delete: `k8s.delete`.

- [ ] **Step 1: Failing tests:**
  - "a User sees and restores only their own backups";
  - "a User deletes their own Kubernetes cluster, not another's";
  - "a User's job list holds their jobs only";
  - "tenant admins keep every right they have today".
- [ ] **Step 2–4:** Implement; run the whole server suite. Expected: 0 fail.
- [ ] **Step 5:** Commit `incuscloud acl: backups, replication, jobs and Kubernetes by privilege`.

### Task 6: Tenants, service accounts and logs by privilege; `platformCan` and `can(authz…)` gone

**Files:**
- Modify: `src/api/tenants.ts`, `service-accounts.ts`, `audit.ts`, `gateway-log.ts`, `users.ts`, `common.ts`, `access.ts`; `src/authz/guards.ts` keeps `needPriv`, `forbidden`, `notFound`. Delete the adapter's relation checks that have no caller left (keep `can_access` for the gateway and federation).

**Interfaces:**

| Area | Privilege |
| --- | --- |
| Tenants | `tenant.view` / `tenant.manage` / `tenant.members` / `tenant.quota`. Tenant owners keep "owns the tenant" (delete, manage owners) from the membership. |
| Service accounts | `platform.users` for platform accounts; `tenant.members` on the tenant for tenant accounts |
| Audit and gateway logs | `platform.audit` on `/` for all; `tenant.view` + `acl.view` on the tenant for `?tenant=` |
| Users | `platform.users` |

- [ ] **Step 1: Failing tests:**
  - "an Auditor entry on /tenants/acme reads acme's audit log";
  - "Operator on /tenants/acme manages members but not owners";
  - plus the whole existing suite unchanged.
- [ ] **Step 2–4:** Implement; run the whole server suite. Expected: 0 fail. `grep -rn "platformCan\|can(authz" src` should find only `src/authz/`.
- [ ] **Step 5:** Commit `incuscloud acl: tenants, accounts and logs by privilege`.

### Task 7: Incus grants for project and instance paths and the User role

**Files:**
- Modify: `src/reconcile/grants.ts`, `src/reconcile/cluster.ts`, and both tests; `src/clusters/fake-incus.ts` (lists profiles, networks and images per project).

**Interfaces:**
- **`explicitRelations` returns entitlements:** `Array<{ relation: string; object: string }>` on `server:incus`, `project:<p>`, `instance:<p>/<name>`, `profile:…`, `network:…`, `image:…`. Rules:
  - **Server:** as phase 1.
  - **Project, non-User roles:** as phase 1 (`operator` or `viewer`).
  - **Project, a deciding User role:** `can_create_instances`, `can_create_storage_volumes`, `can_create_storage_buckets`, `can_view_events`, `can_view_operations`, plus `can_view` on each of the project's profiles, networks and images (listed from the cluster), plus `operator` on each instance the subject owns there.
  - **Instance-path entries:**
    - Auditor → `viewer`;
    - User on an owned instance, and every role with `instance.configure` → `operator`;
    - a role with `instance.console` but not `instance.configure` → `user`;
    - No access → nothing.

    An instance narrowed below its project is handled like a narrowed project (phase 1): the project relation is replaced by per-instance relations on its other instances.
- **Explicit-entry subjects only**, as in phase 1. A User entry makes its subject explicit, so its tenant group membership is replaced.
- Owner changes (Task 2) trigger a reconcile of that cluster.

- [ ] **Step 1: Failing tests:**
  - "a User on /tenants/acme gets no project relation, only the direct entitlements and can_view on shared objects";
  - "a User gets operator on the instance they own, not on another";
  - "auditor on one instance gives viewer there only";
  - "No access on one instance of an operator's project replaces the project relation by the other instances'";
  - "today's roles alone write the same tuples as before".
- [ ] **Step 2–4:** Implement; run `./scripts-test.sh src/reconcile`, then the whole suite. Expected: 0 fail.
- [ ] **Step 5:** Commit `incuscloud acl: Incus grants for projects, instances and the User role`.

### Task 8: The facade and console for Users

**Files:**
- Modify:
  - `src/federation/handler.ts`:
    - project objects for callers Incus refuses;
    - `place()` reads placements, not `GET /1.0/projects`;
  - `incuscloud/web/src/pages/permissions/AddEntryModal.tsx`: Project and Instance kinds (cluster → project → instance pickers from the inventory), and the User role;
  - `incuscloud/web/src/console/AccessPage.tsx`: an "Entries" table with Add and Remove for holders of `acl.manage`, on project pages too;
  - the instance detail page: an owner row;
  - the specs.

**Interfaces:**
- **Facade, project object:**
  - `GET /1.0/projects/<p>`: when a cluster answers 403 and `acl.sees(p, /clusters/<c>/projects/<p>)`, it answers `{ name, description: "IncusCloud tenant <slug>", config: {} , used_by: [] }`.
  - `GET /1.0/projects?recursion=…` adds such projects to the merged list.
- **Facade, `place()`:** the clusters with a ready placement of the project's tenant, filtered by `sees`.

- [ ] **Step 1: Failing tests:**
  - "a User opens their project's page through the facade although Incus refuses the project";
  - "a User's create in a merged project is placed among the tenant's clusters";
  - "Add entry offers Project and Instance paths and the User role";
  - "the project Access tab adds an entry there".
- [ ] **Step 2–4:** Implement; run the server and web suites. Expected: pass; tsc clean.
- [ ] **Step 5:** Commit `incuscloud: the facade and console for Users`.

### Task 9: Live check, README, final review

- [ ] **Step 1: Live** (dev stack, browser script in `ic-browser`, light and dark):
  - give a fresh user User on `/tenants/kspike`;
  - as them, create an instance through the console. It is theirs within seconds: Check explains it, and it has console and exec.
  - `web-b` (the member's) is not listed in Incendio, the instance search, or `incus list` through the gateway;
  - delete theirs, and its grants go;
  - remove the entry and the user afterwards.
- [ ] **Step 2:** README: Permissions gains ownership, the User role, the new paths, and what Users see (decision 5). API rows updated.
- [ ] **Step 3:** Commit `incuscloud: permissions phase 2 docs`.
- [ ] **Step 4:** Final whole-branch review (fresh reviewer, most capable model) over this plan's commits, then one fix pass.
