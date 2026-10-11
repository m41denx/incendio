# IncusCloud P2 — Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every enrolled cluster's Incus API reachable through IncusCloud with the caller's own identity: `https://<cluster>.<IC_CLUSTER_DOMAIN>/1.0/…` for API clients (stock `incus` CLI, Terraform) and `https://<public>/clusters/<cluster>/…` for browsers, plus Incendio served per cluster at `/clusters/<cluster>/ui/`.

**Architecture:** A `GatewayHandler` plugged into the P1 front server (`createFront({ gateway })`). It resolves the cluster (host or path), authenticates (bearer JWT or BFF session → the session's access token), checks `can_access` in the platform store, then relays to `cluster.url` on `node:https` with `PinnedAgent` pinned to the cluster fingerprint and **no client certificate** (D1, D14). Bodies stream both ways; upgrades (websocket, `Upgrade: sftp`) are relayed as raw sockets after the cluster's 101. A batched writer records requests in `gateway_requests`.

**Tech Stack:** as P1; `ws` only in tests.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (D1, D9, D10, D11, D14, §3.3, §5), spike B (`incuscloud/docs/spikes.md`, `incuscloud/spikes/proxy.ts`).

## Global Constraints

- The gateway never presents the control plane's client certificate and never adds credentials beyond the caller's own token (D1).
- Upstream TLS is pinned to the cluster's SHA-256 fingerprint; mismatch → 502, no bytes sent.
- Error bodies on gateway paths are Incus-shaped: `{"type":"error","status":"","status_code":0,"operation":"","error_code":<n>,"error":"<msg>","metadata":null}` (§5).
- Nothing in request or response bodies is rewritten (§3.3.6).
- The session cookie and `x-ic-*` headers never reach a cluster.
- Code is GPL-3.0.

## Review Focus

- A browser on another site opening an exec websocket with the victim's session cookie (cross-site websocket hijacking): refused.
- A caller whose tenant is not placed on the cluster, or whose token is for another audience: 403 / 401 before any upstream connection.
- A cluster whose certificate changed (re-installed, MITM): 502, not a silent connection.
- Multi-GB uploads/downloads and long-lived exec/console sockets: constant memory, no timeouts on idle websockets, client disconnect closes upstream.
- A path like `/clusters/c1/../c2/1.0` or `/clusters/c1%2F..%2Fc2/1.0`: routes to c1 or 404, never to c2.

---

### Task 1: Cluster routing and resolution

**Files:** Create `incuscloud/server/src/gateway/route.ts`, `gateway/clusters-cache.ts`; Test `gateway/route.test.ts`, `gateway/clusters-cache.test.ts`

**Interfaces:**
- `routeRequest(req: { host?: string; url?: string }, clusterDomain: string): { name: string; path: string; mode: "host" | "path" } | null` — host `<name>.<clusterDomain>[:port]` → `{name, path: url}`; path `/clusters/<name>/(1.0|ui|documentation)(/…|?…)?` → `{name, path: rest}`; names must match the cluster name pattern; percent-encoded slashes/dots in the name segment → null.
- `class ClusterCache { constructor(db, ttlMs = 5000); get(name): Promise<ClusterRow | null>; invalidate(name?) }`.

- [ ] Step 1 tests: host match with/without port; other hosts → null; path variants (`/clusters/c1/1.0`, `/clusters/c1/1.0/instances?recursion=1`, `/clusters/c1/ui/`, `/clusters/c1/documentation/x`); `/clusters/c1` and `/clusters/c1/settings` → null (platform UI); traversal and encoded names → null; uppercase/invalid names → null; cache returns row, caches for TTL, sees deletes after invalidate.
- [ ] Steps 2–5: fail → implement → pass → commit.

### Task 2: Upstream relay (requests and upgrades)

**Files:** Create `gateway/relay.ts`, `gateway/incus-error.ts`; Modify `clusters/fake-incus.ts` (echo endpoints: `/1.0/echo` returns method/headers/body length; `/1.0/stream?bytes=N` streams N bytes; websocket upgrade `/1.0/ws` echo; `Upgrade: sftp` on `/1.0/sftp` echoing raw bytes; `/1.0/slow` delays); Test `gateway/relay.test.ts`

**Interfaces:**
- `incusError(status, message): string` (JSON body); `writeIncusError(res | socket, status, message)`.
- `class Upstreams { agentFor(cluster: { id; fingerprint }): PinnedAgent }` (one keep-alive agent per cluster+fingerprint, no client cert).
- `relayRequest(req, res, target: { url: string; agent; path: string; token?: string; clientIp: string }): void` — strips hop-by-hop, `cookie`, `authorization` (re-set from token), `x-ic-*`, `x-forwarded-*`; sets `host`, `x-forwarded-for`, `x-forwarded-proto`; pipes bodies (GET bodies included); upstream error before headers → 502 Incus-shaped; client abort → upstream destroyed.
- `relayUpgrade(req, socket, head, target): void` — writes the cluster's 101 head then pipes raw both ways; upstream non-101 answer relayed as a normal response; either side closing closes the other.

- [ ] Step 1 tests (against FakeIncus): headers forwarded/stripped (cookie, x-ic-client-ip never arrive; Authorization is the given token; X-Forwarded-For set); 5 MiB POST and GET-with-body arrive intact; 64 MiB download streams with bounded RSS growth (< 64 MiB); fingerprint mismatch → 502 Incus-shaped and fake saw no request; unreachable → 502; websocket echo through relayUpgrade; sftp-style raw upgrade echo; refused upgrade (404) relayed; client destroying socket closes upstream.
- [ ] Steps 2–5.

### Task 3: Gateway handler (auth, authz, BFF) wired into the server

**Files:** Create `gateway/handler.ts`; Modify `main.ts` (pass `gateway` to `createFront`), `app.ts`/`AppDeps` unchanged; Test `gateway/handler.test.ts` (harness + FakeIncus + real front server on port 0)

**Interfaces:**
- `createGateway(deps: AppDeps & { clusterDomain: string; clusters: ClusterCache; upstreams: Upstreams; log?: RequestLog }): GatewayHandler`.
- Flow per §3.3: route → cluster (404 unknown, 503 `status === "disabled"`) → principal (bearer or session; anonymous allowed only for `GET /1.0`; invalid bearer → 401) → `can_access` (403) → relay with the principal's token. Session-authenticated upgrades and non-GET requests need `Origin` absent or equal to `IC_PUBLIC_URL`'s origin (403). Host-mode requests ignore cookies (bearer only).

- [ ] Step 1 tests: unknown cluster 404 (Incus-shaped); anonymous `GET /1.0` reaches the cluster without Authorization; anonymous `GET /1.0/instances` → 401 without upstream contact; bearer of a user without access → 403; tenant member of a placed tenant → 200 and the fake saw `Authorization: Bearer <same token>` and no client certificate; session cookie in path mode → fake sees the session's access token, never the cookie; session websocket upgrade with foreign Origin → refused, same-origin → 101; host mode ignores a session cookie (→ 401); disabled cluster 503; path `/clusters/c1/../c2/1.0` never reaches c2.
- [ ] Steps 2–5.

### Task 4: Request log

**Files:** Modify `db/schema.ts` (+ `gatewayRequests(id bigserial, at, clusterId uuid null, actorType, actorId, method, path text (≤ 512, query stripped), status int, bytesIn bigint, bytesOut bigint, durationMs int, ip)`), migration; Create `gateway/request-log.ts`, `api/gateway-log.ts`; Test `gateway/request-log.test.ts`, `api/gateway-log.test.ts`

**Interfaces:**
- `class RequestLog { constructor(db, { sampleReads: number (0..1), flushMs = 1000, maxBatch = 200 }); record(entry): void (non-blocking); flush(): Promise<void>; stop() }` — writes always kept, reads (`GET`/`HEAD`) kept with probability `sampleReads`, upgrades always kept (logged at close with byte counts).
- Config `IC_GATEWAY_SAMPLE_READS` (default `0`).
- `GET /api/v1/gateway-requests?cluster&actor&before&limit` — platform viewers; tenant admins with `?tenant=` see their members' rows.

- [ ] Steps 1–5 (tests: batching, sampling 0/1, write always, flush on stop, DB failure does not throw, API filters and permissions).

### Task 5: Incendio per cluster

**Files:** Create `gateway/ui.ts`; Modify `config.ts` (`IC_UI_DIR`, optional), `gateway/handler.ts`; Test `gateway/ui.test.ts`

**Interfaces:**
- `serveUi(req, res, { uiDir, path, cluster })` — `/clusters/<name>/ui/<file>` served from `IC_UI_DIR` with content types, `cache-control` immutable for `assets/*`, SPA fallback to `index.html` for paths without an extension; `..` rejected; without a session or bearer → 302 `/auth/start?return_to=<original path>` for HTML requests.
- Incendio derives `ROOT_PATH` = `/clusters/<name>` from its URL, so its `/1.0` calls go through the gateway with the session.

- [ ] Steps 1–5 (tests: asset served with type; SPA fallback; traversal refused; no session → redirect; IC_UI_DIR unset → 404 Incus-shaped).

### Task 6: Live end to end with the stock CLI

**Files:** Create `incuscloud/scripts/dev-cluster-oidc.sh` (points a dev cluster's `oidc.*` at the dev Hydra and installs the dev CA in its trust store), `incuscloud/server/scripts/cli-e2e.ts`; Modify `incuscloud/scripts/dev-deps.sh` (cert SANs `*.127.0.0.1.nip.io`, `127.0.0.1.nip.io`), `scripts/dev-hydra.sh` (issuer host configurable: `IC_DEV_ISSUER_HOST`), `incuscloud/README.md`, `incuscloud/docs/spikes.md` (nothing) 

- [ ] Step 1: `cli-e2e.ts` drives the stock `incus` binary with its own `INCUS_CONF`: `remote add cluster-b https://cluster-b.127.0.0.1.nip.io:7443 --auth-type=oidc --accept-certificate` (device flow completed by `TestBrowser`), `incus list cluster-b:`, `incus launch`, `incus exec … -- echo ok`, `incus file push/pull` 32 MiB with sha256 match, `incus delete`. Expected: all succeed; `gateway_requests` has the writes.
- [ ] Step 2: a browser session fetches `/clusters/cluster-b/ui/` (200 HTML) and `/clusters/cluster-b/1.0` → `auth: trusted`.
- [ ] Step 3: commit; README section "Using clusters through IncusCloud".
