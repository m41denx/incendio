# IncusCloud inventory-tree navigation: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console's Incendio navigation, project selector and Cluster select with a vCenter-style sidebar. The sidebar has view tabs and an inventory tree, with Platform and Account pinned below it. Selecting an object shows its breadcrumb and a single tab row above the existing Incendio or IncusCloud page.

**Architecture:**
- **Selection from the URL.** A pure module turns the URL into the selected object, its tabs and its breadcrumb.
- **The tree.** Another pure module builds each tree view from facade data, fetched with an explicit all-clusters scope.
- **Shell layout.** The Shell renders the new sidebar, then an object frame (a `div.l-main` holding the breadcrumb, the tabs and the page). Incendio's pages, each its own `<main class="l-main">`, render inside it.
- **Cluster tabs.** A cluster tab renders Incendio's routes at a synthetic location (`<Routes location>`). The facade routes those pages' API calls to the cluster through the Referer `/inventory/<cluster>/…`.

**Tech Stack:**
- Web: React 18, react-router 7.16, @tanstack/react-query, @canonical/react-components and Incendio's `packages/ui` (via vite aliases). Tests run with vitest and Testing Library.
- Server: Bun, Elysia and the federation facade. Tests run with `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-12-incuscloud-inventory-navigation-design.md`

## Global Constraints

- One tab row on screen at a time. Objects whose Incendio page has its own row (node, instance, network, pool, profile) get only a breadcrumb from the console.
- The URL is the selection. Reloading or sharing it restores the same object and tab.
- Projects are never merged. `/1.0/projects` has no merged entries, and an unqualified project in a console URL redirects to the project on the first cluster that has it.
- Facade routing order: a qualifier in the request's path or query, then the `X-IncusCloud-Scope` header (`all` or a cluster), then the Referer (a qualified segment, or `/inventory/<cluster>/…`), then every cluster. The always-merged paths follow this order too, except `/1.0/events`, which is always fanned in (websocket handshakes carry no reliable Referer).
- UI style: Incendio's components and classes. Custom pieces are square and metro (memory `incuscloud-ui-style`). One theme everywhere.
- Never print secrets; the admin password is passed only as `"$(cat …/.dev/admin-password)"`.
- Commits end with the session trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WipzZrnGShV48cF5E4d7t7
  ```
- After changing `packages/ui`: `cd packages/ui && bun run build && sudo rsync -a --delete build/ui/ /opt/incus/ui/`.

## Review Focus

1. **A tenant member** may see `/api/v1/clusters` and only some projects. The tree must show only their clusters and projects and never fail because of a 403. Owner: Task 3, test "tenant tree".
2. **A cluster that does not answer** must still appear in the tree with an error status. A view with no data must not crash, and the cluster's tabs must still open. Owner: Task 3, test "unreachable cluster".
3. **A standalone cluster** (cluster-b, cluster-c) under a cluster tab. Incendio's members page must list its one synthesized member, not say "not clustered". Owner: Task 1, test "standalone one-cluster /1.0 reports clustered".
4. **Switching between clusters' tabs** (`/inventory/cluster-b/storage` then `/inventory/cluster-c/storage`) must not show cluster-b's cached pools. Owner: Task 4, test "global caches dropped on cluster change".
5. **Old links** (`/instances`, `/clusters/:id`, `/ui/project/default/…`) must land on the matching new object instead of a 404. Owner: Task 4, test "old routes redirect".

---

### Task 1: Facade scope from the console, no merged projects

**Files:**
- Modify: `incuscloud/server/src/federation/rewrite.ts` (`targetOf`)
- Modify: `incuscloud/server/src/federation/handler.ts` (EVERYWHERE routing; standalone `/1.0`)
- Modify: `incuscloud/server/src/federation/merge.ts` (`/1.0/projects` without merged entries)
- Test: `incuscloud/server/src/federation/rewrite.test.ts`, `incuscloud/server/src/federation/handler.test.ts`

**Interfaces:**
- Produces: `targetOf(pathAndQuery: string, referer: string | undefined, clusters: string[], scope?: string): Target`. `scope` is the `X-IncusCloud-Scope` header value: `"all"` forces `{kind: "all"}`, and a known cluster name gives `{kind: "one"}`.

- [ ] **Step 1: failing tests**

In `rewrite.test.ts`:
```ts
test("scope: a qualifier wins, then the scope header, then the referer (qualified or /inventory/<cluster>), else all", () => {
  const cs = ["c1", "c2"];
  expect(targetOf("/1.0/instances?project=p%40c1", "https://x/inventory/c2/nodes", cs, "c2")).toEqual({ kind: "one", cluster: "c1" });
  expect(targetOf("/1.0/cluster/members", "https://x/inventory/c2/nodes", cs, "all")).toEqual({ kind: "all" });
  expect(targetOf("/1.0/cluster/members", undefined, cs, "c1")).toEqual({ kind: "one", cluster: "c1" });
  expect(targetOf("/1.0/cluster/members", "https://x/inventory/c2/nodes", cs)).toEqual({ kind: "one", cluster: "c2" });
  expect(targetOf("/1.0/cluster/members", "https://x/inventory/nope/nodes", cs)).toEqual({ kind: "all" });
  expect(targetOf("/1.0/cluster/members", "https://x/all/instances", cs)).toEqual({ kind: "all" });
});
```
In `handler.test.ts`:
```ts
test("always-merged paths are one cluster's on that cluster's pages, and every cluster's otherwise", async () => {
  const fromPage = await call(admin, "/1.0/warnings", { referer: `${base}/inventory/c1/configure/warnings` });
  expect(fromPage.status).toBe(200);
  expect(m1.seen.at(-1)!.url).toBe("/1.0/warnings");
  expect(m2.seen.some((s) => s.url === "/1.0/warnings")).toBe(false);
  const tree = await call(admin, "/1.0/projects?recursion=1", { referer: `${base}/inventory/c1`, headers: { "x-incuscloud-scope": "all" } });
  expect(tree.body.metadata.map((p: any) => p.name).sort()).toEqual(["acme@c1", "acme@c2", "beta@c1", "default@c1", "default@c2"]);
});

