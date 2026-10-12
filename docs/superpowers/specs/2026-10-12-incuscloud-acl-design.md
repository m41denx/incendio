# IncusCloud permissions: Proxmox-style ACLs

**Date:** 2026-10-12. **Branch:** `incuscloud`. **Status:** draft for the user's review. Nothing is built until it is approved.

## What the user asked

> regarding acl I meant acl at incuscloud level so users/tenants not only have quotas but can be limited to cluster, node or even instance. full acl like proxmox has

Today IncusCloud has two fixed role ladders:
- **Platform roles:** admin, operator and viewer, on everything.
- **Tenant roles:** owner, admin, member and viewer, on the tenant's projects.

A tenant is limited to clusters only by where it is placed. Nothing finer exists: no per-cluster operator, no user restricted to a member or an instance, no groups.

## Proxmox's model, in short

- An ACL entry is a **path**, a **subject** (user, group or API token), a **role** and **propagate**.
  - Paths form a tree: `/`, `/nodes/<n>`, `/vms/<id>`, `/storage/<id>`, `/pool/<p>`, `/access/...`.
  - An entry applies to its path and, when it propagates, everything below it.
- A **role** is a named set of **privileges** (`VM.Audit`, `VM.Console`, `VM.PowerMgmt`, `VM.Config.*`, `VM.Allocate`, `Datastore.*`, `Sys.*`, `User.Modify`, `Permissions.Modify`, …). Roles are built in or custom.
- **Resolution:** the most specific path wins. An entry on `/vms/100` replaces what a user inherits from `/` for that VM; the `NoAccess` role takes everything away there. At the same path, a user's own entries win over their groups' entries.
- API tokens carry their own ACLs, at most what their user has ("privilege separation").

## IncusCloud's version

### Paths

```
/                                                  everything
/clusters/<cluster>                                one Incus cluster
/clusters/<cluster>/members/<member>               one member: what runs on it, and placing onto it
/clusters/<cluster>/projects/<project>             one Incus project (a tenant's, or default)
/clusters/<cluster>/projects/<project>/instances/<instance>
/tenants/<tenant>                                  a tenant: its settings, members, quotas, and all its projects
/kubernetes/<tenant>/<name>                        one Kubernetes cluster
/platform/<area>                                   platform pages: users, tenants, jobs, replication, backups, balancing, audit, settings
```

`/tenants/<t>` is an alias tree: an entry there applies to every `/clusters/*/projects/<t's project>` too. That keeps tenant roles meaningful when a tenant is on several clusters.

### Subjects

Four kinds of subject:
- **Users** (as now).
- **Groups:** new IncusCloud user groups, managed on Platform › Users › Groups and optionally mapped from an IdP `groups` claim.
- **Service accounts**, as API tokens: a token's effective permissions are its own entries intersected with its owner's.
- **Tenants as a subject:** "all members of tenant T". This is how a whole tenant is limited, for example `tenant:acme` gets `InstanceUser` on one member only.

### Privileges and roles

Each privilege maps to an Incus entitlement or to an IncusCloud API action.

