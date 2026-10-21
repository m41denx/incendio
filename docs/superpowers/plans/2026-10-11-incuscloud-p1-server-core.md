# IncusCloud P1 — Server Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `incuscloud` server: one HTTPS listener with the platform API (Elysia), identity (Hydra login/consent/device + browser sessions), platform authorization (OpenFGA), cluster registry with trust-token enrolment, users, tenants, service accounts and an audit log.

**Architecture:** `node:https` front server (D14) dispatches `/api/*`, `/auth/*`, `/healthz` to an Elysia app through `app.handle(Request)`; P2 adds the gateway behind the same server. State in Postgres via Drizzle (PGlite in tests). Hydra issues tokens; we serve its login/consent/device pages (server-rendered HTML) and verify JWTs with `jose`. OpenFGA `platform` store holds platform/tenant/cluster roles. Cluster admin calls use `node:https` + `PinnedAgent` with the control plane's client certificate.

**Tech Stack:** Bun 1.4, Elysia 1.4, Drizzle 0.45 (`bun-sql` driver in production, `pglite` in tests), `@electric-sql/pglite` 0.5, `jose` 6, `@openfga/sdk` 0.9.7 + `@openfga/syntax-transformer`, zod 4, `@incendio/api` (workspace, `PinnedAgent`), Ory Hydra v26.2 + OpenFGA v1.22 binaries for integration tests.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (D1–D15, §3.1, §3.2), spike results `incuscloud/docs/spikes.md`.

## Global Constraints

