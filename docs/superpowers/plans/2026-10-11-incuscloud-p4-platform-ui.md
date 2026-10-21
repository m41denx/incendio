# IncusCloud P4 — Platform UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform UI at `https://<public>/`: sign in, see what you may see, and manage clusters, tenants, users, service accounts and logs without the API. The per-cluster console stays Incendio at `/clusters/<name>/ui/` (D9).

**Architecture:** A new workspace package `incuscloud/web` (`@incuscloud/web`): React 19 + Vite 7 + react-router 7 + TanStack Query 5 + Canonical react-components 4.6 / Vanilla 4.52, the versions Incendio uses. It talks only to `/api/v1` with the BFF session cookie (P1); a 401 sends the browser to `/auth/start?return_to=<path>`. The server serves its build from `IC_WEB_DIR` at `/` with an SPA fallback, behind the gateway (which claims only `/clusters/<name>/{1.0,os/1.0,ui,documentation}`).

**Tech Stack:** as above; Vitest 4 + jsdom + @testing-library/react for component tests; a Playwright run in the `ic-browser` dev container for the live check.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (D9, §3 roles, P4 row).

## Global Constraints

- GPL-3.0; no PegaProx code; look and feel follow Incendio (Vanilla, side navigation, `Panel` pages, `MainTable`).
- The UI never sees tokens: cookie session only; all writes are same-origin `fetch` (the server refuses foreign Origins).
- What a user sees follows the API: nav entries are hidden when `/me` says the role cannot use them, and the pages still handle 403/404 from the API.
- Secrets (service-account secrets) are shown once, never stored in browser storage.
- Copy is short and plain; errors from the API are shown as their `message`.

## Review Focus

- A tenant member (no platform role): sees only their tenants and the clusters those are placed on; no Users/Audit entries; direct URLs to admin pages show the API's 403/404, not a crash.
- Session expiry mid-use: the next API call redirects to sign-in and returns to the same page.
- Destructive actions (delete cluster with tenants, delete tenant, remove last owner): confirmation, and the API's 409 message shown.
- The service-account secret is shown once and can be copied; reloading the page does not show it again.
- Deep links (`/clusters/<id>`, `/tenants/<id>`) work on reload (SPA fallback) and `/clusters/<name>/ui/` still reaches Incendio.

---

### Task 1: Server support

**Files:** Create `incuscloud/server/src/web.ts`, test `web.test.ts`; Modify `config.ts` (`IC_WEB_DIR`, optional), `front.ts` (serve web before Elysia for GET/HEAD outside `/api/`, `/auth/`, `/healthz`), `api/me.ts` (`clusterDomain`, `publicUrl` in the response), `auth/session.ts` (`POST /auth/logout`, same-origin only; `GET /auth/logout` removed — fixes the P1 logout-CSRF minor), `main.ts`, `scripts/dev.sh` (`IC_WEB_DIR` when the build exists)

**Interfaces:**
- `serveWeb(req, res, { dir }): boolean` — `/assets/*` immutable-cached files; any other GET/HEAD path without an extension → `index.html` (`no-cache`); files with an extension that exist → served; traversal refused; returns false when it did not handle the request.
- `/me` → `{ …, clusterDomain: string, publicUrl: string }`.

- [ ] Tests: index at `/`, deep link `/tenants/x` → index, asset with type + immutable cache, `/api/v1/me` and `/auth/start` untouched, `..` refused, no `IC_WEB_DIR` → Elysia 404 as before; `/me` fields; `POST /auth/logout` clears the session and redirects (303) to Hydra's logout; foreign Origin → 403; `GET /auth/logout` → 404.

### Task 2: Web package and app shell

**Files:** Create `incuscloud/web/{package.json,tsconfig.json,vite.config.ts,vitest.config.ts,index.html,eslint.config.mjs?}`, `src/{main.tsx,App.tsx,api/client.ts,api/hooks.ts,api/types.ts,components/{Shell.tsx,Navigation.tsx,Logo.tsx,PageLayout.tsx,ErrorMessage.tsx,Loader.tsx},pages/NotFound.tsx,sass/styles.scss,test/setup.ts,test/server.ts}`; Modify root `package.json` workspaces

