# IncusCloud console: inventory-tree navigation

Status: decided 2026-10-12. The user said "document this decision and go with it".
Supersedes: the navigation parts of `docs/superpowers/plans/2026-10-12-incuscloud-console.md`, namely Task 4's tree pane beside the instance list and Task 5's project-selector work.

## Why

The user tried the console, which had Incendio's menu, a project selector, a Cluster select and a tree pane beside the instance list. They found it confusing:

- **The Cluster select comes and goes.** It disappears on platform pages, yet the project selector stays.
- **The instance tree seems out of place.** It spans every cluster, but it sits inside Incendio's view, which reads as one cluster's.
- **Same-named projects are ambiguous.** "default on 3 clusters" suggested the shared name had some meaning, such as sync or migration. It has none.

The user compared Proxmox, vCenter, OpenNebula, Xen Orchestra, OpenStack and Nutanix Prism, and asked for a uniform inventory tree.

## Decision

A vCenter-style console:

- **The tree is always visible** at the top of the sidebar.
- **The tree selects an object.** The content area shows that object.
- **One tab row.** Exactly one row of tabs is on screen, and it belongs to the selected object. Tab rows are never stacked. A breadcrumb (`cluster-d › default › web-d1`) shows where the object sits.
- **Complex pages get a second side menu** inside a tab ("Configure", Incendio's configuration forms). This matches vCenter's tree → tabs → side menu.
- **Each kind of object always has the same tabs,** whichever tree view it was reached from.
- **Projects are never merged.** A project is one project on one cluster (`name@cluster`). A shared name means nothing, except that a tenant's projects are all named after the tenant and share its quota. That is IncusCloud bookkeeping, not an Incus feature.

## Layout

```
+----------------+---------------------------------------------+
| IncusCloud     | cluster-d › default                         |
| Inst Proj Memb |  Instances  Profiles  Networks  Storage     |
| Net  Stor      |  Images  Usage  Configure          More ▾   |
| v All clusters |---------------------------------------------|
|  > cluster-b   |  (the selected tab: an Incendio or          |
|  v cluster-d   |   IncusCloud page)                          |
|    v default < |                                             |
|        web-d1  |                                             |
|----------------|                                             |
| Kubernetes     |                                             |
| Clusters …     |                                             |
| Account        |                                             |
+----------------+---------------------------------------------+
```

**Sidebar.** This is IncusCloud's own component, built from Incendio's navigation classes (`l-navigation`, `p-side-navigation`, dark panel) so that it looks like Incendio. From top to bottom:

1. The logo.
2. The **view tabs**: Instances, Projects, Nodes, Networks, Storage. The chosen view is remembered per browser.
3. The **tree**, which scrolls on its own.
4. **Platform**: Kubernetes, Tenants, Jobs, Replication, Backups, Balancing, Backup targets, Users, Service accounts, Audit log, Gateway log. Each is shown by role, as today. "Dashboard" and "Clusters" are not here, because they are tabs of the tree's root.
5. **Account**: Profile and Sign out.

Each group is labelled, and the Platform and Account groups stay pinned at the bottom.

**Sidebar width.** It is 240px by default and can be dragged up to 360px. The width is remembered per browser. The sidebar collapses as Incendio's does.

**Content.** A breadcrumb title, then the selected object's tab row, then the tab's page. Tabs that do not fit collapse into "More ▾" rather than wrapping. The tab row uses Incendio's tab component and is square, per the IncusCloud UI style.

## Objects, URLs and tabs

The URL is the selection: reloading or sharing a URL restores the same object and tab. Incendio's own routes are kept wherever one exists, so its pages work unchanged.

Incus's own word is used throughout: a cluster has **members** (not "nodes").

| Object | URL | Tabs |
|---|---|---|
| **All clusters** (root) | `/` and `/all/<tab>` | Summary (the Dashboard) · Clusters (operators) · Instances (every cluster and project) · Kubernetes (every cluster's, with a Cluster column) · Warnings (with a Cluster column) |
| **Cluster** | `/inventory/<cluster>/<tab>[/<sub>]` | Summary · Members · Groups · Projects · Networks · Storage · Kubernetes · Operations · Access · Configure |
| **Member** | `/ui/cluster/member/<m@cluster>[/<tab>]` | Incendio's member page with its own tab row |
| **Project** | `/ui/project/<p@cluster>/<section>` | Instances · Profiles · Networks · Storage · Images · Usage · Access · Configure |
| **Kubernetes cluster** | `/kubernetes/<id>[/<tab>]` | Summary · Nodes · Activity · Kubeconfig |
| **Instance** | `/ui/project/<p@cluster>/instance/<name>[/<tab>]` | Incendio's instance page, with its own tabs |
| Network, pool, profile | Incendio's detail routes under the owning project | Incendio's own tabs |

**Objects with their own tab row.** Member, instance, network, pool and profile are Incendio detail pages that already have a tab row. The console adds only the breadcrumb above them and no second row, which keeps the one-tab-row rule.

**Tabs with a side menu.** A tab that holds several pages shows them in a side menu beside the page (as vSphere's Configure tab does). The side menu is the same component everywhere: square rows, the current one marked. Every page Incendio's own navigation offered for a cluster or a project is reachable this way; none is dropped.

| Tab | Side menu (each item renders an Incendio page unless noted) |
|---|---|
| Cluster › Groups | Cluster groups (`/ui/cluster/groups`) · Placement groups (`/ui/project/<p>/placement-groups`, with a picker over the cluster's projects) |
| Cluster › Networks | Networks · ACLs · Address sets · Zones · IPAM (each in the `default` project) · Integrations (`/ui/network-integrations`) |
| Cluster › Storage | Pools · Volumes · Buckets · Custom ISOs (the `default` project) |
| Cluster › Access | Who has access (IncusCloud's page: platform roles; tenants placed here, their members and the Incus relation each gets) · Identities · Groups · IdP groups · OpenFGA grants · Check |
| Cluster › Configure | IncusCloud (operators; IncusCloud's page) · Server settings · Cluster links · Replicators · Certificates · Logging · ACME · Warnings |
| Project › Networks | Networks · ACLs · Address sets · Zones · IPAM |
| Project › Storage | Pools · Volumes · Buckets · Custom ISOs |
| Project › Access | IncusCloud's page: the tenant whose project it is, its members and roles, and the Incus relation each role gives |
| Project › Configure | Configuration · Placement groups (replicators are cluster-wide: Cluster › Configure) |

**Rendering cluster tabs.** A cluster tab whose content is an Incendio page renders that page under the console URL, using a synthetic location. For example, `/inventory/cluster-d/members` renders Incendio's `/ui/cluster/members`, and `/inventory/cluster-d/networks` renders `/ui/project/default@cluster-d/networks`. Links inside such a page go to Incendio's real routes, which select the object they open. A link to a network, for instance, selects that network's project.

**Breadcrumbs.** Each crumb is a link that selects that object:
- `All clusters › cluster-d`
- `… › cluster-d › d1` for a member
- `… › cluster-d › default` for a project
- `… › default › web-d1` for an instance

## Tree views

Each view is the root "All clusters", then a set of clusters, then:

| View | Below each cluster | Clicking |
|---|---|---|
| Instances | member → instance | a member opens the member; an instance opens the instance |
| Projects | project → instance, Kubernetes cluster | a project opens the project (Instances tab); a Kubernetes cluster opens it |
| Members | member | the member |
| Networks | network | the network (in its project) |
| Storage | pool | the pool |

Every row shows its kind's icon (cluster, member, container, virtual machine, Kubernetes cluster, project, network, pool) tinted by its status: green running/online/ready, grey stopped, amber degraded/evacuated/busy, blue frozen, red error/offline. Vanilla's icons are background images that cannot be tinted, so these are IncusCloud's own small square SVGs drawn in `currentColor`. A count (`running/total`) follows where it applies. Clicking a cluster or the root opens it, whichever view is active. A row's chevron only expands it. Clicking its label selects it.

**Data sources.** The tree's own fetches go through the federation facade with an explicit "all clusters" scope (see below), under its own query keys (`["inventory", …]`). It therefore never reads, and never poisons, the cache of the page being shown.
- Clusters: `/api/v1/clusters`, for the clusters the caller may see, including clusters that answer nothing right now.
- Members: `/1.0/cluster/members?recursion=1`.
- Kubernetes clusters: `/api/v1/kubernetes` (Projects view).
- Projects: `/1.0/projects?recursion=1`, qualified entries only.
- Instances: `/1.0/instances?all-projects=true&recursion=1`.
- Networks: `/1.0/networks?project=default@<c>`, per cluster, on demand.
- Pools: `/1.0/storage-pools?recursion=1`.

A view loads only what it shows. A cluster that fails to answer shows its status icon and a message, never an empty list.

## Federation changes

1. **Merged projects go away.** `/1.0/projects` lists each cluster's projects, qualified, with no merged entries.
   - An unqualified project in a console URL (`/ui/project/default/…`) redirects to the project on the first cluster that has it.
   - "All projects" (`all-projects=true`) still spans every cluster.
2. **A scope from the console page.** Requests are routed in this order:
   1. A qualifier in the request's own path or query.
   2. The `X-IncusCloud-Scope` header: `all`, or a cluster name.
   3. The page's Referer, either a qualified segment or `/inventory/<cluster>/…`.
   4. Otherwise, every cluster.

   The always-merged paths (`/1.0`, `/1.0/projects`, `/1.0/operations`, `/1.0/warnings`, `/1.0/events`) follow this order too. On a cluster's or project's page they are that cluster's, so Incendio sees that cluster's real `/1.0` (its extensions and config) and its operations and warnings. Merging happens only when nothing names a cluster.
3. **Global caches.** Incendio's query cache entries that are global (`cluster`, `storage`, `projects`, `operations`, `warnings`, `settings`…) are dropped when the page's cluster changes. The current `GLOBAL_KEYS` mechanism is extended to cover them.

## What goes away

- **Navigation:** Incendio's navigation (the project selector, the Project and Infrastructure sections) in the console, the Cluster select, and the section labels added on 2026-10-12.
- **Instance list:** the tree pane beside it (`InventoryTree` as an aside) and the summary tiles above it. Those tiles move to the cluster's Summary tab.
- **Merged projects,** in both the facade and the UI.
- **Navigation extension hooks:** the ones that only served the old navigation (`afterProjectSelector`, `serverLabel`, `projects`). They are removed from `packages/ui` when nothing uses them.

## Tenants

Tenant members see the same console, limited to the clusters they are placed on and their own projects. They see members (decided 2026-10-12) and may target them. Platform-only tabs are hidden by role, as today: the root's Clusters tab and the cluster's Configure tab show their IncusCloud parts to operators only.

## Kept

- **Incendio's pages unchanged** inside tabs: instance, profile, network, storage, image and configuration pages.
- **Create instance:** Incendio's create form with Cluster and Project pickers. From a selected member, the target is preselected.
- **Theme:** one theme on every page, with the switcher on the Profile page.
- **Platform pages:** Tenants, Jobs and the other platform pages as they are. Kubernetes leaves the Platform list: it is an inventory object.

## Kubernetes in the console

Kubernetes clusters are inventory objects, not a platform page:
- the root's Kubernetes tab lists every cluster's, with Cluster, Tenant, Member, Version, Nodes (ready/total) and Status columns, and "Create";
- a cluster's Kubernetes tab lists that cluster's, and "Create" preselects the cluster;
- the Projects view shows a tenant project's Kubernetes clusters under it;
- a Kubernetes cluster's page has Summary (status, endpoint, version, sizes, member, tenant), Nodes (each Cluster API machine: role, its Incus instance linked to Incendio's instance page, phase, version, ready), Activity (its jobs) and Kubeconfig. Scale, Upgrade, Download kubeconfig and Delete are buttons above the tabs, as on Incendio's Kubernetes cluster page;
- the create form uses Incendio's sectioned form layout (a side menu of sections: Placement, Cluster, Nodes) instead of one long column.

The server adds `GET /api/v1/kubernetes/:id/nodes`: the cluster's Machines from the management cluster, each with its Incus instance name, role, phase, version and readiness.

## Access

IncusCloud's access model is unchanged here: platform roles (admin, operator, viewer) and tenant roles (owner, admin, member, viewer). The reconciler writes them into each cluster's OpenFGA store as `incuscloud-*` groups: platform roles on `server:incus`, tenant roles as `operator` (owner, admin, member) or `viewer` on the tenant's project there. The console shows this where it applies (each cluster's and project's Access tab) and keeps Incendio's permission pages per cluster for grants IncusCloud does not own. Extending the model (roles scoped to one cluster, user groups) is a separate decision, recorded in QUESTIONS.md.

## Testing

- **Unit tests** for:
  - the selection: URL → object, breadcrumb and tab set;
  - each view's tree build;
  - facade scope resolution (qualifier > header > Referer > all, the always-merged paths included);
  - the unqualified-project redirect.
- **Component tests:**
  - the sidebar (views, tree, pinned Platform and Account, role filtering);
  - the tab row (overflow into More);
  - a cluster tab rendering an Incendio page under the console URL with the right cluster.
- **Live checks** on cluster-b, -c and -d (d has two members), in the browser, as admin and as a tenant member:
  - every view and object type;
  - Incendio's operations and warnings on a cluster page come from that cluster only;
  - create from a member;
  - light and dark themes.

## Later (not in this change)

- Pool and member names inside a one-cluster page are still qualified (`default@cluster-b`). They could be shown short where the cluster is unambiguous.
- Image registries and the OS page stay hidden: they are about the host Incendio runs on, not a cluster.