test("projects are never merged: each cluster's, qualified", async () => {
  const r = await call(alice, "/1.0/projects");
  expect(r.body.metadata.every((p: string) => p.includes("%40") || p.includes("@"))).toBe(true);
});

test("a standalone cluster's own /1.0 reports clustered, as its synthesized member views do", async () => {
  const r = await call(admin, "/1.0", { referer: `${base}/inventory/c2` });
  expect(r.body.metadata.environment.server_clustered).toBe(true);
});
```
(The `call` helper may need `referer` and `headers` options: add them next to the existing `origin` option.)

- [ ] **Step 2: run them and watch them fail.** Run `cd incuscloud/server && bun test src/federation`. They should fail on the extra arguments and the merged entries.

- [ ] **Step 3: implement**
- **`targetOf`:**
  - If the request names a cluster itself, keep the current result.
  - Otherwise, if `scope === "all"`, return all. If `scope` is a known cluster, return one.
  - Otherwise use the referer. `clustersIn(path)` comes first; then `^/inventory/([^/]+)` when `decodeURIComponent($1)` is in `clusters`.
- **`handler.ts`:**
  - Read `req.headers["x-incuscloud-scope"]` and pass it to `targetOf`.
  - Replace `EVERYWHERE.has(path) && method === "GET" ? all : targetOf(…)` with `targetOf(…)` for every path. Keep the `kind: "all"` merge for EVERYWHERE paths when nothing names a cluster, and keep the `/1.0/events` upgrade fanned in.
  - In the one-cluster JSON rewrite of `GET /1.0` for a standalone server (`synthetic` says `standalone`), set `metadata.environment.server_clustered = true` before replying.
- **`merge.ts`:** in `/1.0/projects`, return `sync(list)` without the merged entries. Keep `mergedProject` only for `GET /1.0/projects/<unqualified>` (still reachable through old links).

- [ ] **Step 4:** Run `bun test src/federation` and `bunx tsc --noEmit -p .`. Everything should pass. Fix any older tests that expected merged entries (`projects: every cluster's…`), since the spec changed them.

- [ ] **Step 5: commit** with the message `incuscloud: the facade takes its scope from the console page; projects are never merged`.

### Task 2: The selection model (URL → object, tabs, breadcrumb)

**Files:**
- Create: `incuscloud/web/src/console/object.ts`, `incuscloud/web/src/console/object.spec.ts`