**Interfaces:**
- `request<T>(method, path, body?): Promise<T>` — JSON in/out, `credentials: "same-origin"`; 401 → `location.assign("/auth/start?return_to=" + encodeURIComponent(location.pathname + location.search))` and a never-resolving promise; other errors → `ApiError { status, code, message }` from `{ error: { code, message } }`; 204 → `undefined`.
- `useMe()`; `can(me, "platform", "viewer"|"operator"|"admin")`; `tenantRole(me, tenantId)`.
- `PageLayout({ title, controls, children })` (Incendio's BaseLayout shape).
- Test helper `mockApi(routes: Record<"METHOD /path", (body) => [status, json]>)` stubbing `fetch`.

- [ ] Tests: client parses errors, redirects on 401 with return path, 204; navigation shows Users/Service accounts/Audit only for platform roles, Tenants and Clusters for everyone, Gateway log for platform viewers; unknown route → Not found.

### Task 3: Users (the CRUD exemplar)

**Files:** `src/pages/users/{UserList.tsx,UserForm.tsx,UserDetail.tsx}`, tests.

- [ ] List (email, name, platform role, status, last login); create (email, name, optional password, platform role) in a side panel; detail: rename, change role, disable/enable, reset password, delete (confirm). API messages for 409 (`last admin`, `email taken`) shown inline. Tests: list renders, create posts the body and refreshes, 409 message shown, delete confirms first.

### Task 4: Clusters

**Files:** `src/pages/clusters/{ClusterList.tsx,EnrolCluster.tsx,ClusterDetail.tsx,PlacedTenants.tsx,ClusterStatus.tsx}`, tests.

- [ ] List (name, status badge + message, URL, last seen, reconciled, labels); enrol (name, trust token, labels) with the command that produces the token (`incus config trust add incuscloud --quiet` on the cluster); detail: status, reconcile now (operators), labels (admins), placed tenants (place: tenant picker; remove: confirm), console link `/clusters/<name>/ui/`, CLI snippet `incus remote add <name> https://<name>.<clusterDomain> --auth-type=oidc`, delete (confirm; with tenants: explains and offers force). Tests: list + badges, enrol posts, place/unplace, delete with 409 then force.

### Task 5: Tenants

**Files:** `src/pages/tenants/{TenantList.tsx,CreateTenant.tsx,TenantDetail.tsx,Members.tsx,Quotas.tsx,Placements.tsx}`, tests.

- [ ] List (platform: all; members: theirs, with their role); create (operators: slug, name, owner email lookup via users list, quotas); detail: rename (tenant admins), quotas (operators), members (add by email + role, change role, remove; last-owner 409 shown), placements (read-only list with project + status; operators place via cluster page), tenant service accounts (link to filtered SA list), delete (confirm; 409 "remove from clusters first" shown). Tests: member sees no create button; add member by email; 409 messages; quotas editable only for operators.

### Task 6: Service accounts (delegated)

**Files:** `src/pages/service-accounts/{ServiceAccountList.tsx,CreateServiceAccount.tsx,SecretOnce.tsx}`, tests.

- [ ] List (`?tenant=` filter), create (name + tenant or platform role) → `SecretOnce` (client id, secret, token URL, copy buttons, a `curl` client-credentials example, note that it is shown once); rotate (confirm → `SecretOnce`); delete (confirm). Tests: secret shown after create and gone after close; rotate confirms.

### Task 7: Audit and gateway logs (delegated)

**Files:** `src/pages/logs/{AuditLog.tsx,GatewayLog.tsx}`, tests.

- [ ] Tables with filters from the APIs (`actor`, `action`, `tenant` / `cluster`, `actor`) and "Load older" (`before=` the last row). Tests: filters go into the query; load older appends.

### Task 8: Dashboard and profile (delegated)

**Files:** `src/pages/{Dashboard.tsx,Profile.tsx}`, tests.

- [ ] Dashboard: counts (clusters by status, tenants, users for platform viewers), clusters needing attention (status ≠ ready, with message), my tenants. Profile: who I am, roles, and per accessible cluster the CLI command and console link. Tests: counts from mocked APIs; profile commands use `clusterDomain`.

### Task 9: Live check and docs

**Files:** `incuscloud/web/e2e/ui-check.mjs` (runs in the `ic-browser` container), README section "Platform UI", `scripts/dev.sh`.

- [ ] In the container with a session cookie: dashboard renders; create tenant `ui-<rand>` via the form; place it on cluster-b from the cluster page; tenant shows status ready; open the console link (Incendio loads); screenshots of each page reviewed; clean up through the API.
