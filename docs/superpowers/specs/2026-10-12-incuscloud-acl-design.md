# IncusCloud permissions: granular ACLs for a private cloud

**Date:** 2026-10-12, revised 2026-10-17 (rev 2). **Branch:** `incuscloud`. **Status:** approved 2026-10-17.

## What the user asked

> regarding acl I meant acl at incuscloud level so users/tenants not only have quotas but can be limited to cluster, node or even instance. full acl like proxmox has

The user's answers to rev 1 (QUESTIONS.md §A, 2026-10-17):
- **Privileges** are granular like Proxmox's (`Datastore.Allocate`, `VM.Migrate`, `LXC.Snapshot`), named for IncusCloud's architecture rather than copied. Resolution is Proxmox's.
- **IncusCloud is a private cloud**, on-prem or hybrid, and tenants are untrusted. Platform DevOps provision a Kubernetes cluster for division X, raise quota for division Y, and let division Z make backups, but with a quota so they cannot fill the storage (limited by capacity or by count). An admin service account with full rights may run its own ACLs on top.
- **Tenants as subjects:** would a default group per tenant be enough?
- **Placement:** the cloud is one pool of compute by default, with limits set per instance. It must also be possible to give full freedom on cluster X, or on group Y of cluster Z. Model: Platform9 PCD's virtualized clusters, and Incus's cluster groups, which IncusCloud already shows.
- **No custom roles.** Granular privileges, with bundled roles: administrator (everything), operator (everything except permissions and global settings, like today's operator), user (only their own resources), cluster owner, group owner, and unrestricted cluster/group user (anything except provisioning nodes).
- **Groups from the identity provider:** no opinion.

## What Platform9 Private Cloud Director does

A mapping agent and eight question agents read PCD's documentation (docs.platform9.com/private-cloud-director, about 246 pages). The notes and their sources are in the session's scratchpad (`pcd/answers/*.md`). What matters here:

- **Roles.** PCD has two role sets that are mutually exclusive: the legacy Admin, Self-Service User and ReadOnly, and the "granular RBAC" (beta) set. The granular set has six fixed roles:
  - Platform Admin (system scope);
  - Service Provider Domain Admin (system scope);
  - Customer Domain Admin (one domain);
  - Tenant Admin, Application User and Tenant User (one tenant).

  Tenant User may only manage what it owns: VMs, volumes, ports, snapshots and key pairs. There are no custom roles, and permissions are readable labels such as "Virtual Machine: Update - live migrate".
- **No cluster scope.** Roles are bound to system, domain or tenant only. Compute clusters are "intentionally omitted" from the policy engine. Every VM is created in a chosen virtualized cluster, and host aggregates are selected through flavor metadata. Nothing binds a cluster or an aggregate to a tenant. **IncusCloud goes further than PCD here**, as the user asked.
- **Quotas.**
  - Per tenant: cores, RAM, VMs, server groups, block storage GB, volumes, **volume snapshots (count)**, max volume size, and networking objects.
  - Per user, inside a tenant: compute only (cores, RAM, instances). A user quota overrides the tenant's compute quota for that user.
  - There is no quota on snapshot GB or on backups: native backup is "TBD", and backups come from Veeam or Rubrik.
  - **VM leases:** a VM is powered off or deleted after a set time, configured per tenant.
- **SSO.** Only SAML is documented, configured per domain. An IdP group or attribute maps to a (tenant, role) pair and is evaluated at login. The docs contradict themselves on whether the first match wins or all matches combine.
- **Automation.** Application credentials belong to one tenant and carry a subset of their owner's roles. They become invalid when the owner is disabled or deleted, and they expire only if an expiry is set. Tokens live 24 h.
- **Kubernetes.** The control plane is either managed by PCD or colocated with the nodes. Nodes are created through Cluster API, with node groups, add-ons (CoreDNS and Calico, MetalLB, GPU Operator) and kubeconfigs through OIDC. The docs say nothing about which role may create a cluster, or about Kubernetes quotas.

What IncusCloud takes from this:
- an own-resources role;
- per-user quotas that a tenant admin sets inside the tenant's quota;
- a snapshot count quota;
- credentials that are a subset of their owner's rights;
- IdP group mapping that is evaluated at sign-in.

What it does differently:
- grants can be scoped to a cluster or a cluster group;
- backups are native (IncusCloud's S3 backups), so they get quotas by count and by bytes.

## The model

### Objects and paths

```
/                                                one IncusCloud
/clusters/<c>                                    an Incus cluster: its members, groups, projects, and everything in them
/clusters/<c>/groups/<g>                         an Incus cluster group: its members and the instances located on them
/clusters/<c>/projects/<p>                       an Incus project
/clusters/<c>/projects/<p>/instances/<i>         an instance
/tenants/<t>                                     a tenant: its settings, members, quotas, and its projects on every cluster
/tenants/<t>/kubernetes/<name>                   a Kubernetes cluster
/platform                                        global settings: users, groups, enrolment, backup targets, audit
```

- **Nodes are reached through groups.** Incus already groups members (a member can be in several groups), and IncusCloud shows those groups. An entry on a group covers its members, and the instances located on them, wherever those instances move. To scope to one node, put it in a group of its own. There are no per-member paths.
- **A tenant path is an alias.** An entry on `/tenants/<t>` also applies to that tenant's project on every cluster, so tenant roles keep working on a tenant that spans several clusters.
- **Paths form a tree.** An instance sits both under its project and, while it runs on a member of group `g`, under `/clusters/<c>/groups/<g>`. Resolution (below) considers both parents.

### Privileges

Privileges are named `<object>.<action>`, in lower case. Each maps to IncusCloud API actions and to Incus entitlements.

| Privilege | What it allows | Incus side |
| --- | --- | --- |
| `instance.view` | see the instance, its state, logs, metrics | `can_view` |
| `instance.console` / `instance.exec` / `instance.files` | console, exec, file transfer | `can_access_console` / `can_exec` / `can_access_files` |
| `instance.power` | start, stop, restart, freeze | `can_update_state` |
| `instance.configure` | change config, devices, profiles | `can_edit` |
| `instance.snapshot` | create, restore, delete snapshots | `can_manage_snapshots` |
| `instance.create` / `instance.delete` | create (counts against quotas) / delete | project `can_create_instances` / `can_delete` |
| `instance.migrate` | move between members of a cluster | via IncusCloud (target checks) |
| `instance.relocate` | move or copy to another cluster | IncusCloud mobility |
| `placement.choose` | pick the cluster, group or member for a new or moved instance; without it, IncusCloud places automatically | `target` checks, `restricted.cluster.groups` |
| `storage.allocate` | create volumes and buckets in a project | project `can_create_storage_volumes`, `can_create_storage_buckets` |
| `storage.pools` | manage storage pools | server `can_edit` (pools) |
| `network.use` / `network.manage` | attach to networks / create networks, ACLs, forwards, zones | project `can_view` / `can_create_networks` etc. |
| `image.manage` | upload and delete images | project `can_create_images` |
| `project.configure` | profiles and project settings, within the project's restrictions | project `operator` |
| `backup.create` / `backup.restore` / `backup.delete` / `backup.schedule` | IncusCloud backups to S3 (counted against backup quotas) | IncusCloud API |
| `replication.manage` | replication policies and failover | IncusCloud API |
| `k8s.view` / `k8s.kubeconfig` / `k8s.provision` / `k8s.delete` | see, get the admin kubeconfig, create/scale/upgrade, delete | IncusCloud API |
| `node.maintain` | evacuate and restore members, move members between groups | server-level (IncusCloud only) |
| `node.provision` | add or remove members, change the cluster's server and member config | server `admin` |
| `cluster.view` / `cluster.configure` | see the cluster / IncusCloud's settings for it (balancing, labels) | server `viewer` / IncusCloud API |
| `tenant.view` / `tenant.manage` / `tenant.members` / `tenant.quota` | see / rename / manage members / set quotas (`tenant.quota` within a tenant sets users' quotas, not the tenant's) | IncusCloud API |
| `acl.view` / `acl.manage` | read / change the entries at and below the path | IncusCloud API |
| `platform.users` / `platform.settings` / `platform.audit` | users, groups and service accounts / enrolment, backup targets, global settings / the audit and gateway logs | IncusCloud API |

**Ownership.** Some roles hold privileges only on what the subject owns. The owner of an instance, volume, backup or Kubernetes cluster is the user or service account that created it.
- IncusCloud records the owner in its database. That record is authoritative.
- It also mirrors the owner to `user.incuscloud.owner`, for display only.
- Creates through IncusCloud know the owner directly. Creates made straight against a cluster are attributed from the Incus lifecycle event's `requestor`, which is the IncusCloud user id because Incus's OIDC user name is the token's subject.

### Roles

Roles are built in and read-only; there are no custom roles. Each role is a fixed set of privileges, assigned on a path.

| Role | Typical path | Privileges |
| --- | --- | --- |
| **Administrator** | `/` | everything |
| **Operator** | `/` | everything except `acl.manage`, `platform.users`, `platform.settings` |
| **Cluster owner** | `/clusters/<c>` | everything on that cluster, including `node.provision` and `acl.manage` there |
| **Group owner** | `/clusters/<c>/groups/<g>` | everything on that group's members and the instances on them, including `node.maintain` and `acl.manage` there; not `node.provision` |
| **Unrestricted user** | `/clusters/<c>` or `/clusters/<c>/groups/<g>` | every workload privilege there (instances, storage, networks, images, projects, backups, Kubernetes, `placement.choose`); no `node.*`, `cluster.configure` or `acl.*` |
| **User** | `/tenants/<t>` | `instance.create`, `storage.allocate`, `backup.create`, `k8s.provision`, and on **what they own** every instance, backup and Kubernetes privilege; `network.use`; `*.view` on the tenant's shared objects (networks, images, profiles) |
| *Tenant admin* (proposed) | `/tenants/<t>` | everything in the tenant, `tenant.members`, `tenant.quota` for users' quotas, `acl.manage` within the tenant |
| *Auditor* (proposed) | any | every `*.view`, `acl.view`, `platform.audit` at and below the path |
| *No access* (proposed) | any | nothing; it overrides what is inherited (most-specific-wins) |

**Warning: Cluster owner is root on those hosts.** `node.provision` is Incus server `admin`. That can create privileged containers and so reach the hosts. Give it only to people who already run those machines, never to an untrusted tenant. Unrestricted user stays inside restricted projects, so it is safe for a tenant.

### Subjects

- **Users** and **service accounts.**
  - A service account's effective rights are its own entries **intersected** with its owner's current rights, as in PCD and Proxmox.
  - Disabling the owner disables its accounts.
  - A platform service account with no owner, created by an administrator, holds its own entries only. This is the user's "admin service account with full permissions".
- **Groups**, IncusCloud's own: managed under Platform › Users › Groups.
- **Each tenant's default group** (`<tenant>/members`) is created with the tenant. It always contains exactly the tenant's members, and it cannot be edited by hand. This is the answer to "would a default tenant group be enough?": yes. It replaces "tenants as subjects", so "every member of acme may use group gpu on cluster-d" is one entry on `/clusters/cluster-d/groups/gpu` for `acme/members`.

### Resolution (Proxmox's)

1. For a subject and a path, gather the entries on the path and on its ancestors (both parents, for an instance), each with `propagate`. Count entries for the subject itself, its groups, its tenants' default groups and, for a service account, then intersect with its owner.
2. **The most specific path with any matching entry wins.** Its roles' privileges are the result for that path. At that path, the user's own entries beat its group entries. *No access* there means nothing.
3. An entry with `propagate: false` applies only to its own path.
4. For an instance with two parents (project and group), each side is resolved separately and the results are **combined (union)**. This lets a group owner manage what runs on their nodes without being in each project. A *No access* on the instance itself still wins, because it is more specific than either side.

### Placement and the single pool

- **By default the cloud is one pool.** A tenant runs on the clusters it is placed on (as today), and IncusCloud chooses the member when no one picks: today's rule is the most free memory, with labels.
- **`placement.choose`** at a cluster or group lets a subject pick where its instances go there. Without it, every create and move is placed automatically.
- **Limiting a tenant to clusters or groups** is enforced by Incus too:
  - the tenant's placements decide which clusters it runs on;
  - its project's `restricted.cluster.groups` is set to the groups its entries reach, using IncusCloud-managed groups when an entry is on a whole cluster.
- **Per-user limits that are narrower than the tenant's** are enforced by IncusCloud, in its API and in the gateway, but not by Incus, because Incus restrictions are per project. See question 3.

### Quotas

Quotas stay one pool per tenant, across clusters, as in P9. New fields are added, and users get their own quotas.

| Quota | Unit | Enforced by |
| --- | --- | --- |
| instances, cpu, memory, disk (existing) | count, cores, bytes | Incus project limits + IncusCloud (P9) |
| **per-instance maximum** cpu, memory, root disk | cores, bytes | Incus project `limits.*` per instance (`restricted.*` / profile caps) + IncusCloud create checks |
| **snapshots** | count per tenant | IncusCloud, for snapshots made through it. A count limit on direct Incus snapshots is to be verified in Incus (if there is none, the reconciler reports overuse and blocks new snapshots through IncusCloud) |
| **backups** | count and total bytes per tenant | IncusCloud (it makes every backup and knows each object's size) |
| **Kubernetes clusters** | count per tenant (their nodes already count as instances) | IncusCloud |
| **user quotas** | instances, cpu, memory, backups, per user inside a tenant | IncusCloud; set by whoever has `tenant.quota` on the tenant (a tenant admin), never above the tenant's own |

A tenant's quotas are set by platform operators (`tenant.quota` on `/` or `/tenants`); a tenant admin divides them among users.

### Identity providers

Recommendation (the user had no opinion), as in PCD:
- **Later phase.** IncusCloud groups first.
- **Then:** the identity provider's `groups` claim is mapped onto IncusCloud groups and re-evaluated at every sign-in and token refresh. Mappings are rules of the form "claim value X → group Y", so membership follows the identity provider.
- **Local and federated users coexist.**

### Enforcement

- **IncusCloud's API.** One function, `can(subject, privilege, path)`, replaces `needRole` and `can_access` everywhere. Lists are filtered by the `*.view` privilege on each item.
- **Incus (through the gateway, the facade and direct cluster access).** IncusCloud keeps writing OpenFGA grants on each cluster, so Incus enforces them too.
  - Every distinct (object, set of entitlements) in use becomes a group `incuscloud-acl-<hash>`, and the users who resolve to it are its members.
  - Narrowing (most-specific-wins, ownership) is computed by IncusCloud, so Incus never needs a deny rule.
  - An entry on an instance gives an instance relation (`viewer`, `user` or `operator`, from its privileges), never a project one: in Incus a project's `can_view` comes only from project `viewer`, which shows every instance in it (decision 5). An instance that gives less than its project replaces the project relation by relations on its other instances.
  - The facade fills in what Incus then refuses: `GET /1.0/projects/<p>` answers a project object for a caller who may see the project by IncusCloud's permissions, and project lists include such projects. A create in a merged project goes to one of the clusters that has it, those included.
- **Ownership and group membership move.** Instances change owners rarely, but they move between members and groups. The reconciler follows the lifecycle events (create, move, delete) and rewrites the per-instance grants. A moved instance keeps its old grants for at most one event round-trip, or one reconcile interval if events are missed.
- **Node privileges** (`node.maintain`, `node.provision`) are server-level in Incus. IncusCloud's API checks them per group or cluster; on Incus itself, `node.provision` is server `admin`.

### Console

- **Platform › Permissions:**
  - Entries: path, subject, role, propagate.
  - Roles: read-only, each with its privileges listed.
  - Groups, with the tenants' default groups.
  - **Check:** subject + path → effective privileges, and which entry decided them.
- **Access tabs** on clusters, groups, projects, instances, tenants and Kubernetes clusters show:
  - the entries there and those inherited down to it, with add and remove for holders of `acl.manage`;
  - the effective result.
- The tree, tabs and actions follow privileges. Someone limited to two instances sees their cluster, the project, and those two instances.
- **Tenant page:** users' quotas, and the backup and snapshot usage.

## Migration

Today's roles become entries, with no change in behaviour:

| Today | Becomes |
| --- | --- |
| platform admin | Administrator on `/` |
| platform operator | Operator on `/` |
| platform viewer | Auditor on `/` |
| tenant owner / admin | Tenant admin on `/tenants/<t>` (owner also keeps "owns the tenant": delete it, manage owners) |
| tenant member | User on `/tenants/<t>`, plus an *ownership backfill*: every instance and backup that exists is owned by its tenant's first owner, so nothing becomes unmanageable. Members today can manage every instance in the tenant, so this narrows them. **See question 2.** |
| tenant viewer | Auditor on `/tenants/<t>` |

The new quotas start unset, which means unlimited, as quotas are today.

## Decisions (the user, 2026-10-17)

1. *Tenant admin*, *Auditor* and *No access* are added to the bundled roles.
2. Migrated tenant members become *Unrestricted user* on their tenant, with every workload privilege there (the role table). On upgrade they gain backups, restores, replication, relocation and Kubernetes delete: the release notes say so.
3. Production makes cluster APIs reachable only through the gateway (a documented network policy), so every limit holds.
4. Leases are future work: a table of expiries and a scheduled worker (Elysia's cron) that powers off or deletes, per tenant, with extensions.
5. Users never see other users' instances. In Incus, `can_view` on a project comes only from project `viewer`, which also gives `viewer` on every instance in it, so a *User* gets no project `viewer`. They get `can_create_instances` and the volume and bucket creates on the project, `can_view` on each of its profiles, networks and images, and `operator` on what they own. IncusCloud's console shows the project page from its own records, since Incus refuses the project itself to them. (Measured on the dev stack, 2026-10-17.)

## Phasing

Each phase ships on its own:
1. The model, resolution and `can()`; today's roles migrated (no behaviour change); Platform › Permissions with Check; Access tabs read the new entries.
2. Ownership (recorded on create, from lifecycle events, backfilled); the *User* role; Incus grants for cluster, project and instance paths with visibility.
3. Groups, including the tenants' default groups; group paths (`/clusters/<c>/groups/<g>`) with Group owner, Unrestricted user and `placement.choose`; `restricted.cluster.groups`.
4. Quotas: per-instance maximums, snapshot count, backups (count and bytes), Kubernetes cluster count, users' quotas.
5. Identity-provider group mapping.
6. Later: leases (decision 4).