**Interfaces:**
- Produces:
```ts
export type Obj =
  | { kind: "root"; tab: "summary" | "clusters" | "instances" | "warnings" }
  | { kind: "cluster"; cluster: string; tab: "summary" | "nodes" | "projects" | "networks" | "storage" | "operations" | "configure"; sub?: string }
  | { kind: "node"; cluster: string; node: string /* name@cluster */ }
  | { kind: "project"; cluster: string; project: string /* name@cluster */; tab: "instances" | "profiles" | "networks" | "storage" | "images" | "usage" | "configure" }
  | { kind: "instance"; cluster: string; project: string; name: string }
  | { kind: "network" | "pool" | "profile"; cluster: string; project: string; name: string }
  | { kind: "none" };
export function objectOf(pathname: string): Obj;
export interface Tab { label: string; to: string; active: boolean }
export function tabsOf(o: Obj, o2: { operator: boolean }): Tab[]; // [] for objects with their own row
export interface Crumb { label: string; to: string }
export function crumbsOf(o: Obj): Crumb[];
export function clusterOfObj(o: Obj): string; // "" for root, none
```
- URL map (spec table):
  - `/` → root summary; `/all/{clusters,instances,warnings}`.
  - `/inventory/:c[/:tab[/:sub]]`.
  - `/ui/cluster/member/:node[/…]` → node.
  - `/ui/project/:p@c/…` → project or one of its children. Sections map to project tabs:
    - `instances[/create]` → instances
    - `profiles` → profiles
    - `networks`, `network-acls`, `network-zones`, `network-ipam`, `network-address-sets` → networks
    - `storage/*` → storage
    - `local-images` → images
    - `usage` → usage
    - `configuration*`, `access`, `placement-groups`, `replicator/*` → configure

    Detail pages map to child objects:
    - `instance/:n` → instance
    - `network/:n` → network
    - `storage/pool/:n` → pool
    - `profile/:n` → profile
  - Anything else → none.

- [ ] **Step 1: failing tests** in `object.spec.ts`:
```ts
import { expect, test } from "vitest";
import { clusterOfObj, crumbsOf, objectOf, tabsOf } from "./object";

test("URLs select objects", () => {
  expect(objectOf("/")).toEqual({ kind: "root", tab: "summary" });
  expect(objectOf("/all/warnings")).toEqual({ kind: "root", tab: "warnings" });
  expect(objectOf("/inventory/cluster-d")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "summary" });
  expect(objectOf("/inventory/cluster-d/configure/groups")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "configure", sub: "groups" });
  expect(objectOf("/ui/cluster/member/d1%40cluster-d/hardware")).toEqual({ kind: "node", cluster: "cluster-d", node: "d1@cluster-d" });
  expect(objectOf("/ui/project/default%40cluster-d/storage/volumes")).toEqual({ kind: "project", cluster: "cluster-d", project: "default@cluster-d", tab: "storage" });
  expect(objectOf("/ui/project/default%40cluster-d/network-acls")).toMatchObject({ kind: "project", tab: "networks" });
  expect(objectOf("/ui/project/default%40cluster-d/configuration/limits")).toMatchObject({ kind: "project", tab: "configure" });
  expect(objectOf("/ui/project/default%40cluster-d/instance/web-d1/terminal")).toEqual({ kind: "instance", cluster: "cluster-d", project: "default@cluster-d", name: "web-d1" });
  expect(objectOf("/ui/project/default%40cluster-d/network/incusbr0")).toMatchObject({ kind: "network", name: "incusbr0" });
  expect(objectOf("/ui/project/default%40cluster-d/storage/pool/default%40cluster-d")).toMatchObject({ kind: "pool" });
  for (const p of ["/kubernetes", "/tenants/x", "/ui/project/default/profiles", "/profile"]) expect(objectOf(p)).toEqual({ kind: "none" });
});

test("tabs: one row per object; operators see the root's Clusters; objects with their own row get none", () => {
  const labels = (p: string, operator = true) => tabsOf(objectOf(p), { operator }).map((t) => (t.active ? `[${t.label}]` : t.label));
  expect(labels("/")).toEqual(["[Summary]", "Clusters", "Instances", "Warnings"]);
  expect(labels("/", false)).toEqual(["[Summary]", "Instances", "Warnings"]);
  expect(labels("/inventory/cluster-d/nodes")).toEqual(["Summary", "[Nodes]", "Projects", "Networks", "Storage", "Operations", "Configure"]);
  expect(labels("/ui/project/default%40cluster-d/local-images")).toEqual(["Instances", "Profiles", "Networks", "Storage", "[Images]", "Usage", "Configure"]);
  expect(tabsOf(objectOf("/ui/project/default%40cluster-d/storage/pools"), { operator: true }).find((t) => t.label === "Storage")!.to).toBe("/ui/project/default%40cluster-d/storage/pools");
  for (const p of ["/ui/cluster/member/d1%40cluster-d", "/ui/project/default%40cluster-d/instance/web-d1"]) expect(tabsOf(objectOf(p), { operator: true })).toEqual([]);
});

test("breadcrumbs lead back up the tree", () => {
  expect(crumbsOf(objectOf("/ui/project/default%40cluster-d/instance/web-d1"))).toEqual([
    { label: "All clusters", to: "/" },
    { label: "cluster-d", to: "/inventory/cluster-d" },
    { label: "default", to: "/ui/project/default%40cluster-d/instances" },
    { label: "web-d1", to: "/ui/project/default%40cluster-d/instance/web-d1" },
  ]);
  expect(crumbsOf(objectOf("/ui/cluster/member/d1%40cluster-d")).map((c) => c.label)).toEqual(["All clusters", "cluster-d", "d1"]);
  expect(crumbsOf(objectOf("/"))).toEqual([{ label: "All clusters", to: "/" }]);
  expect(clusterOfObj(objectOf("/inventory/cluster-c/storage"))).toBe("cluster-c");
  expect(clusterOfObj(objectOf("/all/instances"))).toBe("");
});
```
- [ ] **Step 2:** Run `cd incuscloud/web && bunx vitest --run src/console/object.spec.ts`. It should fail because the module is missing.
- [ ] **Step 3:** Implement `object.ts`:
  - Parse with regexes per the URL map, and decode segments with a `safeDecode`.
  - Tab tables are constant arrays of `[label, path suffix]`.
  - Root:
    - `Summary` → `/`
    - `Clusters` → `/all/clusters` (operator only)
    - `Instances` → `/all/instances`
    - `Warnings` → `/all/warnings`
  - Cluster: `/inventory/<c>` plus `""` for Summary, or `/nodes`, `/projects`, `/networks`, `/storage`, `/operations`, `/configure`.
  - Project: `/ui/project/<enc p>/` plus `instances`, `profiles`, `networks`, `storage/pools`, `local-images`, `usage`, `configuration`.
