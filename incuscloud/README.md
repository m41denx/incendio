# IncusCloud

A multi-cluster control plane for [Incus](https://linuxcontainers.org/incus/):
one sign-in, one API endpoint and one UI in front of many Incus clusters,
with tenants, service accounts and an audit log. Design:
[`docs/superpowers/specs/2026-10-11-incuscloud-design.md`](../docs/superpowers/specs/2026-10-11-incuscloud-design.md).

Licensed under GPL-3.0 (see `LICENSE`).

## Status

| Phase | What | State |
| --- | --- | --- |
| P0 | Spikes: Hydra tokens in Incus, authenticating proxy, cross-cluster moves | done ([results](docs/spikes.md)) |
| P1 | Server core: config, database, identity, sessions, authorization, platform API, cluster enrolment | done |
| P2 | Gateway: authenticated pass-through to each cluster's API, Incendio per cluster | done |
| P3 | Reconciler: cluster OIDC/OpenFGA configuration, tenant projects | done |
| P4 | Platform UI: clusters, tenants, users, service accounts, logs | done |

## How it fits together

- **Identity**: [Ory Hydra](https://www.ory.sh/hydra/) issues JWT access tokens
  (audience `incuscloud`). IncusCloud serves Hydra's login, consent and
  device-code pages and keeps the users. The stock `incus` CLI signs in with
  the device flow; the browser uses a server-side session.
- **Clusters trust Hydra directly** (`oidc.issuer`, `oidc.audience=incuscloud`,
  `oidc.claim=sub`, set by the reconciler), so a token works against every
  cluster and each cluster still enforces access itself.
- **Authorization**: one OpenFGA store (`incuscloud-platform`) holds platform,
  tenant and cluster roles. Each enrolled cluster also has its own store
  (`incuscloud-cluster-<cluster id>`) with the grants the reconciler writes
  for it. The database is the source of truth; tuples are its projection,
  re-synced at start.
- **Enrolment**: `incus config trust add incuscloud` on the cluster gives a
  token; `POST /api/v1/clusters` redeems it with a client certificate
  generated for that cluster, pinned by fingerprint.

## Using clusters through IncusCloud

Every enrolled cluster is reachable two ways, always as yourself (your token
is forwarded; IncusCloud never adds credentials and never uses its own
cluster certificate for your requests):

- **API clients** (`incus` CLI, Terraform): `https://<cluster>.<IC_CLUSTER_DOMAIN>`.
  ```sh
  incus remote add prod https://prod.clusters.example.com --auth-type=oidc
  ```
  The CLI follows the device flow: open the printed URL, sign in to
  IncusCloud, done. Tokens refresh by themselves.
- **Browsers**: `https://<public>/clusters/<cluster>/ui/` serves Incendio for
  that cluster with your IncusCloud session; its API calls go to
  `/clusters/<cluster>/1.0`.

Access needs `can_access` on the cluster (platform viewers and up, or
membership in a tenant placed on it). Requests that change something, and
every websocket/file transfer, are logged (`GET /api/v1/gateway-requests`);
reads are sampled with `IC_GATEWAY_SAMPLE_READS`.

The reconciler configures each enrolled cluster so that Incus enforces access
itself:

- `oidc.*` points at Hydra (see above).
- `authorization.openfga.*` points at the cluster's own store,
  `incuscloud-cluster-<cluster id>`, with `authorization.client.oidc=openfga`
  and `authorization.client.tls=allow`.
- Each tenant placed on the cluster gets a restricted Incus project, with
  `limits.*` taken from the tenant's quotas. Its default profile gets a root
  disk and a NIC (copied from the `default` project) and, where the project
  has quotas, per-instance defaults Incus requires (1 CPU, 1 GiB memory, a
  10 GiB root disk, each capped at the quota). The tenant owns the profile
  afterwards; only missing values are filled in.
- Unplacing a tenant revokes its grants but keeps its project: it may still
  hold instances, and the reconciler never deletes what it did not create.
- Grant tuples: tenant owners, admins and members get `operator` on the
  tenant's project, viewers get `viewer`. Never `admin`: an Incus project
  admin can edit the project itself and lift its restrictions. Platform admin, operator and
  viewer get the same role on `server:incus`.

A tenant member's token works directly against the cluster, with the same
limits as through the gateway.

## Platform UI

`incuscloud/web` (`@incuscloud/web`) is the platform's web UI: sign in at
`https://<public>/` and manage clusters (enrol, place tenants, reconcile,
console links), tenants (quotas, members, where they run), users, service
accounts (the secret is shown once) and the audit and gateway logs. What
each person sees follows their roles; the API decides every request. The
per-cluster console remains Incendio at `/clusters/<name>/ui/`.

```sh
cd incuscloud/web
bun run build        # → build/, served at / when IC_WEB_DIR points at it
bun run watch        # rebuild on change while scripts/dev.sh serves it
bun run test         # component tests (Vitest, jsdom)
```

`e2e/ui-e2e.cjs` drives a real browser (Playwright) through sign-in,
creating a user and a tenant, placing it on a cluster, a service account,
the console and a tenant member's view; `server/scripts/e2e-cleanup.ts`
removes what it created.

## Configuration

Settings are `IC_*` environment variables; `server/.env.example` lists them
all. The reconciler's settings:

- `IC_ROLE`: `api` (HTTP API and gateway), `worker` (reconciler) or `all`
  (both; default). Only one worker replica reconciles at a time, coordinated
  by a lease row in Postgres.
- `IC_OPENFGA_CLUSTER_URL`: OpenFGA's URL as the Incus clusters reach it.
  Default: `IC_OPENFGA_URL`.
- `IC_OPENFGA_CLUSTER_TOKEN`: the API token clusters use. Default:
  `IC_OPENFGA_TOKEN`. See [Security notes](#security-notes).
- `IC_WEB_DIR`: the platform UI build (`incuscloud/web/build`), served at `/`.
- `IC_RECONCILE_INTERVAL`: seconds, 10..86400, default 60. Each cluster is
  reconciled at least this often, and right after any API change that affects it.

## Development

```sh
scripts/dev-deps.sh        # once: Hydra and OpenFGA binaries, a development CA
scripts/dev.sh             # Hydra + OpenFGA (state in .dev/openfga.db) + server on https://127.0.0.1:7443
```

Sign in as `admin@incuscloud.dev` with the password in `.dev/admin-password`.

To use a dev cluster through the gateway, Hydra and OpenFGA must be reachable
from it: start with `IC_DEV_HOST=<host address on the cluster's network> scripts/dev.sh`,
enrol the cluster (`bun scripts/smoke.ts "$(incus config trust add incuscloud --quiet)"`
on that cluster), then run `scripts/dev-cluster-oidc.sh <project> <instance>`.
That script only installs the dev CA (`.dev/tls/ca.crt`) on the instance; the
reconciler sets `oidc.*` and `authorization.*`. Trust `.dev/tls/ca.crt` or
use `curl --cacert`.

```sh
cd server
bun test                                        # unit tests (PGlite, fakes)
IC_IT_HYDRA=1 IC_IT_OPENFGA=http://127.0.0.1:18080 bun test   # plus live Hydra/OpenFGA
IC_IT_POSTGRES=postgres://… bun test src/db     # migrations on real Postgres
IC_IT_TRUST_TOKEN=$(incus config trust add it --quiet) bun test src/clusters
bun scripts/smoke.ts [trust-token]              # end to end against scripts/dev.sh
bun scripts/cli-e2e.ts [cluster]                # stock incus CLI through the gateway
bun scripts/tenant-e2e.ts [cluster]             # a tenant member, through the gateway and directly
```

The server tests import `@incendio/api/node`; build it first
(`cd packages/api && bun run build`).

## API (P1)

All under `/api/v1`, bearer token or session cookie. Errors are
`{ "error": { "code", "message" } }`.

| Endpoint | Who |
| --- | --- |
| `GET me` | anyone signed in |
| `GET/POST users`, `GET/PATCH/DELETE users/:id` | platform admin (viewers read) |
| `GET/POST tenants`, `GET/PATCH/DELETE tenants/:id` | operators create; tenant admins rename; operators set quotas; owners delete |
| `GET tenants/:id/members`, `POST tenants/:id/members` (by email), `PUT/DELETE tenants/:id/members/:userId` | tenant admins; owners manage owners |
| `GET tenants/:id/placements` | anyone who can see the tenant: its clusters, projects and their status |
| `GET/POST service-accounts`, `POST service-accounts/:id/rotate`, `DELETE service-accounts/:id` | tenant admins for tenant accounts, platform admins otherwise |
| `GET/POST clusters`, `GET/PATCH/DELETE clusters/:id` | platform admins enrol; tenants see clusters they are placed on |
| `GET clusters/:id/tenants`, `PUT/DELETE clusters/:id/tenants/:tenantId` | platform operators place tenants |
| `POST clusters/:id/reconcile` | platform operators; returns 202 |
| `GET audit` | platform viewers; tenant admins with `?tenant=` |
| `GET gateway-requests` | platform viewers; tenant admins with `?tenant=` |

Browser: `/auth/start?return_to=/…`, `/auth/callback`, `/auth/logout`.
Hydra pages: `/auth/login`, `/auth/consent`, `/auth/device`.

## Security notes

- **One OpenFGA token is shared by all clusters.** Incus supports only a single
  static token (`authorization.openfga.api.token`), so the reconciler writes
  the same token to every cluster. Root on any enrolled cluster can read it,
  and OpenFGA accepts a preshared key for every store, so with it root can
  read or write tuples in any store on that OpenFGA: other clusters' stores
  and the platform store alike. That is, root on one cluster can grant itself
  access elsewhere.
- What helps today:
  1. A separate `IC_OPENFGA_CLUSTER_TOKEN` keeps the platform's own token off
     the clusters, so it can be rotated independently. It does not limit what
     the cluster token can do.
  2. Keep OpenFGA reachable only from the cluster networks and IncusCloud.
     This limits who can connect, not what a holder of the token can do.
- Planned hardening: a small OpenFGA proxy that issues per-cluster tokens,
  each scoped to that cluster's store. Until then, this is a known and
  accepted limitation.
