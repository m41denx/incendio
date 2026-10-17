# IncusCloud permissions, phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 builds the ACL model, its resolution and storage, and makes IncusCloud's authorization come from it with no change in behaviour for today's roles. Explicit entries on `/`, on clusters and on tenants take effect in the API and in Incus. Platform › Permissions edits the entries and has a Check form.

**Architecture:**
- **Two kinds of entries.** Today's role tables become *virtual entries*: `platform_roles` gives Administrator, Operator or Auditor on `/`; `tenant_members` gives Tenant admin, Unrestricted user or Auditor on `/tenants/<t>`; service accounts get the same. Explicit entries live in a new `acl_entries` table. The Users and Tenants pages keep editing the virtual ones, so nothing is migrated and nothing can drift.
- **One resolver.** A pure resolver applies Proxmox's most-specific-wins over a cached snapshot. An `Authz` adapter answers today's relation checks from it, which replaces the OpenFGA platform store.
- **Cluster checks by path.** The cluster-scoped call sites are converted to `can(p, privilege, path)`. Tenant and instance call sites are converted in phase 2.

**Tech Stack:** Bun, Elysia, drizzle (Postgres/PGlite), TypeBox; React 19 with `@canonical/react-components` and Vitest for the web.

**Spec:** `docs/superpowers/specs/2026-10-12-incuscloud-acl-design.md` (rev 2, approved 2026-10-17).