- Code under `incuscloud/` is GPL-3.0 (changed from AGPL-3.0 at the owner's request); no code copied from PegaProx.
- Incus identity = `sub` = IncusCloud user or service-account id; audience `incuscloud`; Hydra JWT access tokens.
- Secrets at rest (cluster client keys, Hydra client secrets we keep) encrypted with AES-256-GCM using `SECRET_KEY` (32+ bytes, base64).
- Cluster TLS: pin the SHA-256 fingerprint (never `ca`, never unpinned); never present the admin client certificate on gateway traffic.
- Every mutating platform API call writes an audit row (actor, action, target, result).
- API errors use one shape: `{ "error": { "code": string, "message": string } }` with the HTTP status.
- Tests: `bun test` from `incuscloud/server`; integration tests that need Hydra/OpenFGA/Incus are skipped unless their binaries/targets exist (`IC_IT_HYDRA`, `IC_IT_OPENFGA`, `IC_IT_INCUS`).

## Review Focus

- Login with a wrong password, unknown email, or a disabled user: same generic error, constant-time compare, audit row with result `denied`.
- Enrolment with an expired or already-used trust token, or a token whose fingerprint does not match the server: clear 400, nothing stored.
- Platform API called with a token from another audience, an expired token, or a deleted service account: 401.
- A tenant admin trying to act on another tenant, or to grant `platform` roles: 403.
- Server restart with an existing database and OpenFGA store: no duplicate bootstrap admin, store/model reused (idempotent bootstrap).

---

### Task 1: Workspace, config, front server, health

**Files:**
- Create: `incuscloud/server/package.json`, `incuscloud/server/tsconfig.json`, `incuscloud/server/src/config.ts`, `incuscloud/server/src/app.ts`, `incuscloud/server/src/front.ts`, `incuscloud/server/src/main.ts`, `incuscloud/server/src/lib/log.ts`, `incuscloud/server/src/lib/errors.ts`, `incuscloud/LICENSE` (AGPL-3.0 text, like `firecloud/COPYING`)
- Modify: root `package.json` workspaces += `"incuscloud/*"`
- Test: `incuscloud/server/src/config.test.ts`, `incuscloud/server/src/front.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: Record<string,string|undefined>): Config` (zod; throws listing every invalid key); `Config` fields: `listen` (`host`,`port`), `publicUrl`, `tls` (`certFile`,`keyFile`), `databaseUrl`, `secretKey` (Buffer), `hydra` (`publicUrl`,`adminUrl`,`caFile?`), `openfga` (`url`,`token?`,`storeName`), `clusterDomain`, `bootstrapAdmin?` (`email`,`password`); `createApp(deps: AppDeps): Elysia`; `createFront(opts: { app: { handle(r: Request): Promise<Response> }, gateway?: GatewayHandler, tls }): https.Server`; `type GatewayHandler = { match(req: IncomingMessage): boolean; request(req, res): void; upgrade(req, socket, head): void }`; `ApiError(status, code, message)`.

- [ ] **Step 1: failing tests**

```ts
// config.test.ts
import { expect, test } from "bun:test";
import { loadConfig } from "./config";
const base = { IC_PUBLIC_URL: "https://cloud.example", IC_DATABASE_URL: "postgres://x", IC_SECRET_KEY: Buffer.alloc(32, 1).toString("base64"), IC_HYDRA_PUBLIC_URL: "https://id.example", IC_HYDRA_ADMIN_URL: "http://hydra:4445", IC_OPENFGA_URL: "http://fga:8080", IC_CLUSTER_DOMAIN: "clusters.example", IC_TLS_CERT: "/c", IC_TLS_KEY: "/k" };
test("defaults", () => { const c = loadConfig(base); expect(c.listen.port).toBe(8443); expect(c.openfga.storeName).toBe("incuscloud-platform"); });
test("short secret key rejected", () => { expect(() => loadConfig({ ...base, IC_SECRET_KEY: "c2hvcnQ=" })).toThrow(/IC_SECRET_KEY/); });
test("all problems reported at once", () => { expect(() => loadConfig({})).toThrow(/IC_PUBLIC_URL[\s\S]*IC_DATABASE_URL/); });
```

```ts
// front.test.ts — front server dispatch
test("/healthz served by the app, unknown host path 404 JSON", async () => { /* start createFront on port 0 with self-signed test cert from fixtures; fetch /healthz → 200 {status:"ok"}; fetch /nope → 404 {error:{code:"not_found"}} */ });
test("gateway gets matching requests and upgrades", async () => { /* fake GatewayHandler.match → host startsWith "c1."; request with Host c1.clusters.example reaches gateway.request */ });
test("request body streams to the app (POST 5 MiB echo length)", async () => {});
```

- [ ] **Step 2:** `bun test` → fail (modules missing).
- [ ] **Step 3:** implement. `front.ts`: `https.createServer`; on `request`: gateway?.match → gateway.request; else convert `IncomingMessage` → `Request` (`Readable.toWeb` body for non-GET/HEAD, `duplex: "half"`), `await app.handle`, write status/headers, pipe body (`Readable.fromWeb`). On `upgrade`: gateway?.match → gateway.upgrade else `socket.destroy()`. `app.ts`: Elysia with `/healthz`, error handler mapping `ApiError` and validation errors to the error shape.
- [ ] **Step 4:** `bun test` → pass. **Step 5:** commit `incuscloud: server skeleton`.

### Task 2: Database schema and migrations

**Files:**
- Create: `incuscloud/server/src/db/schema.ts`, `db/index.ts`, `db/test-db.ts`, `incuscloud/server/drizzle.config.ts`, generated `incuscloud/server/drizzle/*.sql`
- Test: `incuscloud/server/src/db/db.test.ts`

**Interfaces:**
- Produces: tables (`clusters`, `users`, `tenants`, `tenantMembers`, `serviceAccounts`, `sessions`, `auditLog`, `platformRoles`); `type Db`; `openDb(url): Promise<Db>` (bun-sql + migrate); `testDb(): Promise<Db>` (PGlite in memory + migrate).
- Columns (exact): `clusters(id uuid pk, name text unique, url text, addresses jsonb, fingerprint text, serverCert text, clientCert text, clientKeyEnc text, status text, statusMessage text, labels jsonb, fgaStoreId text null, createdAt, updatedAt, lastSeenAt null)`; `users(id uuid pk, email citext unique, name text, passwordHash text null, disabled bool, createdAt, lastLoginAt null)`; `tenants(id uuid pk, slug text unique, name text, quotas jsonb, createdAt)`; `tenantMembers(tenantId fk, userId fk, role text check in (owner,admin,member,viewer), pk(tenantId,userId))`; `serviceAccounts(id uuid pk, name text, tenantId fk null, clientId text unique, createdBy fk, createdAt, disabled bool)`; `platformRoles(userId fk, role text check in (admin,operator,viewer), pk(userId))`; `sessions(id text pk (random 32 bytes b64url), userId fk, accessToken text, refreshToken text null, idToken text null, expiresAt, createdAt, lastSeenAt, userAgent text, ip text)`; `auditLog(id bigserial pk, at timestamptz, actorType text, actorId text, action text, targetType text, targetId text, result text, detail jsonb, ip text)`.

- [ ] **Step 1: failing test**

```ts
import { testDb } from "./test-db";
import { users, clusters } from "./schema";
test("migrations apply and constraints hold", async () => {
  const db = await testDb();
  await db.insert(users).values({ email: "A@x.io", name: "A" });
  await expect(db.insert(users).values({ email: "a@x.io", name: "dup" })).rejects.toThrow(); // citext unique
  await db.insert(clusters).values({ name: "c1", url: "https://h:8443", addresses: [], fingerprint: "ab", serverCert: "", clientCert: "", clientKeyEnc: "", status: "pending", labels: {} });
  expect((await db.select().from(clusters)).length).toBe(1);
});
```

- [ ] **Step 2:** fail. **Step 3:** schema + `drizzle-kit generate` (dialect postgresql, `CREATE EXTENSION IF NOT EXISTS citext` in the first migration; PGlite loads the citext contrib extension). **Step 4:** pass. **Step 5:** commit `incuscloud: database schema`.

### Task 3: Secrets and ids

**Files:** Create `incuscloud/server/src/lib/secrets.ts`; Test `lib/secrets.test.ts`

**Interfaces:** Produces `seal(key: Buffer, plain: string): string` (`v1.<iv b64>.<ct+tag b64>`), `open(key, sealed): string` (throws `ApiError(500,"secret_corrupt")` on tamper), `randomToken(bytes=32): string` (base64url).

- [ ] **Step 1: failing test**

```ts
test("round trip", () => { const k = Buffer.alloc(32, 7); expect(open(k, seal(k, "s3cret"))).toBe("s3cret"); });
test("tamper detected", () => { const k = Buffer.alloc(32, 7); const s = seal(k, "x"); expect(() => open(k, s.slice(0, -2) + "AA")).toThrow(); });
test("wrong key detected", () => { expect(() => open(Buffer.alloc(32, 8), seal(Buffer.alloc(32, 7), "x"))).toThrow(); });
```
- [ ] **Steps 2–5:** fail → implement (node:crypto aes-256-gcm, 12-byte IV) → pass → commit.

### Task 4: Incus admin client and cluster enrolment

**Files:**
- Create: `incuscloud/server/src/incus/admin-client.ts`, `incus/trust-token.ts`, `incus/identity.ts` (control plane client certificate: generate once, stored sealed in a `settings` row), `clusters/enroll.ts`, `clusters/repo.ts`
- Modify: `db/schema.ts` (+ `settings(key text pk, value text)`), new migration
- Test: `incus/trust-token.test.ts`, `clusters/enroll.test.ts` (unit, fake Incus over https with a self-signed cert), `clusters/enroll.it.test.ts` (live against `cluster-b` when `IC_IT_INCUS=1`)

**Interfaces:**
- Produces: `decodeTrustToken(s: string): { clientName; fingerprint; addresses: string[]; secret; expiresAt: Date }` (throws `ApiError(400,"invalid_token")`); `class IncusAdminClient { constructor(opts: { url: string; fingerprint: string; cert: string; key: string }); request<T>(method, path, body?, opts?: { project?: string }): Promise<IncusResponse<T>>; wait(opPath: string, timeoutS?): Promise<IncusOperation>; server(): Promise<IncusServer> }`; `enrollCluster(deps, { name: string; token: string; labels?: Record<string,string> }): Promise<ClusterRow>` — tries each token address, pins `fingerprint`, `POST /1.0/certificates {type:"client", trust_token: secret, name:"incuscloud"}` with our client certificate, re-reads `/1.0` (must be `auth: trusted`), stores url/addresses/serverCert/fingerprint, status `ready`.

- [ ] **Step 1: failing tests**

```ts
// trust-token.test.ts
const tok = Buffer.from(JSON.stringify({ client_name: "incuscloud", fingerprint: "ab".repeat(32), addresses: ["10.0.0.1:8443"], secret: "s", expires_at: "2099-01-01T00:00:00Z" })).toString("base64");
test("decodes", () => expect(decodeTrustToken(tok).addresses).toEqual(["10.0.0.1:8443"]));
test("expired rejected", () => expect(() => decodeTrustToken(Buffer.from(JSON.stringify({ client_name: "x", fingerprint: "ab", addresses: ["a:1"], secret: "s", expires_at: "2000-01-01T00:00:00Z" })).toString("base64"))).toThrow(/expired/));
test("garbage rejected", () => expect(() => decodeTrustToken("%%%")).toThrow(/invalid_token|Invalid/));
// enroll.test.ts — fake Incus (https.createServer with fixture cert): records POST /1.0/certificates body and client cert; /1.0 returns auth:"trusted" only after the POST.
test("enrol stores pinned cluster", async () => { /* expect row.status "ready", row.fingerprint === fixture fp, fake saw trust_token "s" and a client certificate */ });
test("fingerprint mismatch refused, nothing stored", async () => {});
test("duplicate name rejected 409", async () => {});
```

- [ ] **Step 2:** fail. **Step 3:** implement (admin client on node:https + `PinnedAgent({ pin: fingerprint, cert, key })`). **Step 4:** pass; with `IC_IT_INCUS=1` run the live test (token from `incus config trust add incuscloud-it` on cluster-b, enrol, `server()` returns `auth: trusted`, then remove the certificate). **Step 5:** commit.

### Task 5: OpenFGA platform authorization

**Files:**
- Create: `incuscloud/server/src/authz/model.fga`, `authz/platform.ts`, `incuscloud/scripts/dev-openfga.sh` (in-memory OpenFGA with a preshared key for tests)
- Test: `authz/platform.it.test.ts` (`IC_IT_OPENFGA=1`)

**Interfaces:**
- Model (exact):
```
model
  schema 1.1
type user
type platform
  relations
    define admin: [user]
    define operator: [user] or admin
    define viewer: [user] or operator
type tenant
  relations
    define platform: [platform]
    define owner: [user]
    define admin: [user] or owner or admin from platform
    define member: [user] or admin
    define viewer: [user] or member or viewer from platform
type cluster
  relations
    define platform: [platform]
    define tenant: [tenant]
    define admin: admin from platform
    define viewer: [user] or admin or viewer from platform
    define can_access: viewer or member from tenant
```
- Produces: `class PlatformAuthz { static async init(cfg): Promise<PlatformAuthz>` (find-or-create store by name, write model if the latest differs, idempotent); `check(user: string, relation: string, object: string): Promise<boolean>`; `write(tuples: Tuple[], deletes?: Tuple[]): Promise<void>` (ignores "already exists"/"does not exist"); `listObjects(user, relation, type): Promise<string[]>` }`; object ids `platform:main`, `tenant:<uuid>`, `cluster:<uuid>`, users `user:<uuid>`.

- [ ] **Step 1: failing test**

```ts
test.if(!!process.env.IC_IT_OPENFGA)("roles flow", async () => {
  const a = await PlatformAuthz.init({ url, token, storeName: `t-${crypto.randomUUID()}` });
  await a.write([{ user: "platform:main", relation: "platform", object: "tenant:t1" }, { user: "user:u1", relation: "member", object: "tenant:t1" }, { user: "tenant:t1", relation: "tenant", object: "cluster:c1" }, { user: "platform:main", relation: "platform", object: "cluster:c1" }]);
  expect(await a.check("user:u1", "can_access", "cluster:c1")).toBe(true);
  expect(await a.check("user:u2", "can_access", "cluster:c1")).toBe(false);
  await a.write([{ user: "user:boss", relation: "admin", object: "platform:main" }]);
  expect(await a.check("user:boss", "admin", "tenant:t1")).toBe(true);
  const again = await PlatformAuthz.init({ url, token, storeName: a.storeName }); // idempotent
  expect(again.storeId).toBe(a.storeId);
});
```
- [ ] **Steps 2–5.**

### Task 6: Identity — Hydra login, consent, device

**Files:**
- Create: `incuscloud/server/src/identity/hydra-admin.ts`, `identity/bootstrap.ts` (OAuth2 clients `incus-cli` public device+code, `incuscloud-web` confidential code+refresh with redirect `<publicUrl>/auth/callback`), `identity/passwords.ts`, `identity/pages.ts` (server-rendered HTML: login form, device code form, error), `identity/routes.ts` (`GET/POST /auth/login`, `GET /auth/consent`, `GET/POST /auth/device`, `GET /auth/device/done`), `incuscloud/scripts/dev-hydra.sh`
- Test: `identity/passwords.test.ts`, `identity/routes.test.ts` (fake Hydra admin), `identity/flow.it.test.ts` (`IC_IT_HYDRA=1`: real Hydra, client_credentials + device flow end to end)

**Interfaces:**
- Produces: `hashPassword(p)`, `verifyPassword(p, hash)` (Bun.password argon2id; verify against a dummy hash for unknown users to keep timing flat); `HydraAdmin { getLogin(ch), acceptLogin(ch, subject), rejectLogin(ch, err), getConsent(ch), acceptConsent(ch, { scopes, audience, session }), acceptDevice(ch, userCode), createClient(c), deleteClient(id), getClient(id) }`; consent always grants requested scopes + audience `incuscloud` for first-party clients and puts `email`, `name` claims in tokens; login accepts with `subject = users.id`.
- Login rules: unknown email, wrong password, disabled user → same message "Wrong email or password", audit `auth.login` result `denied`; success → audit `success`, `lastLoginAt` updated. CSRF: forms carry the Hydra challenge plus a per-form token in an httpOnly cookie (double submit).

- [ ] **Step 1: failing tests** (`passwords.test.ts`: hash/verify, wrong password false, unknown-user dummy verify takes ≥ 0.5× real verify time; `routes.test.ts`: GET /auth/login renders form with challenge; POST good creds → 302 to Hydra's `redirect_to`; POST bad creds → 200 form with generic error and audit row; disabled user same; device form posts user_code → acceptDevice called; flow.it: device code → our device page → login → consent → token with `aud` incuscloud and `sub` = user id).
- [ ] **Steps 2–5.**

### Task 7: Token verification, browser sessions, `me`

**Files:**
- Create: `incuscloud/server/src/auth/verify.ts` (jose `createRemoteJWKSet` on Hydra JWKS; issuer + audience `incuscloud`), `auth/session.ts` (BFF: `/auth/start` → Hydra authorize with PKCE+state cookie; `/auth/callback` → token exchange as `incuscloud-web`, session row, cookie `ic_session` httpOnly Secure SameSite=Lax; `/auth/logout`; refresh when < 60 s left), `auth/principal.ts` (`resolvePrincipal(req): Promise<Principal | null>` from bearer or session; service accounts by `sub` = clientId), `api/me.ts`
- Test: `auth/verify.test.ts` (local JWKS via jose `generateKeyPair`: good, wrong aud, expired, wrong issuer), `auth/session.test.ts` (callback stores session, cookie flags, refresh path with fake token endpoint), `api/me.test.ts`

**Interfaces:**
- Produces: `type Principal = { kind: "user" | "service"; id: string; email?: string; name: string; token: string; platformRole?: "admin"|"operator"|"viewer" }`; Elysia plugin `principal()` deriving `principal` and macro `requireAuth`; `GET /api/v1/me` → `{ id, kind, email, name, platformRole, tenants: [{ id, slug, name, role }] }`.

- [ ] **Steps 1–5** with the tests above.

### Task 8: Platform API — users, tenants, members, service accounts, clusters, audit

**Files:**
- Create: `incuscloud/server/src/api/users.ts`, `api/tenants.ts`, `api/service-accounts.ts`, `api/clusters.ts`, `api/audit.ts`, `audit/log.ts`, `authz/guards.ts`, `bootstrap/admin.ts`
- Test: one `*.test.ts` per route file using `testDb()` + a fake `PlatformAuthz` (in-memory tuple evaluator implementing the model in `authz/fake.ts`, cross-checked against real OpenFGA in `authz/fake.it.test.ts`)

**Interfaces / endpoints (exact):**
- `GET/POST /api/v1/users`, `GET/PATCH/DELETE /api/v1/users/:id` (platform admin; PATCH: name, disabled, password, platformRole)
- `GET/POST /api/v1/tenants` (list: platform viewer → all, else own), `GET/PATCH/DELETE /api/v1/tenants/:id` (tenant admin / platform admin), `GET/PUT/DELETE /api/v1/tenants/:id/members/:userId` (`{ role }`; only owners make owners; platform roles not grantable here)
- `GET/POST /api/v1/service-accounts`, `DELETE /api/v1/service-accounts/:id`, `POST /api/v1/service-accounts/:id/rotate` (creates Hydra client `sa-<uuid>` with client_credentials + audience incuscloud; secret returned once; optional `tenantId` → member of that tenant)
- `GET /api/v1/clusters` (platform viewer: all; others: `can_access`), `POST /api/v1/clusters` `{ name, token, labels? }` (platform admin; Task 4 `enrollCluster`), `GET/PATCH/DELETE /api/v1/clusters/:id` (DELETE removes our certificate from the cluster when reachable), `PUT/DELETE /api/v1/clusters/:id/tenants/:tenantId` (place/unplace tenant; P3 creates projects)
- `GET /api/v1/audit?actor&action&target&before&limit` (platform viewer; tenant admins see their tenant's rows)
- `bootstrap/admin.ts`: on start, if no user has platform role admin and `IC_BOOTSTRAP_ADMIN_EMAIL/PASSWORD` are set, create that user + `user:<id> admin platform:main`; idempotent.

- [ ] **Steps 1–5** per route file, tests covering the Review Focus lines (403 cross-tenant, platform roles not grantable via members, deleted SA token → 401).

### Task 9: Dev runner and docs

**Files:** Create `incuscloud/scripts/dev.sh` (starts Hydra + OpenFGA + server with PGlite file DB under `.dev/`), `incuscloud/README.md`, `incuscloud/server/.env.example`

- [ ] **Step 1:** `scripts/dev.sh` boots everything; `curl https://127.0.0.1:8443/healthz` → `{"status":"ok"}`; log in as the bootstrap admin through `/auth/start` with curl (cookie jar) → `/api/v1/me` shows platform admin; enrol cluster-b with a fresh trust token; `GET /api/v1/clusters` lists it `ready`.
- [ ] **Step 2:** commit `incuscloud: dev runner and README`.
