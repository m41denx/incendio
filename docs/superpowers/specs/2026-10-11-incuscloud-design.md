# IncusCloud — multi-cluster platform for Incus

Status: design, decided 2026-10-11. Branch `incuscloud`. Code in `incuscloud/`.
Open questions and blockers go to `QUESTIONS.md` (git-ignored, repo root).

## 1. Goal

One control plane over many Incus clusters, for internal teams and external
customers alike (untrusted tenants from day one). It does what PegaProx does for
Proxmox, on Incus:

- **Gateway (primary feature):** API clients log in once to the control plane
  and send plain Incus API calls to any cluster through a catch-all route.
- One console over every cluster; global inventory, metrics, audit.
- Tenant cloud: tenants, quotas across clusters, placement, self-service.
- Mobility: cross-cluster migration, scheduled replication, DR failover.
- Backups: schedules, retention, S3 targets, restore to any cluster.
- Balancing and maintenance (ProxLB port), HA policies.
- Networking: cluster-to-cluster OVN peering and tenant VPC peering.
- Kubernetes clusters provisioned centrally (no appliance per Incus cluster).
- Node lifecycle (patching, adding nodes) through the Firecloud daemon.

Assumption given by the maintainer: every cluster's HTTPS API (8443) is
reachable from the control plane. Clusters are Incus 7.5+ (Firecloud-built or
not); OVN is required only for the networking features.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Identity pass-through**: the control plane is the OIDC issuer; every cluster trusts it (`oidc.*`) and authorizes OIDC users with OpenFGA. The gateway forwards the caller's own bearer token and never adds credentials. | Incus stays the only enforcer of Incus permissions. Direct access to a cluster is exactly as safe as the gateway path. Stock `incus` CLI and Terraform work. Rejected: gateway-held per-user certificates (one stolen store owns every tenant everywhere) and gateway-side enforcement (re-implementing hundreds of endpoint checks). |
| D2 | **Ory Hydra (≥ v25.4)** issues tokens: JWT access tokens, authorization code + PKCE, client credentials, device authorization grant (RFC 8628). IncusCloud is Hydra's login/consent/device provider and owns users, tenants and federation. | Token issuance is the riskiest code to write; Hydra is a certified, headless OIDC server. Incus verifies JWT access tokens itself (`op.VerifyAccessToken`, audience-checked) and rejects opaque tokens when an audience is set. Keycloak/Zitadel would also work but bring a second user store we would have to sync. |
| D3 | **Incus identity = `sub` = IncusCloud user id** (`oidc.claim=sub`, `oidc.audience=incuscloud`). Service accounts are Hydra client-credentials clients whose `sub` is the service account id. | Stable across renames and email changes; one id in OpenFGA tuples everywhere. |
| D4 | **One OpenFGA server, one store per cluster** plus a `platform` store. The control plane holds desired grants in Postgres and writes them to each cluster's store. | Incus writes `server:incus` and `project:default` into its store; a shared store would merge clusters. |
| D5 | **Tenants own Incus projects**: tenant `acme` gets project `acme` (and `acme-<name>` for more) on each cluster it is placed on, created restricted with `limits.*` from the tenant's quota share. Tenant roles become `group:tenant-<id>-<role>#member` tuples on those projects. | Projects are Incus's isolation unit; restricted projects stop tenants from escaping (privileged containers, host paths, other networks). |
| D6 | **Control plane admin** = one TLS client certificate per cluster, used only by the worker (inventory, reconciliation, migrations, backups). The gateway never presents it. | Proxied calls must carry only the caller's identity: a client cert would make Incus treat the call as the trusted admin. |
| D7 | **Stack: Bun + Elysia + Drizzle (Postgres)**; reuse `@incendio/api` (Bun transport with mTLS and pinning). Tests use PGlite (embedded Postgres). | Same stack as the Kubernetes agent; one language with the UIs. |
| D8 | **HA on Kubernetes**: N stateless `api` replicas (gateway + platform API + static UIs) and `worker` replicas with leader election on a Postgres advisory lock; Postgres (CloudNativePG), OpenFGA and Hydra each HA. Helm chart in `incuscloud/deploy`. | Gateway outages cut tenants off; every piece must survive a node or cluster loss. OpenFGA must be up before Incus upgrades (the 7.5 `auth_openfga_security_tags` patch stops incusd otherwise). |
| D9 | **Two UIs, one product**: the platform UI (`@incuscloud/web`, React + Vite + Canonical react-components like Incendio) and the per-cluster console = **Incendio served by the gateway at `/clusters/<id>/ui/`**. Incendio already derives `ROOT_PATH` from the URL, so it calls `/clusters/<id>/1.0/...` unchanged. | Full per-cluster functionality for free; the platform UI only builds what spans clusters. |
| D10 | **Browser sessions are server-side** (BFF): an httpOnly session cookie; the gateway attaches the session's access token (refreshing it) to proxied calls. API clients send `Authorization: Bearer` themselves. | Tokens never reach browser JavaScript. |
| D11 | **Routing**: host routing `<cluster>.<CLUSTER_DOMAIN>` (wildcard DNS + wildcard certificate) is the default for API clients; the `/clusters/<cluster>/…` path prefix serves the browser (platform UI, Incendio console). | Spike B: the Incus Go client (CLI, Terraform provider) drops path prefixes. |
| D12 | **Licensing**: `incuscloud/` is GPL-3.0 (owner's decision, 2026-10-11). PegaProx (AGPL-3.0 with a Section 7(b) "Powered by PegaProx" attribution term) is a **feature reference only, no code copied**. ProxLB (GPL-3.0) algorithms are ported to TypeScript with attribution. | Copying PegaProx code would oblige us to show its branding in our UI. |
| D14 | **Gateway front on `node:https`, upstream on `node:https` + `PinnedAgent`** (from `@incendio/api/node`); Elysia serves the platform API on the same server through `app.handle`. Upgrades (websocket and `Upgrade: sftp`) are relayed as raw byte streams after the cluster's 101. | Spike B: `Bun.serve` cannot hand over the raw socket for SFTP; Bun's `fetch` cannot pin a self-signed leaf (it skips `checkServerIdentity` when `rejectUnauthorized` is false). 1 GiB each way at constant ~85 MiB RSS. |
| D15 | **Cross-cluster transfers relay through the worker by default** (both operation websockets piped message by message with backpressure); pull mode is tried first when the target can reach the source. | Spike C: relay needs only control plane → cluster connectivity; same speed as pull; 81 MiB peak for 512 MB with backpressure (451 MiB without). |
| D13 | **Kubernetes centrally**: CAPI + CAPN controllers run in the control plane's own Kubernetes; per tenant and cluster, the worker issues a project-restricted Incus certificate and points CAPN directly at the cluster. The per-cluster management appliance is not needed. | The control plane already reaches every cluster and runs on Kubernetes. |

## 3. Components

```
API clients (incus CLI, Terraform, scripts, platform UI, Incendio console)
      │ Authorization: Bearer <JWT>  (browser: session cookie → BFF)
      ▼
┌──────────────────────── IncusCloud control plane ─────────────────────────┐
│ api (N)     Gateway      /clusters/<id>/1.0/*  → forward, stream, ws      │
│             Platform API /api/v1/*  clusters, tenants, users, grants, …   │
│             Identity     /auth/*    login, consent, device, federation    │
│             Static       /  (platform UI), /clusters/<id>/ui/ (Incendio)  │
│ worker (N, one leader)   reconciler, inventory/metrics sync, jobs         │
│ Hydra (N)  OpenFGA (N)  Postgres (HA)                                     │
└───────────────────────────────────────────────────────────────────────────┘
      │ caller's token only (gateway)        │ admin cert (worker only)
      ▼                                      ▼
Incus cluster A, B, …  oidc.issuer=IncusCloud, authorization.client.oidc=openfga
```

One binary, `incuscloud`, with `--role api|worker|all` (`all` for development).

### 3.1 Platform authorization (OpenFGA `platform` store)

Types: `platform` (admin, operator, viewer), `tenant` (owner, admin, member,
viewer, parent platform), `cluster` (admin, viewer, can_access ← platform roles
or tenant placement), `user`, `group`. Platform API endpoints and the gateway's
"may this caller reach cluster X" check use it. Incus permissions inside a
cluster live in that cluster's store (D4).

### 3.2 Data (Postgres)

`clusters` (id, name, url, server_cert_pem, admin cert/key (encrypted with
`SECRET_KEY`), labels/region, status, fga_store_id, last_seen),
`cluster_members`, `users` (id, email, name, password hash, totp, disabled),
`identity_providers` (upstream OIDC for federation), `tenants` (id, slug,
name, quotas), `tenant_members`, `service_accounts`, `sessions`,
`grants` (desired Incus-level grants: subject, cluster, object, relation),
`tenant_placements` (tenant × cluster → project, limits), `audit_log`,
inventory tables (`instances`, `storage_pools`, `networks`, `metrics_samples`),
`jobs` (type, state, progress, payload, result, error; worker-executed),
`replication_policies`, `backup_policies`, `backup_targets`, `backups`,
`balancing_policies`, `k8s_clusters`, `peerings`.

### 3.3 Gateway request flow

1. Resolve cluster from path or host → 404 if unknown, 503 if disabled.
2. Authenticate: bearer JWT (verified against Hydra's JWKS, issuer, audience,
   expiry) or session cookie (BFF, refresh when near expiry) → 401 otherwise.
3. Authorize reachability: `platform` store check `can_access` on
   `cluster:<id>` → 403 otherwise.
4. Forward to `cluster.url` + rest of path, with the caller's bearer token,
   hop-by-hop headers stripped, `X-Forwarded-For` set; TLS pinned to the
   cluster certificate's SHA-256 (D14); **no client certificate**.
5. Stream request and response bodies as they come (image/backup transfers
   of many GB; GET bodies included, the CLI sends them); relay upgrades
   (websockets for exec/console/events, `Upgrade: sftp` for file transfer)
   as raw byte streams after the cluster's 101.
6. Rewrite nothing: Incus returns cluster-relative paths (`/1.0/operations/…`),
   which resolve against the gateway host (host routing) or ROOT_PATH
   (Incendio, path routing).
7. Audit: method, path, cluster, subject, status, bytes, duration (batched
   insert; reads are sampled by config, writes always logged).

## 4. Phases

Every phase ends working, tested and committed; later phases may revise
earlier ones.

| Phase | Content |
|---|---|
| P0 Spikes | **Done** — see `incuscloud/docs/spikes.md`: Hydra tokens accepted (client credentials, device flow with the stock CLI); proxy on node:https with raw upgrade relay; host routing required for the CLI; migration pull/refresh/relay |
| P1 Server core | config, db, logging, OpenAPI, cluster registry + enrolment, users/tenants/service accounts, Hydra login/consent/device, sessions, platform authz, audit |
| P2 Gateway | path + host routing, streaming, websockets, Incendio served per cluster, BFF |
| P3 Reconciler | cluster OIDC/OpenFGA configuration, per-cluster stores, tenant projects with limits, grant sync |
| P4 Platform UI | login, dashboard shell, clusters, tenants, users/service accounts, access, audit, console links |
| P5 Fleet | inventory + metrics sync, global instance list and search, dashboard |
| P6 Mobility | migration with pre-flight checks (live where possible), replication policies, DR failover |
| P7 Backups | targets (S3), policies, retention, restore anywhere |
| P8 Balancing | ProxLB port: per-cluster balancing, affinity/anti-affinity, maintenance; cross-cluster suggestions |
| P9 Tenant cloud | quotas across clusters, placement, self-service create |
| P10 Kubernetes | CAPI/CAPN in the control plane, clusters per tenant |
| P11 Networking | OVN interconnect peering, tenant VPC peering |
| P12 Nodes | patching and node add/remove through Firecloud |
| P13 Ship | Helm chart, docs, CI, release |

## 5. Error handling

- Gateway: upstream connect/TLS errors → 502 with an Incus-shaped error body
  (`{"type":"error","error_code":502,"error":"…"}`) so Incus clients show it.
- Reconciler: idempotent steps, exponential backoff, state and last error per
  cluster visible in the UI; never deletes Incus resources it did not create
  (tracked with `user.incuscloud.*` keys).
- Jobs: persisted state machine; a crashed worker's jobs are resumed or
  marked failed by the next leader.

## 6. Testing

- Unit: Bun test, PGlite, OpenFGA and Hydra as local binaries (in-memory) for
  integration tests; Incus fakes for edge cases.
- Live: the local Incus 7.5.1 as cluster A, a nested Incus container as
  cluster B (`incuscloud-dev` project), driven end to end through the gateway
  with the stock `incus` CLI.
