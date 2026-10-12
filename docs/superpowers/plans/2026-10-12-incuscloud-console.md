# IncusCloud console: Incendio over every cluster — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** IncusCloud's UI becomes Incendio itself, working on every enrolled cluster at once. Lists merge results from all clusters, and each item is marked with its cluster. Single items and forms (the full instance create form, with its image picker and member targeting) work on the item's cluster. IncusCloud's platform pages (clusters, tenants, users, jobs, Kubernetes, …) sit in the same navigation.

**User direction (2026-10-12, verbatim):**
- "multi-member Incus clusters - we need to see each member of the cluster and be able to deploy to them."
- "when creating instances instead of predefined images we need to pull simplestreams ui to pick image. also instance create is very crude - we need full config menu like incendio"
- "dont do half-assed ui - you can literally copy almost all of incendio. we already have mechanism that routes api calls to corresnponding cluster - just merge results from all clusters and mark which is which"

**Architecture:**
- **A federation facade on the server** at `/1.0/…` on IncusCloud's own origin, for the browser session. To Incendio it looks like one Incus cluster. Behind it, each request goes through the existing gateway machinery, with the user's token and the per-cluster `can_access` check, to one cluster or to all of them.
- **Qualified names.** An identity that belongs to one cluster is written `<name>@<cluster>`:
  - projects: `acme@cluster-b`;
  - global entities: storage pools, cluster members, cluster groups, certificates, network integrations, warnings;
  - operation ids.
  - The split is at the last `@`. Cluster names are DNS labels, so they never contain `@`. A suffix counts only when it names an enrolled cluster.
- **Unqualified project = merged.** `/ui/project/acme/instances` lists acme's instances on every cluster. Each row's project is qualified (`acme@cluster-b`), so links and actions land on the right cluster. `acme@cluster-b` is that one project on that one cluster: plain Incendio.
- **Which cluster a request is for,** in order:
  1. qualifiers in the path, `project` or `target`;
  2. a qualified segment in the same-origin Referer (`/ui/project/acme@cluster-b/...`), which covers global calls made from a project page;
  3. otherwise all clusters: GETs fan out and merge.
  - A write with no cluster is refused (400). The exception is `POST /1.0/instances` in a merged project, which IncusCloud places: the tenant's ready placements, most free memory.
  - Qualifiers naming two different clusters get a 400.
- **Rewriting:**
  - Requests: qualifiers are stripped from the path, query and JSON body (every body string ending in `@<that cluster>`).
  - JSON responses get qualified:
    - `project` keys;
    - `/1.0/…` URL strings (the project param is added, `default@C` when absent; global entities get their name segment qualified; operations get their id qualified);
    - identity fields of projects and global entities;
    - `location` (member).
  - Other content types stream through untouched.
- **Merges:** array metadata is concatenated, and clusters that 404 or 403 are skipped.
  - `/1.0` is a federated view: clustered, the API extensions every cluster has, auth from the first cluster.
  - `/1.0/cluster/members` from a standalone server becomes one synthesized member named after its server. `/1.0/cluster` reports clustered.
  - The project list holds every qualified project, plus an unqualified merged entry for each project name that exists on more than one cluster.
- **Websockets:**
  - Operation sockets (`/1.0/operations/<id>@C/websocket`) are relayed as raw bytes to C.
  - `/1.0/events` is fanned in: one upstream socket per cluster, with each message rewritten.
- **Hosting:** the IncusCloud web app hosts Incendio:
  - aliases for Incendio's bare imports (`api/`, `components/`, `context/`, `lib/`, `pages/`, `types/`, `util/`);
  - Incendio's providers, Navigation, App routes (`/ui/*`), Events and StatusBar.
  - Incendio's Navigation gets an optional extension (logo, extra sections, sign-out) that leaves standalone Incendio unchanged.
  - IncusCloud's platform pages are routes in the same app. IncusCloud's own Instances, Create instance and Shell are removed.
- **Tenancy:** clusters' OpenFGA still decides. A tenant member sees only their projects. Platform admins see everything, including `default@<cluster>`.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (D11 gateway, D2 Incendio per cluster). This plan supersedes P4/P5's own instance pages.

## Global Constraints

- The facade never widens access: it relays with the caller's token and checks `can_access` per cluster, like the gateway.
- Never rewrite non-JSON bodies (file uploads, exports, consoles).
- Incendio stays usable standalone: every change to `packages/ui` is opt-in through context or props, and its own build and tests still pass.
- The UI style rule holds: Incendio's own components; anything custom is square and metro-style.
- Tenant projects gain `restricted.cluster.target=allow` (the user wants to deploy to members). Nothing else is loosened.

## Review Focus

- A merged list where two clusters have the same project and instance name: two rows, and actions on each reach the right cluster.
- A global call made from a project page (storage pools, members in the create form) must use that project's cluster, not merge.
- A write that names no cluster is refused, not sent to all clusters.
- One cluster down: merged lists still answer from the rest.
- Operation ids, waits and websockets round-trip through qualification.

---

### Task 1: Names, resolution, rewriting (pure)

`server/src/federation/names.ts`, `resolve.ts`, `rewrite.ts`, with unit tests:
- `qualify`/`split`;
- `targetOf(path, query, referer, clusters)`;
- `stripRequest`;
- `qualifyResponse(path, json, cluster)`;
- the entity-type table.

### Task 2: The facade handler

`server/src/federation/handler.ts`:
- admit: session principal, per-cluster `can_access`;
- single-cluster relay with JSON rewriting both ways (non-JSON streamed);
- fan-out GET merge;
- `/1.0` and members synthesis;
- placement for merged-project instance creates.

Wired in `front.ts`/`main.ts` for `/1.0` on the public origin. Tests: two fake Incus clusters (the gateway tests' FakeIncus).

### Task 3: Websockets

Operation sockets are relayed. Events are fanned in with `ws` and rewritten. Tests.

### Task 4: Host Incendio in the IncusCloud web app

- Build aliases. Mount Incendio's Root pieces and routes.
- Navigation extension in `packages/ui` (logo, extra sections, sign-out, no login page).
- Platform routes in the same frame. The server serves the SPA for `/ui/*`. CSP for websockets.
- Remove IncusCloud's Instances, Create instance and Shell. Dashboard links move to Incendio's routes.
- Tests: the web suite, and Incendio's own build and tests.

### Task 5: Federation touches in Incendio (opt-in)

- The project selector groups merged and per-cluster projects.
- The instance list marks rows from another project (the Project column in merged mode).
- Member names show their cluster.

### Task 6: Members and Kubernetes everywhere

- Tenant projects get `restricted.cluster.target=allow`.
- Kubernetes on multi-member clusters: the create form picks a member, and the load balancer and every node are pinned there.
- Platform operators may create on any ready cluster, which places the tenant.
- Tests and live checks.

### Task 7: Live verification and docs

- A browser pass over Incendio's sections on b, c and d, as admin and as a tenant member: instances (create with the image picker and a member target, console, exec), profiles, networks, storage, images, cluster members, operations, warnings, settings.
- `scripts/console-e2e.ts`.
- README.
