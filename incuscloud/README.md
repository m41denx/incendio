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
| P2 | Gateway: authenticated pass-through to each cluster's API | next |

## How it fits together

- **Identity**: [Ory Hydra](https://www.ory.sh/hydra/) issues JWT access tokens
  (audience `incuscloud`). IncusCloud serves Hydra's login, consent and
  device-code pages and keeps the users. The stock `incus` CLI signs in with
  the device flow; the browser uses a server-side session.
- **Clusters trust Hydra directly** (`oidc.issuer`, `oidc.audience=incuscloud`,
  `oidc.claim=sub`), so a token works against every cluster and each cluster
  still enforces access itself.
- **Authorization**: one OpenFGA store (`incuscloud-platform`) holds platform,
  tenant and cluster roles. The database is the source of truth; tuples are
  its projection, re-synced at start.
- **Enrolment**: `incus config trust add incuscloud` on the cluster gives a
  token; `POST /api/v1/clusters` redeems it with a client certificate
  generated for that cluster, pinned by fingerprint.

## Development

```sh
scripts/dev-deps.sh        # once: Hydra and OpenFGA binaries, a development CA
scripts/dev.sh             # Hydra + OpenFGA (in memory) + server on https://127.0.0.1:7443
```

Sign in as `admin@incuscloud.dev` with the password in `.dev/admin-password`.
Trust `.dev/tls/ca.crt` or use `curl --cacert`.

```sh
cd server
bun test                                        # unit tests (PGlite, fakes)
IC_IT_HYDRA=1 IC_IT_OPENFGA=http://127.0.0.1:18080 bun test   # plus live Hydra/OpenFGA
IC_IT_POSTGRES=postgres://… bun test src/db     # migrations on real Postgres
IC_IT_TRUST_TOKEN=$(incus config trust add it --quiet) bun test src/clusters
bun scripts/smoke.ts [trust-token]              # end to end against scripts/dev.sh
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
| `GET/POST service-accounts`, `POST service-accounts/:id/rotate`, `DELETE service-accounts/:id` | tenant admins for tenant accounts, platform admins otherwise |
| `GET/POST clusters`, `GET/PATCH/DELETE clusters/:id` | platform admins enrol; tenants see clusters they are placed on |
| `GET clusters/:id/tenants`, `PUT/DELETE clusters/:id/tenants/:tenantId` | platform operators place tenants |
| `GET audit` | platform viewers; tenant admins with `?tenant=` |

Browser: `/auth/start?return_to=/…`, `/auth/callback`, `/auth/logout`.
Hydra pages: `/auth/login`, `/auth/consent`, `/auth/device`.