- [ ] **Step 4:** Run the tests. They should pass.
- [ ] **Step 5: commit** with the message `incuscloud web: the console's selection: URL to object, tabs and breadcrumb`.

### Task 3: Tree views and their data

**Files:**
- Create: `incuscloud/web/src/console/views.ts`, `incuscloud/web/src/console/views.spec.ts`, `incuscloud/web/src/console/useInventory.ts`
- Modify: `incuscloud/web/src/api/client.ts`. `request` gains an optional `headers`, or a sibling `incusAll<T>(path)` is added that sends `x-incuscloud-scope: all` and returns `metadata`.

**Interfaces:**
- Produces:
```ts
export type View = "instances" | "projects" | "nodes" | "networks" | "storage";
export interface TreeItem { key: string; label: string; icon: string; to: string; count?: string; status?: string; children?: TreeItem[] }
export interface InventoryData {
  clusters: Array<{ name: string; status: string }>;   // every cluster the caller can see
  members: Array<{ server_name: string; status: string }>;
  projects: Array<{ name: string }>;                   // qualified
  instances: Array<{ name: string; project: string; location: string; status: string }>;
  networks: Record<string, Array<{ name: string; managed: boolean }>>; // by cluster
  pools: Array<{ name: string; status: string }>;      // qualified name@cluster
}
export function buildView(view: View, d: InventoryData): TreeItem; // the root "All clusters"
export function useInventory(view: View): { root: TreeItem; isLoading: boolean; errors: string[] };
```
- [ ] **Step 1: failing tests** in `views.spec.ts`. These cover:
  - **instances view:** root → clusters (sorted) → nodes → instances. Counts show `running/total`. The `to` targets follow Task 2's URLs:
    - cluster → `/inventory/c`
    - node → `/ui/cluster/member/<enc>`
    - instance → `/ui/project/<enc p>/instance/<n>`
  - **projects view:** cluster → project → instance. A project's `to` is its instances list.
  - **nodes, networks, storage views:**
    - A network's `to` is `/ui/project/default%40c/network/<n>`.
    - A pool's `to` is `/ui/project/default%40c/storage/pool/<enc pool@c>`.
    - Unmanaged networks are left out.
  - **unreachable cluster:** a cluster present in `clusters` with no members still appears, with its status (for example `error`) and no children.
  - **tenant tree:** an empty `clusters` list (a tenant member gets 403) falls back to the clusters seen in qualified members and projects.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3:** Implement `buildView`, a pure function that reuses `clusterOf` and `nameOf` from `pages/inventory/tree.ts`.
  - `useInventory(view)` runs react-query queries keyed `["inventory", <what>]` through `incusAll`. Each view enables only the queries it shows:
    - members: always
    - instances: in the instances and projects views
    - projects: in the projects view
    - networks: in the networks view, one query per cluster
    - pools: in the storage view
  - Clusters come from `/api/v1/clusters` (403 → `[]`).
  - `staleTime` is 15s. The queries refetch on the `instance`/`operation` events Incendio's `Events` already dispatches, if a hook exists; otherwise they use `refetchInterval: 30_000`.
