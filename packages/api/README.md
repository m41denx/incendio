# @incendio/api — TypeScript SDK for Incus

Typed client for the [Incus](https://linuxcontainers.org/incus/) REST API, built on axios.
Works in the browser (same-origin, like the Incendio UI) and in Node/Bun (mTLS or the local unix socket).

## 📦 What's inside?

| Entry | What it is |
|---|---|
| `@incendio/api` | **Humane client** — objects with methods; actions wait for their operations |
| `@incendio/api/api` | **API client** — stateless 1:1 wrapper over the REST endpoints |
| `@incendio/api/types` | Every API type, generated from Incus's Go structs |
| `@incendio/api/node` | Node/Bun transport: mTLS agent, unix socket, `ws` websockets |

### 🤗 Humane client `@incendio/api`

Object-oriented and stateful. Every action awaits its background operation, refreshes the local
object, and throws `IncusOperationError` if the operation fails.

```ts
import { createIncusClient } from "@incendio/api";

const client = createIncusClient({ project: "default" }); // browser: same origin

const web = await client.launchInstance({
  name: "web",
  image: "images:debian/12",       // remote:alias, local alias or fingerprint
  type: "container",
  config: { "limits.cpu": "2" },
});

const { exitCode, stdout } = await web.exec(["uname", "-a"]);
await web.writeFile("/etc/motd", "hello\n", { mode: 0o644 });
await web.setConfig({ "limits.memory": "2GiB", "limits.cpu": null }); // null unsets
await web.setDevice("data", { type: "disk", pool: "default", source: "data", path: "/srv" });

const snap = await web.createSnapshot("before-upgrade");
await snap.restore();

await web.stop({ force: true });
await web.delete();
```

More of it:

```ts
// Projects
const staging = await client.createProject({ name: "staging" });
const scoped = staging.use();                 // or client.useProject("staging")

// Images
await client.copyImage("images:alpine/edge", { aliases: ["alpine"], autoUpdate: true });

// Storage
const pool = await client.getStoragePool("default");
const vol = await pool.createVolume("data", { size: "20GiB" });
await vol.attachTo("web", "/srv/data");

// Terminals (xterm.js etc.) over websockets
const session = await web.execInteractive(["bash"], { width: 120, height: 40 });
session.onData((bytes) => term.write(bytes));
term.onData((text) => session.write(text));
term.onResize(({ cols, rows }) => session.resize(cols, rows));

// Events
const sub = await client.on("lifecycle", (e) => console.log(e.metadata.action, e.metadata.source));

// Trust tokens (`incus remote add <url> <token>`)
const token = await client.createTrustToken("laptop", { projects: ["staging"] });

// Cluster
for (const member of await client.listClusterMembers()) {
  if (member.isOnline) console.log(member.name, member.roles);
}
```

Humane classes: `Instance`, `InstanceSnapshot`, `InstanceBackup`, `ExecSession`, `Image`, `Profile`,
`Project`, `Network`, `StoragePool`, `StorageVolume`, `Certificate`, `ClusterMember`, `IncusOperation`.
Every object exposes `.data` (the raw API object) and `.$api` (its raw client) for anything not
wrapped.

### 🤖 API client `@incendio/api/api`

Stateless, one method per endpoint. Methods return the response `metadata`. Async endpoints return
the `Operation` for you to wait on.

```ts
import { IncusAPIClient } from "@incendio/api/api";

const api = new IncusAPIClient({ project: "default" });

const names = await api.instances.names();                          // ["web", …]
const vms = await api.instances.listFull({ type: "virtual-machine" }); // recursion=2, with state

const op = await api.instance("web").setState({ action: "restart" });
await api.operations.wait(op);

// Collections are keyed by name; sub-resources hang off item clients.
await api.profiles.create({ name: "gpu", devices: { gpu: { type: "gpu" } } });
await api.network("incusbr0").forwards.list();
await api.storagePool("default").volume("data").snapshots.create({ name: "s0" });
await api.networkZones.records("example.com").list();

// Conflict-safe updates with ETags
const { data, etag } = await api.networks.getWithEtag("incusbr0");
await api.networks.update("incusbr0", { ...data, description: "LAN" }, { etag }); // 412 if changed meanwhile
```

The humane client exposes this as `client.$api`.

Conventions:

- **Scope**: `project` and `target` default from the client options and can be overridden per call
  (`{ project, target }`). `withProject(name)` / `withTarget(name)` return a re-scoped client that
  shares the connection. Listings accept `{ allProjects: true, filter: "status eq Running" }`.
- **Lists**: `list()` returns full objects (`recursion=1`), `names()` returns names only, and
  `listFull()` (where the API has it) uses `recursion=2`.
- **Request bodies** are deep-partial (`Input<T, RequiredKeys>`). The daemon fills in defaults.
  `PUT` (`update`) replaces the object; `PATCH` (`patch`) merges into it.
- **Sync or async**: sync endpoints resolve to the metadata (or `void`). Async ones return an
  `Operation`. Endpoints that can be either return `Operation | null`.
- **Errors**: every failure throws `IncusError` (`status`, `code`, `isNotFound`, `isConflict`,
  `isPreconditionFailed`). A failed or cancelled operation throws `IncusOperationError`, which
  carries the `operation`.

Coverage: server, resources, metrics, config metadata, certificates, cluster (members, groups,
certificate), events, images and aliases, instances (state, exec, console, files, logs, metadata,
templates, snapshots, backups, NVRAM, access, rebuild), networks (forwards, load balancers, peers,
leases, state, allocations), network ACLs, address sets, integrations, zones and records,
operations, profiles, projects, storage pools, volumes (snapshots, backups, bitmaps, files, rebuild,
import), buckets (keys, backups) and warnings. Not wrapped (they upgrade the connection):
`…/sftp`, `…/nbd`, `…/port-forward`. Use `$r` (the axios instance) for anything else.

### 📚 Types `@incendio/api/types`

```ts
import type { Instance, InstancesPost, StorageVolume, LifecycleAction } from "@incendio/api/types";
```

`src/api/types/generated.ts` is generated from `lxc/incus` `shared/api/*.go`. Go's `omitempty`
becomes an optional field, embedded structs become `extends`, and typed consts become literal
unions such as `InstanceType`, `LifecycleAction` and `EventType`. The Swagger file can't be used
here: it flattens embedding and doesn't record which fields are optional.

```sh
INCUS_SRC=~/refs/incus bun run generate-types
```

## 🔌 Connecting

**Browser (Incendio UI):** `createIncusClient()` talks to the page origin. The browser handles the
TLS client certificate or OIDC session. Websockets use the global `WebSocket`.

**Node/Bun:** use the node transport. Websockets need the optional `ws` peer dependency.

```ts
import { createIncusClient } from "@incendio/api";
import { nodeTransport } from "@incendio/api/node";
import { readFileSync } from "node:fs";

// Local daemon over the unix socket ($INCUS_SOCKET, $INCUS_DIR, /var/lib/incus/unix.socket)
const local = createIncusClient(nodeTransport());

// Remote daemon with a trusted client certificate
const remote = createIncusClient({
  ...nodeTransport({
    url: "https://incus.example.com:8443",
    cert: readFileSync("client.crt"),
    key: readFileSync("client.key"),
    ca: readFileSync("server.crt"), // or insecure: true
  }),
  project: "default",
});

// OIDC bearer token
const oidc = createIncusClient({ url: "https://incus.example.com:8443", token: accessToken });
```

`IncusClientOptions` also accepts `requester` (your own axios instance), `axios` (extra axios
defaults), `websocket` (a custom connector) and `timeout`.

## 🧪 Development

```sh
bun run lint              # tsc
bun run test              # unit tests (mocked transport)
bun run build             # tsup → dist (esm + cjs + d.ts)

# Integration tests against a real daemon. They create and delete a throwaway project and container.
sudo -E bun test test/integration   # INCUS_IMAGE=<fingerprint> INCUS_POOL=<pool> optional
```

Layout follows [Pelican.ts](https://github.com/m41denx/Pelican.ts):

```
src/
  index.ts          humane entry (createIncusClient)
  api/              raw API client: one module per resource
    base/           transport, envelope handling, shared collection classes
    types/          generated API types
  humane/           object-oriented wrappers
  node.ts           Node transport
  types.ts          types entry
scripts/generate-types.ts
```
