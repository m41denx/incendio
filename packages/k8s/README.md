# @incendio/k8s

Backend agent that the Incendio UI talks to for Kubernetes support. It hides
CAPN (Cluster API Provider for Incus) behind a stable REST API so the SPA never
has to orchestrate clusters directly.

> Design and rationale: see [`docs/k8s/README.md`](../../docs/k8s/README.md).

## Stack

- [Bun](https://bun.sh) runtime
- [Elysia](https://elysiajs.com) HTTP framework (CORS, bearer, JWT, cron, OpenAPI)
- [axios](https://axios-http.com) for outbound calls to the Incus API
- [`@t3-oss/env-core`](https://env.t3.gg) + [zod](https://zod.dev) for validated config

## Development

```sh
cp .env.example .env   # then edit AGENT_TOKEN / JWT_SECRET
bun run --filter '@incendio/k8s' dev     # from the repo root
# or, inside packages/k8s:
bun run dev
```

OpenAPI docs are served at `/openapi`.

## Scripts

| Script  | Description                                  |
| ------- | -------------------------------------------- |
| `dev`   | Run with hot reload                          |
| `start` | Run once                                     |
| `build` | Bundle to `dist/` with `bun build`           |
| `lint`  | Type-check with `tsc --noEmit`               |

## API (current, stubbed)

| Method + path        | Auth   | Purpose                                  |
| -------------------- | ------ | ---------------------------------------- |
| `GET /health`        | none   | Liveness probe                           |
| `GET /v1/info`       | none   | Handshake / capability discovery         |
| `GET /v1/clusters`   | bearer | List managed clusters                    |
| `POST /v1/clusters`  | bearer | Record a desired cluster spec            |
| `GET /v1/clusters/:id`    | bearer | Get one cluster                     |
| `DELETE /v1/clusters/:id` | bearer | Delete one cluster                  |

Provisioning is not wired to CAPN yet; cluster specs are held in memory.