- [ ] **Step 4:** Run the tests. They should pass.
- [ ] **Step 5: commit** with the message `incuscloud web: inventory tree views over every cluster`.

### Task 4: Sidebar, object frame, console routes and redirects

**Files:**
- Create:
  - `incuscloud/web/src/console/Sidebar.tsx`
  - `incuscloud/web/src/console/Tree.tsx`
  - `incuscloud/web/src/console/ObjectFrame.tsx`
  - `incuscloud/web/src/console/IncendioAt.tsx`
  - `incuscloud/web/src/console/ClusterPages.tsx`: Summary, Projects and the Configure side menu.
  - `incuscloud/web/src/console/console.spec.tsx`
- Modify:
  - `incuscloud/web/src/components/Shell.tsx`: render the Sidebar instead of Incendio's `Navigation`, and wrap the Outlet in the ObjectFrame.
  - `incuscloud/web/src/App.tsx`: the new routes and the redirects.
  - `incuscloud/web/src/sass/styles.scss`: `.ic-sidebar`, `.ic-object`, `.ic-tabs`, `.ic-configure`.
  - `incuscloud/web/src/components/pageCluster.spec.ts`, plus `pageCluster` itself, which now uses `clusterOfObj(objectOf(pathname))`.

**Interfaces:**
- Consumes: `objectOf`, `tabsOf`, `crumbsOf`, `clusterOfObj` (Task 2); `useInventory`, `View` (Task 3).
- Produces:
  - `IncendioAt({ path }: { path: string })`: renders Incendio's `App` with `<Routes location={path}>` so that Incendio's `useLocation` and `useParams` see `path`.
  - Routes:
    - `/all/clusters` → `ClusterList`
    - `/all/instances` → `<IncendioAt path="/ui/all-projects/instances"/>`
    - `/all/warnings` → `<IncendioAt path="/ui/warnings"/>`
    - `/inventory/:cluster` → `ClusterSummary`
    - `/inventory/:cluster/nodes` → `<IncendioAt path="/ui/cluster/members"/>`
    - `/inventory/:cluster/projects` → `ClusterProjects`
    - `/inventory/:cluster/networks` → `<IncendioAt path="/ui/project/default%40<c>/networks"/>`
    - `/inventory/:cluster/storage` → `<IncendioAt path="/ui/project/default%40<c>/storage/pools"/>`
    - `/inventory/:cluster/operations` → `<IncendioAt path="/ui/operations"/>`
    - `/inventory/:cluster/configure[/:sub]` → `ClusterConfigure`, a side menu with these entries:
      - `incuscloud`: `ClusterDetail` by name, for operators only
      - `settings`: `/ui/cluster/settings`
      - `groups`: `/ui/cluster/groups`
      - `links`: `/ui/cluster/links`
      - `warnings`: `/ui/warnings`
  - Redirects:
    - `/instances` and `/instances/new` → `/all/instances`
    - `/clusters` → `/all/clusters`
    - `/clusters/:id` → `/inventory/<name>/configure/incuscloud`, after resolving the name
    - an unqualified `/ui/project/:p/...` → the first cluster that has `p` (use `qualifyPath` from `pages/inventory/scope.ts`, extended to the instance list too)