**Beta roadmap:**
- this plan;
- ACL phase 2 (ownership, User role, project and instance paths, Incus grants for them, tenant call sites by privilege);
- ACL phase 3 (groups and tenants' default groups, group paths, Group owner, `placement.choose`);
- ACL phase 4 (quotas);
- beta hardening;
- P13 Ship (Helm, CI, docs);
- release.

Identity-provider group mapping (phase 5), P11, P12 and leases come after beta.

## Global Constraints

- **Privilege names** are `<object>.<action>`, lower case, exactly the spec's catalog. Phase 1 adds `platform.view` (see users, service accounts and platform settings without changing them). It was missing from the spec's table: today platform viewers read the Users page. Record this as a ruling.
- **Role ids** are the spec's names in kebab case: `administrator`, `operator`, `cluster-owner`, `group-owner`, `unrestricted-user`, `user`, `tenant-admin`, `auditor`, `no-access`.
- **Phase 1 accepts** `administrator`, `operator`, `cluster-owner`, `unrestricted-user`, `tenant-admin`, `auditor` and `no-access` in explicit entries. `user` and `group-owner` answer 400 `invalid_request` with "available in a later release", because nothing enforces them yet.
- **Paths** are `/`, `/platform`, `/clusters/<c>`, `/clusters/<c>/groups/<g>`, `/clusters/<c>/projects/<p>`, `/clusters/<c>/projects/<p>/instances/<i>`, `/tenants/<t>` and `/tenants/<t>/kubernetes/<name>`.
  - `<c>` is the cluster's name, `<t>` the tenant's slug, and the rest Incus names.
  - Phase 1 accepts entries on `/`, `/platform`, `/clusters/<c>` and `/tenants/<t>` only. Other paths answer 400, and the resolver still handles them.
- **Virtual entries:**

  | Source | Entry |
  | --- | --- |
  | platform role admin / operator / viewer | administrator / operator / auditor on `/` |
  | tenant role owner, admin / member / viewer | tenant-admin / unrestricted-user / auditor on `/tenants/<slug>` |
  | tenant service account | unrestricted-user on its tenant |
  | platform service account | as its platform role |

  Owner keeps its owner-only powers through `tenant_members.role = 'owner'`, as today.
- **Disabled users and service accounts** resolve to nothing.
- **Behaviour for today's roles must not change.** The whole existing server suite (544 tests) and web suite (265) pass with only test-setup changes. A test that needs a semantic change is a ruling, written in the ledger with the reason.
- **Permission changes reach other replicas within 2 s** (the snapshot TTL), and the writing replica sees them immediately (it invalidates its cache).

## Review Focus

1. **A platform admin who is also a tenant viewer** resolves to Auditor on that tenant's paths: Proxmox's most-specific-wins. Pin it with a test, and the Tenants page warns when it adds a platform role-holder as viewer. The alternative would silently widen access.
2. **`no-access` on `/clusters/c` for a platform operator** removes cluster c from the gateway and federation (403/hidden), from `/api/v1/clusters` and from Incus grants. In Incus, the subject must lose the server relation on that cluster's store only.
3. **Deleting a cluster or tenant** removes explicit entries under its path. A later cluster or tenant with the same name must not inherit them.
4. **An entry naming a disabled or deleted subject** grants nothing. Deleting a user or service account cascades its entries.
5. **The last administrator** cannot be removed through an explicit entry either: deleting the last effective `administrator` on `/`, or adding `no-access` on `/` for them, answers 409, as the Users page does today.

---

### Task 1: The ACL core (pure)

**Files:**
- Create: `incuscloud/server/src/acl/catalog.ts`, `incuscloud/server/src/acl/paths.ts`, `incuscloud/server/src/acl/resolve.ts`
- Test: `incuscloud/server/src/acl/resolve.test.ts`, `incuscloud/server/src/acl/paths.test.ts`

**Interfaces:**
- Produces:
  - `type Privilege` (a string union of the catalog), `PRIVILEGES: readonly Privilege[]`;
  - `type RoleId`, `ROLES: Record<RoleId, { name: string; privileges: ReadonlySet<Privilege>; ownedOnly?: ReadonlySet<Privilege> }>`. `ownedOnly` is used in phase 2; leave it empty except on `user`.
  - `type AclPath = { kind: "root" } | { kind: "platform" } | { kind: "cluster"; cluster: string } | { kind: "group"; cluster: string; group: string } | { kind: "project"; cluster: string; project: string } | { kind: "instance"; cluster: string; project: string; instance: string } | { kind: "tenant"; tenant: string } | { kind: "kubernetes"; tenant: string; name: string }`
  - `parsePath(s: string): AclPath | null`, `formatPath(p: AclPath): string`
  - `chain(p: AclPath, tenantOf: (cluster: string, project: string) => string | undefined): string[]`: most specific first.
    - instance → [instance, project, `/tenants/<t>` when the project is a placement, cluster, `/`];
    - project → [project, tenant?, cluster, `/`];
    - group → [group, cluster, `/`];
    - cluster → [cluster, `/`];
    - kubernetes → [kubernetes, tenant, `/`];
    - tenant → [tenant, `/`];
    - platform → [platform, `/`];
    - root → [`/`].
  - `interface Entry { id: string; path: string; subject: string /* "user:<id>" | "service:<id>" */; role: RoleId; propagate: boolean; source: "acl" | "platform-role" | "tenant-membership" | "service-account" }`
  - `resolve(subjects: string[], entriesByPath: Map<string, Entry[]>, chain: string[]): { privileges: Set<Privilege>; decidedBy: Entry[] }`

- [ ] **Step 1: Write the failing tests**
  - `paths.test.ts`: every path kind round-trips through `parsePath`/`formatPath`. `parsePath` returns null for `""`, `/clusters`, `/clusters/a/b`, `/tenants/x/y/z` and names with `/` or spaces. `chain` of `/clusters/c/projects/acme/instances/web`, with `tenantOf("c","acme") = "acme"`, equals `["/clusters/c/projects/acme/instances/web", "/clusters/c/projects/acme", "/tenants/acme", "/clusters/c", "/"]`.
  - `resolve.test.ts` (each `it` names the rule):
    - "an entry on / reaches everything below when it propagates";
    - "propagate false applies to its own path only";
    - "the most specific path with an entry wins: auditor on the tenant narrows operator on /";
    - "no-access gives nothing even under administrator";
    - "at one path, the subject's entries are all combined (union of roles)";
    - "entries of other subjects never count";
    - "decidedBy names the entries of the deciding level".
  - Role contents:
    - `ROLES.operator` lacks exactly `acl.manage`, `platform.users` and `platform.settings` among all privileges;
    - `ROLES["unrestricted-user"]` has no `node.*`, `cluster.configure`, `acl.*` or `platform.*`;
    - `ROLES["cluster-owner"]` has `node.provision`;
    - `ROLES.auditor` is exactly the `*.view` privileges plus `acl.view` and `platform.audit`.

- [ ] **Step 2: Run, expect failures** — `cd incuscloud/server && bun test src/acl` → fails (modules missing).

- [ ] **Step 3: Implement** `catalog.ts`, `paths.ts` and `resolve.ts` to the interfaces.
  - The catalog is the spec's privilege table plus `platform.view`.
  - Role privileges follow the spec's role table. `tenant-admin` = every workload privilege + `tenant.view`, `tenant.manage`, `tenant.members`, `tenant.quota`, `acl.view`, `acl.manage`. Its `tenant.quota` concerns users' quotas; the tenant's own quota is checked on `/`.

- [ ] **Step 4: Run** `bun test src/acl` → all pass.

- [ ] **Step 5: Commit** `incuscloud acl: privileges, roles, paths and Proxmox-style resolution`.

### Task 2: Entries table, snapshot and the `Acl` service

**Files:**
- Modify: `incuscloud/server/src/db/schema.ts`
- Create: `incuscloud/server/drizzle/0013_acl_entries.sql` (+ snapshot/journal via `bunx drizzle-kit generate`), `incuscloud/server/src/acl/acl.ts`
- Test: `incuscloud/server/src/acl/acl.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - Table `aclEntries`, with a unique index on (path, subject_type, subject_id, role):

    | Column | Type |
    | --- | --- |
    | `id` | uuid pk |
    | `path` | text not null |
    | `subjectType` | text check in ('user','service') |
    | `subjectId` | uuid not null |
    | `role` | text not null |
    | `propagate` | boolean not null default true |
    | `createdBy` | uuid null |
    | `createdAt` | timestamp |
  - `class Acl`:
    - `constructor(db: Db, opts?: { ttlMs?: number /* 2000 */; now?: () => number })`;
    - `privileges(p: Principal, path: string): Promise<Set<Privilege>>`;
    - `can(p: Principal, privilege: Privilege, path: string): Promise<boolean>`;
    - `explain(subject: string, path: string): Promise<{ privileges: Privilege[]; decidedBy: Entry[] }>`;
    - `sees(p: Principal, path: string): Promise<boolean>`: true when it has any privilege at the path or at any path below it with an entry for the subject;
    - `entries(): Promise<Entry[]>`: explicit + virtual;
    - `invalidate(): void`.
  - A snapshot holds:
    - all `acl_entries`;
    - the virtual entries (from `platform_roles`, `tenant_members` + `tenants.slug`, `service_accounts`);
    - disabled flags of users and service accounts;
    - placements (cluster name, project, tenant slug), which back `tenantOf`.

    It is loaded on demand, reused for `ttlMs`, and dropped by `invalidate()`.

- [ ] **Step 1: Write the failing tests** (`acl.test.ts`, on `testDb()`):
  - "a platform viewer is an auditor on / (virtual entry)";
  - "a tenant member is an unrestricted user on its tenant and on its project on every cluster";
  - "a tenant service account acts as unrestricted user on its tenant";
  - "an explicit no-access on /clusters/c removes cluster c from a platform operator, and sees() is false";
  - "a platform admin who is a tenant viewer is an auditor on that tenant" (Review Focus 1);
  - "a disabled user resolves to nothing";
  - "sees() is true for a cluster when the only entry is on its tenant's project there";
  - "changes are seen after invalidate(), and after the TTL without it" (inject `now`).

- [ ] **Step 2: Run, expect failures.**

- [ ] **Step 3: Implement** the schema, the migration (`bunx drizzle-kit generate --name acl_entries`, then check the SQL) and `Acl`.

- [ ] **Step 4: Run** `bun test src/acl src/db` → pass.

- [ ] **Step 5: Commit** `incuscloud acl: entries table and the resolver over explicit and virtual entries`.

### Task 3: The `Authz` adapter replaces the OpenFGA platform store

**Files:**
- Create: `incuscloud/server/src/authz/acl-authz.ts`
- Modify:
  - `incuscloud/server/src/main.ts`: drop `PlatformAuthz.init` and `syncAll`; build `Acl` and `AclAuthz`;
  - `incuscloud/server/src/app.ts`: `AppDeps.acl: Acl`;
  - `incuscloud/server/src/test/harness.ts`: `AclAuthz` over the test db; `user()` and `tenant()` call `acl.invalidate()` instead of `syncAll`;
  - the 9 test files that write tuples or use `FakeAuthz`: they set roles through the db helpers instead;
  - `incuscloud/server/src/bootstrap/admin.ts`.
- Delete: `incuscloud/server/src/authz/fake.ts`, `fake.it.test.ts`, `platform.it.test.ts`, `sync.ts`, `model.fga`, and `PlatformAuthz` in `platform.ts`. Keep the `Authz` and `Tuple` types.
- Test: `incuscloud/server/src/authz/acl-authz.test.ts`

**Interfaces:**
- Consumes: `Acl` (Task 2).
- Produces: `class AclAuthz implements Authz`. `write()` is a no-op that calls `acl.invalidate()`. Callers pass `user:<id>` for service accounts too (`guards.subject`), so the adapter looks the id up among service accounts before users. Relations map as follows:

  | Relation on | Is |
  | --- | --- |
  | `platform:main` admin / operator / viewer | `platform.users` / `cluster.configure` / `cluster.view` on `/` |
  | `tenant:<id>` owner | a `tenant_members` row with role owner (and the user enabled) |
  | `tenant:<id>` admin / member / viewer | `tenant.members` / `instance.create` / `tenant.view` on `/tenants/<slug>` |
  | `cluster:<id>` can_access | `sees(/clusters/<name>)` |

  `listObjects(user, rel, "tenant" \| "cluster")` evaluates that check over every tenant or cluster.

- [ ] **Step 1: Write the failing test** `acl-authz.test.ts`: each row of the table above, for a user given the matching platform or tenant role, and the negative for a user without it.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement the adapter, rewire main/app/harness, and delete the platform store.** Keep `authz.write(...)` calls at call sites as they are (now cache invalidations); Task 4 removes the ones it touches.
- [ ] **Step 4: Run the whole suite** `./scripts-test.sh`, then `grep -E "\(fail\)| pass$| fail$" /tmp/incuscloud-test.log` → 0 fail. Run `bunx tsc --noEmit -p .` → clean. Any test changed beyond setup is a ruling in the ledger.
- [ ] **Step 5: Commit** `incuscloud acl: authorization answered by the ACL; the OpenFGA platform store is gone`.

### Task 4: Cluster-scoped checks by privilege and path

**Files:**
- Modify:
  - `incuscloud/server/src/authz/guards.ts`: add `needPriv(acl, p, privilege, path, seePath?)` → 404 when `!sees(seePath ?? path)`, else 403 when `!can`;
  - `src/api/clusters.ts`, `src/api/balancing.ts`, `src/api/access.ts`, `src/api/fleet.ts` (cluster inventory and metrics only), `src/gateway/handler.ts:93`, `src/federation/handler.ts:101`.
- Test: the existing tests, plus new cases in `clusters.test.ts`, `balancing.test.ts`, `gateway/handler.test.ts` and `federation/handler.test.ts`.

**Interfaces:**
- Consumes: `Acl.can`, `Acl.sees`.
- The mapping (the old check → the new one):

  | Call site | Now |
  | --- | --- |
  | cluster read (`clusters.ts` get, inventory, metrics, `access.ts`) | `sees(/clusters/<name>)` (404 otherwise); the platform-only fields need `cluster.view` |
  | cluster list | every cluster with `sees` |
  | reconcile, place tenants, labels, PATCH | `cluster.configure` on `/clusters/<name>` |
  | enrol, delete | `platform.settings` on `/` |
  | balancing read | `cluster.view` |
  | balancing write, plan, run | `cluster.configure` |
  | member evacuate, restore | `node.maintain` on `/clusters/<name>` |
  | gateway and federation | `sees(/clusters/<name>)` |

- [ ] **Step 1: Write the failing tests:**
  - "an operator of /clusters/c only reconciles and balances c, and gets 404 on d";
  - "an auditor of /clusters/c reads c's inventory and nothing of d";
  - "no-access on /clusters/c hides c from a platform operator: list, gateway 403, federation" (Review Focus 2);
  - "a cluster owner of c evacuates a member of c".
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Convert the call sites** per the table.
- [ ] **Step 4: Run the whole suite** → 0 fail.
- [ ] **Step 5: Commit** `incuscloud acl: cluster pages, balancing, gateway and federation check privileges on the cluster's path`.

### Task 5: Explicit entries reach Incus

**Files:**
- Modify: `incuscloud/server/src/reconcile/grants.ts`, `incuscloud/server/src/reconcile/cluster.ts` (where it gathers members and roles)
- Test: `incuscloud/server/src/reconcile/grants.test.ts`, `incuscloud/server/src/reconcile/cluster.test.ts`

**Interfaces:**
- Consumes: `Acl.entries()`, `Acl.privileges` (via `explain`), `chain`.
- Produces: `desiredGrants(input)` takes the effective decision per (subject, cluster) and per (subject, tenant project).
  - **Server relation on cluster c**, from the roles deciding at `/clusters/c` or `/`:
    - administrator, cluster-owner → `admin`;
    - operator, unrestricted-user → `operator`;
    - auditor → `viewer`.
  - **Project relation**, from the roles deciding at `/clusters/c/projects/p` or `/tenants/t`:
    - tenant-admin, unrestricted-user, operator → `operator`;
    - auditor → `viewer`;
    - administrator, cluster-owner → `operator`. Never project `admin`: a project admin can lift the project's own restrictions (spec D5).
  - **Narrowing.** When a subject's cluster-level decision is narrowed below it on that cluster (any entry of theirs on a tenant or project there that resolves to less), the server relation is replaced by project relations on each of the cluster's projects except the narrowed ones. The project list comes from the reconciler's `/1.0/projects`.
  - Groups stay `incuscloud-*`. Explicit-entry groups are `incuscloud-acl-<sha256(relation|object) first 12 hex>`.

- [ ] **Step 1: Write the failing tests** (`grants.test.ts`):
  - "an operator entry on /clusters/c gives server operator on c only";
  - "an auditor entry on /tenants/acme gives project viewer on acme's project on each placed cluster";
  - "a platform operator with no-access on /tenants/acme gets operator on every other project of the cluster, and no server relation";
  - "today's roles give exactly today's tuples" (a snapshot of the current output for a fixture with every role).
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `./scripts-test.sh src/reconcile` and then the whole suite → 0 fail.
- [ ] **Step 5: Commit** `incuscloud acl: explicit entries become Incus grants, narrowing included`.

### Task 6: The permissions API

**Files:**
- Create: `incuscloud/server/src/api/acl.ts`; register it in `incuscloud/server/src/app.ts`
- Modify:
  - `incuscloud/server/src/api/clusters.ts` and `tenants.ts` (delete cascades entries under the path);
  - `incuscloud/server/src/api/users.ts` (the last-admin rule also counts explicit entries);
  - `incuscloud/server/src/api/me.ts` (adds `rootPrivileges: Privilege[]`, the caller's privileges on `/`).
- Test: `incuscloud/server/src/api/acl.test.ts`

**Interfaces:**
- Routes (all under `/api/v1/acl`):
  - `GET roles` → `[{ id, name, privileges[] }]`, for anyone signed in.
  - `GET entries?path=` → explicit + virtual entries at and below `path` (default `/`) that the caller may see (`acl.view` on the entry's path), with `subject: { type, id, name }` and `source`. Virtual ones have `editable: false` and `editedOn: "users" | "tenants" | "service-accounts"`.
  - `POST entries {path, subject: {type, id}, role, propagate}` → 201.
    - Checks:
      - `acl.manage` on `path`;
      - the path is a phase-1 path that names an existing cluster or tenant;
      - the role is a phase-1 role;
      - the subject exists;
      - only a holder of `administrator` on `/` may grant `administrator` or `cluster-owner`.
    - Audited as `acl.entry.create`. It invalidates the cache and requests a reconcile of the affected clusters (all clusters for `/` and `/tenants/*`).
  - `DELETE entries/:id` → 204. Same checks and audit (`acl.entry.delete`). The last-administrator rule answers 409 (Review Focus 5).
  - `GET check?subject=user:<id>&path=` → `{ privileges[], decidedBy[] }`. Needs `acl.view` on the path.

- [ ] **Step 1: Write the failing tests:**
  - "admins add and remove an operator entry on a cluster; it is audited and the user can then reconcile it";
  - "tenant admins manage entries on their tenant only";
  - "auditors read, never write";
  - "user and group-owner roles, and project or instance paths, are refused for now";
  - "only administrators grant administrator or cluster owner";
  - "the last administrator cannot lose administrator through an entry";
  - "deleting a cluster deletes its entries, and a new cluster of the same name starts with none" (Review Focus 3);
  - "deleting a user deletes their entries" (Review Focus 4);
  - "check explains the deciding entries";
  - "/me carries the caller's privileges on /".
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole suite** → 0 fail; tsc clean.
- [ ] **Step 5: Commit** `incuscloud acl: the permissions API (roles, entries, check)`.

### Task 7: Platform › Permissions in the console

**Files:**
- Create: `incuscloud/web/src/pages/permissions/PermissionsPage.tsx`, `EntryList.tsx`, `AddEntryModal.tsx`, `RoleList.tsx`, `CheckForm.tsx`, `usePermissions.ts`, `permissions.spec.tsx`
- Modify:
  - `incuscloud/web/src/api/types.ts`: `AclEntry`, `AclRole`, `Me.rootPrivileges`;
  - `incuscloud/web/src/api/hooks.ts`: `can(me, level)` derives from `rootPrivileges` (admin = `platform.users`, operator = `cluster.configure`, viewer = `cluster.view`), falling back to `platformRole` when `rootPrivileges` is absent;
  - `incuscloud/web/src/App.tsx`: route `/permissions/:tab?`;
  - `incuscloud/web/src/console/Sidebar.tsx`: "Permissions" under Platform, for holders of `acl.view` on `/`.

**Interfaces:**
- Consumes: Task 6 routes.
- The page is Incendio-styled (`PageLayout`, `ScrollableTable` / `MainTable`, `Modal`, `Select`, `Input`, square/metro look). It has three tabs:
  - **Entries:**
    - columns Path, Subject, Role, Propagates, Source, Actions;
    - filter by path;
    - virtual entries read-only, with "Edit on Users/Tenants" links;
    - Add entry: path kind (Everything, Cluster, Tenant), then the object, subject (users and service accounts), role (phase-1 roles), propagate.
  - **Roles:** each role with its privileges, read-only.
  - **Check:** subject + path → privileges and the deciding entries.

- [ ] **Step 1: Write the failing tests** (`permissions.spec.tsx`, mockApi):
  - "lists explicit and virtual entries; virtual ones offer no Remove";
  - "Add entry posts {path:'/clusters/lab', subject:{type:'user',id}, role:'operator', propagate:true}";
  - "Roles lists operator's privileges";
  - "Check shows privileges and the deciding entry";
  - "the sidebar shows Permissions only with acl.view on /".
- [ ] **Step 2: Run, expect failures** — `cd incuscloud/web && bunx vitest --run src/pages/permissions`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite and `bunx tsc --noEmit` → pass.
- [ ] **Step 5: Commit** `incuscloud web: Platform › Permissions (entries, roles, check)`.

### Task 8: Access tabs show explicit entries; live check; docs; review

**Files:**
- Modify:
  - `incuscloud/server/src/api/access.ts`: adds `entries`, the explicit entries on `/clusters/<c>` (and `/` and the tenants placed there) that affect this cluster, with their Incus relation;
  - the web Access tab component (`incuscloud/web/src/console/` access view): an "Entries" table;
  - `incuscloud/README.md`: a Permissions section and API rows;
  - `QUESTIONS.md` deferred list, if anything is deferred.
- Test: `access.test.ts`, the web access spec.

- [ ] **Step 1: Failing tests:** "the Access tab lists an operator entry on the cluster with relation operator", server and web.
- [ ] **Step 2–4:** Implement; run both suites → pass.
- [ ] **Step 5: Live check** (dev stack, browser script in `ic-browser`):
  - as admin, add Operator on `/clusters/cluster-b` for `member@incuscloud.dev`;
  - as member, cluster-b's reconcile and balancing work, and cluster-c's pages are 404;
  - the Check form explains it;
  - remove the entry → back to before.
  - Screenshots in light and dark.
- [ ] **Step 6: Commit** `incuscloud: Access tabs show permission entries; README`.
- [ ] **Step 7: Final whole-branch review** (fresh reviewer, most capable model) over this plan's commits, then one fix pass.