| Privilege | Incus entitlement / IncusCloud action |
| --- | --- |
| `Instance.Audit` | instance `can_view` (incl. state, logs, metrics) |
| `Instance.Console` | `can_access_console` |
| `Instance.Exec` | `can_exec` |
| `Instance.Files` | `can_access_files` |
| `Instance.Power` | `can_update_state` |
| `Instance.Snapshot` | `can_manage_snapshots` |
| `Instance.Backup` | `can_manage_backups` (and IncusCloud's backups/replication of that instance) |
| `Instance.Config` | `can_edit` |
| `Instance.Allocate` | project `can_create_instances`; delete an instance |
| `Instance.Migrate` | move between members/clusters (IncusCloud mobility) |
| `Project.Audit` / `Project.Modify` | project `can_view` / `operator`-level editing of profiles, networks, volumes, images |
| `Member.Audit` / `Member.Place` / `Member.Modify` | see members / target new instances at the member / evacuate, restore, edit |
| `Cluster.Audit` / `Cluster.Modify` | server `viewer` / server `admin` on that cluster; IncusCloud cluster settings |
| `Tenant.Audit` / `Tenant.Modify` / `Tenant.Members` / `Tenant.Quota` | the tenant's page / rename / members / quotas |
| `K8s.Audit` / `K8s.Use` / `K8s.Modify` | see / kubeconfig / create, scale, upgrade, delete |
| `Platform.Audit` / `Platform.Users` / `Platform.Permissions` / `Platform.Jobs` / `Platform.Settings` | platform pages |

The built-in roles cover today's ladders, so nothing changes for existing setups. They are read-only, and custom roles are any set of privileges.

| Role | Privileges |
| --- | --- |
| `Administrator` | everything |
| `NoAccess` | nothing; it overrides what is inherited at and below its path |
| `Operator` | everything except `Platform.Users`, `Platform.Permissions` and `Platform.Settings` |
| `Auditor` | every `*.Audit` |
| `TenantOwner` / `TenantAdmin` | `Tenant.*` (Owner can also delete the tenant and manage owners) plus `ProjectAdmin` on its projects |
| `ProjectAdmin` | `Project.*`, `Instance.*`, `K8s.*` |
| `ProjectUser` | `Project.Audit`, `Instance.*` except `Instance.Allocate`, `K8s.Use` |
| `InstanceAdmin` | `Instance.*` except `Instance.Allocate` |
| `InstanceUser` | `Instance.Audit`, `Console`, `Exec`, `Power` |
| `InstanceAudit` | `Instance.Audit` |

Today's roles become entries:
- platform admin → `Administrator` on `/`;
- platform operator → `Operator` on `/`;
- platform viewer → `Auditor` on `/`;
- tenant owner, admin, member and viewer → `TenantOwner`, `TenantAdmin`, `ProjectAdmin` and `Auditor` on `/tenants/<t>`.

The Tenants page keeps setting these entries, so the simple path stays simple.

### Resolution (as in Proxmox)

1. For a subject and a path, take the entries on that path and each ancestor that are the subject's own, its groups', its tenants' (tenant as subject), or for a token, its owner's (then intersect).
2. **The most specific path with any entry wins.** Its roles' privileges are the result, and less specific paths are ignored. At that path, user entries beat group and tenant entries. `NoAccess` there means none.
3. An entry with `propagate: false` applies to its own path only.

### Enforcement

**The IncusCloud API.** Every route checks privileges on the object's path through one function, `can(principal, privilege, path)`. It replaces `needRole`/`can_access`. Lists filter by `Audit` on each item. The authorization store keeps doing what it does today for `/api/v1`.

**Incus, through the facade, the gateway and per-cluster Incendio.** IncusCloud does not trust itself to filter Incus's answers. It keeps writing grants into each cluster's OpenFGA store, so Incus enforces them too, as it does today with the `incuscloud-*` groups:
- **Entitlements on Incus objects:** each distinct (path, role) in use on a cluster becomes an Incus group `incuscloud-acl-<hash>`. The group gets the entitlements of the role's privileges on that object:
  - `server:incus`;
  - `project:<p>`;
  - `instance:/1.0/instances/<i>?project=<p>`;
  - for a cluster path, `server`.

  Subjects become members of the group: users directly; IncusCloud groups and tenants through their users. A more specific entry that narrows access (rule 2) is expressed by not granting the broader group to that user on that cluster. IncusCloud computes the effective set per user and object, so Incus never needs a deny.
- **Visibility:** someone with entries only on instances also gets `can_view` on those instances' projects. Without it, Incus's lists hide the project, so they could not reach the instance.
- **Members (nodes)** are not objects in Incus's authorization model, so IncusCloud enforces member paths itself:
  - **Placement:** `Member.Place` only on some members limits `target` on create and move to those members. For a tenant as subject, this is also written as the project's `restricted.cluster.groups`, using IncusCloud-managed cluster groups (`incuscloud-m-<member>`), so Incus enforces it too.
  - **What runs on a member:** `Instance.*` on `/clusters/c/members/m` grants the instance privileges on each instance whose location is that member. The reconciler writes them per instance and rewrites them when instances move. Until then, a just-moved instance keeps its grants for up to one reconcile interval.
  - `Member.Modify` is server-level in Incus (evacuate/restore), so the facade allows it only on that member's endpoints, for platform operators.

### Console

- **Platform › Permissions:** the entries (path, subject, role, propagate) with add and remove, plus Roles (built-in, and custom with a privilege checklist) and Groups.
- **Access tabs** show:
  - on clusters, projects and instances: the entries on that path and those inherited down to it, with add and remove there for anyone holding `Platform.Permissions` (or `Tenant.Members` within a tenant);
  - on members: those entries;
  - the effective result, i.e. who can do what here.
- The tree, tabs and actions follow privileges. Someone limited to two instances sees their cluster, those instances' project, and the two instances.
- A **Check** form: subject + path → effective privileges and which entry decided them.

## Migration

Existing platform and tenant roles become entries (above), with no change in behaviour. Groups and tenant subjects start empty.

## Decisions for the user

1. **Resolution:** I recommend Proxmox's most-specific-wins (it is what "limit a user to an instance" needs) over additive-only.
2. **Tenants as subjects:** I recommend yes. They make "limit tenant T to member M" one entry.
3. **Member paths:** instance privileges for what runs on the member, plus placement. The alternative is placement only.
4. **Custom roles** in the first version, or only the built-in ones?
5. **IdP group mapping** for IncusCloud groups now, or later?

## Phasing

Each phase ships on its own:
1. Model, resolution and the API's `can()`; today's roles migrated; Platform › Permissions; Check.
2. Grants into Incus for cluster, project and instance paths, with visibility.
3. Groups and tenants as subjects; custom roles.
4. Member paths: placement and restricted cluster groups, then grants for what runs on a member.