- [ ] **Step 1: failing tests** in `console.spec.tsx`. Use `renderInFrame` with `incendioApi()` mocks plus `/api/v1/clusters`, `/1.0/cluster/members` and `/1.0/instances`. The tests:
  1. **Sidebar.**
     - The view tabs are Instances, Projects, Nodes, Networks and Storage.
     - The tree shows "All clusters", then the clusters, then the nodes.
     - Platform (Kubernetes, Tenants, Jobs…) and Account come after the tree, with no Dashboard and no Clusters among them.
     - Choosing "Nodes" is remembered in `localStorage` (`ic.view`).
  2. **Object frame.**
     - At `/inventory/c1/nodes`, the breadcrumb reads "All clusters › c1" and the tab row has "Nodes" as the current page.
     - Incendio's members page renders: its title "Cluster members", or whatever its header text is.
     - Requests carry Referer semantics. In jsdom, assert instead that the page is mounted at the synthetic path, through `screen.getByTestId` of a stub.
  3. **No row for objects with their own row.** At `/ui/project/p%40c1/instance/web`, there is a breadcrumb and no `.ic-tabs`.
  4. **Overflow.** With a container narrower than the tabs, the extra tabs move into a "More" contextual menu. Mock `ResizeObserver` and the element widths.
  5. **Global caches dropped on cluster change.** Navigating from `/inventory/c1/storage` to `/inventory/c2/storage` removes queries whose first key is in `GLOBAL_KEYS`. Seed `queryClient.setQueryData(["storage"], …)` and assert it is gone.
  6. **Old routes redirect.** `/instances`, `/clusters` and `/ui/project/default/profiles` land on `/all/instances`, `/all/clusters` and `/ui/project/default%40c1/profiles`.
  7. **Resizable sidebar.** Dragging the handle (pointer events) changes the width, which is clamped to 240–360 and stored in `ic.sidebar`.
- [ ] **Step 2:** Run the tests and watch them fail.
- [ ] **Step 3: implement.**
  - **Sidebar:**
    - Use Incendio's classes: `l-navigation` and `p-panel is-dark`, with `p-side-navigation--icons` lists.
    - The view tabs are a square segmented control (`p-segmented-control`, dark).
    - `Tree` renders `TreeItem` rows reusing the existing `.ic-tree` styles. A chevron expands a row and the label is a `Link`.
    - Ancestors of the selected object are expanded automatically. The selected row is the one whose `to` matches the current object's tree target, taken from `crumbsOf(...).at(-1).to`.
    - The bottom group lists the `sections(me).platform` items (Dashboard and Clusters removed) and the Account items.
    - The collapse toggle uses Incendio's `menuCollapsed` behaviour and class (`l-navigation.is-collapsed`).
  - **ObjectFrame:**
    - When `objectOf(pathname).kind !== "none"`, render a `div.l-main.ic-object` holding the breadcrumb (`p-breadcrumbs`, square), then `.ic-tabs` (react-components `Tabs` with `listClassName`, links as `Link` elements), then `.ic-object__body` with the children inside.
    - CSS: `.ic-object` is a flex column. `.ic-object__body > .l-main` gets `flex: 1; min-height: 0; overflow-y: auto`.
    - Otherwise render the children as they are.
  - **ClusterSummary:**
    - Status and the stat tiles, moved from `InventorySummary` with the selection fixed to the cluster.
    - A "Create instance" button that goes to `/ui/project/default%40<c>/instances/create`.
  - **ClusterProjects:** a `MainTable` with name, description, instance count and a link to the project, built from `useInventory` data filtered to the cluster.
  - **Shell:**
    - Drop Incendio's `Navigation`, the `NavigationExtensionContext`, the `InstanceListExtensionContext` aside and above, and `ClusterSelect`.
    - Keep `CreateInstanceExtensionContext`, `Events`, `StatusBar`, the theme effect, and the `GLOBAL_KEYS` effect.
    - Extend `GLOBAL_KEYS` with `projects`, `operations`, `warnings` and `settings`.
- [ ] **Step 4:** Run the web suite (`bunx vitest --run`) and `bunx tsc --noEmit`. Both should pass. Update `Navigation.spec.tsx` (now `Sidebar` tests) and the App specs to the new structure.
- [ ] **Step 5: commit** with the message `incuscloud web: the inventory-tree console (sidebar, object tabs, cluster pages)`.

### Task 5: Warnings show their cluster (Incendio opt-in)

**Files:**
- Create: `packages/ui/src/context/warningListExtension.tsx` (`{ columns?: Array<{ header: string; cell: (w: LxdWarning) => ReactNode; sortKey?: string }> }`)
- Modify: `packages/ui/src/pages/warnings/WarningList.tsx`. The extra columns go after "Project", in both the headers and the rows.
- Modify: `incuscloud/web/src/components/Shell.tsx`. Provide one column, `{ header: "Cluster", cell: (w) => clusterOf(w.location) }`, on the root's Warnings tab only. A cluster's own warnings need no column.
- Test: `incuscloud/web/src/console/console.spec.tsx`. At `/all/warnings`, with two warnings from `w1@c1`/`w2@c2` locations, the table has a "Cluster" column with c1 and c2.

- [ ] Step 1: write the failing test. Step 2: run it and watch it fail.
- [ ] Step 3: implement. Step 4: run the web suite, then `packages/ui` `npx tsc --noEmit -p .` and eslint on the changed files.
- [ ] Step 5: commit with the message `incuscloud: warnings over every cluster say which cluster`.

### Task 6: Remove what the new console replaced

**Files:**
- Delete:
  - `incuscloud/web/src/pages/inventory/InventoryTree.tsx`
  - `incuscloud/web/src/pages/inventory/InventorySummary.tsx`, after its tiles move in Task 4
  - `incuscloud/web/src/pages/inventory/ClusterSelect.tsx`
  - the merged-project parts of `scope.ts` (`listedProject` and `clusterChoices`) and their tests
- Modify (packages/ui):
  - Remove `afterProjectSelector`, `serverLabel` and `projects` from `context/navigationExtension.tsx` and their uses in `Navigation.tsx` and `NavigationProjectSelector*.tsx`.
  - Remove the `.navigation-section-label` styles.
  - Remove `aside`/`above` from `instanceListExtension.tsx` and from `InstanceList.tsx`, together with the `.instance-list-with-aside` sass.
  - Keep `scope` and `createPath` only if something still uses them. Otherwise remove them, and the whole context if it ends up empty.
  - The navigation extension stays only as far as nothing else needs it to go. If the console no longer renders `Navigation`, remove the extension file and its hooks in `Navigation.tsx` entirely, which returns Incendio's navigation to upstream form.
- [ ] Step 1: `grep -rn` each export before deleting it, and keep anything still used.
- [ ] Step 2:
  - Run the web suite and `bunx tsc --noEmit`.
  - In `packages/ui`, run `npx tsc --noEmit -p .`, eslint on the changed files, and `npx vitest --run`. The only failures allowed are the 14 pre-existing ones in `loginProject.spec.ts`.
- [ ] Step 3: build and rsync `packages/ui`. Commit with the message `incuscloud: drop the navigation the inventory console replaced`.

### Task 7: Live verification and docs

- [ ] Rebuild the web app (`cd incuscloud/web && bun run build`) and restart dev if the server changed.
- [ ] Browser pass with the playwright scripts in the scratchpad (`console2.cjs`, light and dark), as admin:
  - [ ] Every tree view on cluster-b, -c and -d (d has two nodes).
  - [ ] Every cluster tab, a project's tabs, a node and an instance (including the terminal).
  - [ ] Create from a cluster's Summary.
  - [ ] Operations and warnings on `/inventory/cluster-b/...` are cluster-b's only. Check the gateway log, or count rows against `incus warning list` on cluster-b.
- [ ] The same pass as a tenant member. Create a member user for the `kspike` tenant with `bun admin-api.ts`, and keep the password in a scratchpad file that is never printed. The tree must show only cluster-b and `kspike@cluster-b`.
- [ ] Update `incuscloud/README.md`'s console section to describe the tree, views and tabs.
- [ ] Final commit, then the whole-branch review (executing-plans' final review).

---

## Revision after the user's review (2026-10-12)

The user reviewed the first build and asked for five changes (spec updated in the same commit): tinted kind icons in the tree; Incus's word "members" instead of "nodes"; groups and placement groups in the cluster view (and, generally, every Incendio page reachable); Kubernetes as an inventory object at the cloud and cluster level, as complete as Incendio's own Kubernetes pages; and a view of who can access what. Tasks 8–13 implement them; Task 7 (live pass, README, final review) runs after them.

### Task 8: Members, and tinted kind icons

**Files:** `console/object.ts`, `console/views.ts`, `console/Tree.tsx`, `console/Sidebar.tsx`, `console/ClusterPages.tsx`, `App.tsx`, create `console/KindIcon.tsx`; tests in `object.spec.ts`, `views.spec.ts`, `console.spec.tsx`.

- [ ] Tests first: the view button and cluster tab are "Members"; `/inventory/c/members` is the cluster's Members tab and `/inventory/c/nodes` redirects there; `buildView("members", …)`; each tree item carries `kind` (`root|cluster|member|container|vm|k8s|project|network|pool`) and `tone` (`ok|off|busy|frozen|bad|none`) from its status; `KindIcon` renders an `svg` with class `ic-kind ic-kind--<kind> ic-tone--<tone>`.
- [ ] Implement: rename `nodes` → `members` (view, tab, URL, labels, Summary); instances carry `type`; `toneOf(status)`; `KindIcon` draws square 16px SVGs in `currentColor`; CSS tones (green `#0e8420`, grey, amber `#c7162b`-free `#f99b11`, blue `#06c`, red `#c7162b`; lighter in the dark sidebar).
- [ ] Commit `incuscloud web: members, and tree icons by kind tinted by status`.

### Task 9: Tabs with a side menu; every Incendio page reachable

**Files:** `console/object.ts` (tabs gain `subs`), create `console/SideMenu.tsx`, `console/ClusterPages.tsx`, `console/ObjectFrame.tsx`, `App.tsx`; tests in `object.spec.ts`, `console.spec.tsx`.

- [ ] Tests first: `objectOf` maps `/ui/project/p@c/network-acls` to the project's Networks tab with sub `acls`, `/ui/project/p@c/storage/volumes` to Storage › volumes, `/ui/project/p@c/placement-groups` to Configure › placement-groups; `subsOf(obj)` lists the spec's side menus; `/inventory/c/groups/placement` renders Incendio's placement groups for `default@c` with a project picker; `/inventory/c/networks/acls` renders Incendio's ACL list for `default@c`; a project's Networks tab shows the side menu with "ACLs" current on `network-acls`.
- [ ] Implement the spec's side-menu table; cluster tabs Groups, Networks, Storage, Access, Configure with subs at `/inventory/<c>/<tab>/<sub>`; project subs are Incendio's own URLs, wrapped by the frame in the same `SideMenu`.
- [ ] Commit `incuscloud web: tabs with side menus; every Incendio page of a cluster or project is reachable`.

### Task 10: Kubernetes nodes API

**Files:** `server/src/api/kubernetes.ts`, `server/src/k8s/worker.ts` (machine → node view), tests in the k8s API test.

- [ ] Test first: `GET /api/v1/kubernetes/:id/nodes` returns `[{ name, role: "control-plane"|"worker", instance, phase, version, ready }]` from the fake kube's Machines (instance from `status.infrastructureRef`/`spec.infrastructureRef` name, role from the `cluster.x-k8s.io/control-plane` label); viewers of the tenant may read it; others get 404.
- [ ] Implement; commit `incuscloud: a Kubernetes cluster's nodes`.

### Task 11: Kubernetes in the console

**Files:** `pages/kubernetes/*`, `console/object.ts`, `console/views.ts`, `console/useInventory.ts`, `console/Sidebar.tsx`, `console/ClusterPages.tsx`, `App.tsx`; tests in `pages/kubernetes/kubernetes.spec.tsx`, `console.spec.tsx`, `views.spec.ts`.

- [ ] Tests first: root tab Kubernetes at `/all/kubernetes` (`/kubernetes` redirects) lists every cluster's with a Cluster column; `/inventory/c/kubernetes` lists only c's and its Create link carries `?cluster=<id>`; the Projects view lists `k8s` items under their project; `/kubernetes/<id>` has tabs Summary, Nodes, Activity, Kubeconfig and buttons Scale, Upgrade, Kubeconfig, Delete; Nodes lists the API's nodes with instance links to `/ui/project/<tenant>@<cluster>/instance/<instance>`; the create form has a section menu (Placement, Cluster, Nodes) and preselects `?cluster=`; Kubernetes is no longer in the sidebar's Platform list.
- [ ] Implement with Incendio's components (`MainTable`, `Button`, `Modal`/`ConfirmationButton`, the create form's `form-navigation` layout); commit `incuscloud web: Kubernetes clusters are inventory objects`.

### Task 12: Who has access

**Files:** create `server/src/api/access.ts` (+ test), register it in `app.ts`; create `web/src/console/AccessPage.tsx`; `console/ClusterPages.tsx`, `ObjectFrame.tsx`; tests in `console.spec.tsx`.

- [ ] Test first (server): `GET /api/v1/clusters/:id/access` returns `{ platform: [{ user, role, relation }], tenants: [{ tenant, project, members: [{ user, role, relation }] }] }` from the same facts the reconciler grants (`desiredGrants`' role → relation maps); platform entries only for platform viewers; tenants filtered to those the caller may see; unknown or invisible cluster → 404.
- [ ] Test first (web): the cluster's Access › Who has access lists platform roles and each tenant's members with their Incus relation; the project's Access tab lists its tenant's members only; Access › Identities renders Incendio's identities page for that cluster.
- [ ] Implement; commit `incuscloud: who has access to a cluster or project`.

### Task 13: The access model's open questions

- [ ] Write to `QUESTIONS.md` (git-ignored): what the model lacks (roles scoped to one cluster; user groups/teams; per-project roles inside a tenant; custom roles) with a recommendation for each. No code.
