# @incendio/api — TypeScript SDK for Incus

Typed client for the [Incus](https://linuxcontainers.org/incus/) REST API, built on axios.
Works in the browser (same-origin, like the Incendio UI) and in Node/Bun (mTLS or the local unix socket).

## 📦 What's inside?

| Entry | What it is |
|---|---|
| `@incendio/api` | **Humane client** — objects with methods; actions wait for their operations |
| `@incendio/api/api` | **API client** — stateless 1:1 wrapper over the REST endpoints |
| `@incendio/api/types` | Every API type, generated from Incus's Go structs |
| `@incendio/api/k8s` | **Kubernetes** — management appliance + clusters through the Incendio agent |
| `@incendio/api/node` | Node/Bun transport: mTLS, certificate pinning, unix socket, `ws` websockets |

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

### ☸️ Kubernetes `@incendio/api/k8s`

Provisions Kubernetes clusters on Incus the way the UI's Kubernetes pages do: through the Incendio
agent running in the management appliance (single-node k3s + Cluster API + CAPN).

```ts
import { createIncusClient } from "@incendio/api";
import { createK8sClient } from "@incendio/api/k8s";
import { nodeK8sOptions, nodeTransport } from "@incendio/api/node";

const k8s = createK8sClient(createIncusClient(nodeTransport()), nodeK8sOptions);

// Deploys the appliance if there is none, then waits until clusters can be created
// (first boot takes several minutes: k3s, Cluster API and CAPN are installed).
await k8s.ensureManagement({ onStage: (s) => console.log(s.title) });

const cluster = await k8s.createCluster(
  {
    name: "demo",
    kubernetesVersion: "v1.37.0",            // default: newest prebuilt kubeadm image
    controlPlane: { count: 1, flavor: { cpu: 2, memoryGiB: 4 } },
    workers: { count: 2, flavor: "c2-m4", type: "vm" },
    loadBalancer: { type: "lxc" },           // or kube-vip / ovn / oci
    metallb: [(await k8s.metallbHint()).range!], // optional: LoadBalancer services via MetalLB
  },
  { onProgress: (s) => console.log(s.status, s.phase, s.message) },
);                                            // resolves when the cluster is ready

writeFileSync("demo.kubeconfig", await cluster.kubeconfig());

await cluster.scale({ workers: 3 });
await cluster.upgrade();                      // next allowed version (one minor at a time)
await cluster.setMetalLB();                   // or install/change it later (suggested range by default)
console.log((await cluster.metallb()).services); // LoadBalancer services and their external IPs
for (const node of await cluster.nodes()) console.log(node.role, node.name, node.machine?.phase);
await cluster.delete();                       // machines, load balancer and the Incus project
```

- `ClusterSpec` produces the same CAPN template variables as the UI's create form, with the same
  defaults: 1 control plane and 1 worker (`c2-m4` containers), flannel, and an LXC haproxy load
  balancer. A unit test compares the two builders. Control planes too small for kubeadm are rejected
  before anything is created.
- `waitUntilReady()` watches nodes that never join and fails fast with kubeadm's error (for example
  `[ERROR NumCPU]`) as a `K8sBootstrapError`, instead of waiting for the timeout.
- `waitUntilReady()` also stops when the agent reports a `problem` the cluster cannot recover
  from, for example an API endpoint its load balancer does not serve.
- **MetalLB** (agent 0.3.0+): `cluster.metallb()`, `setMetalLB(addresses?)`, `removeMetalLB()`, and
  `k8s.metallbHint(cluster?)` for a free range on the nodes' network.
- **Controllers** (agent 0.3.1+): `k8s.controllers()` lists the Cluster API controllers and any nodes
  they cannot reach; `k8s.restartControllers()` restarts them when they are stuck after the
  appliance was paused (the agent also does this on its own).
- `k8s.appliance` covers the management appliance: `deploy()`, `state()` (the UI's staged
  checklist), `waitUntilReady()`, `trust()`, `bootstrapLog()`, and `handle()`/`agent()`. The agent
  URL and token live in Incus server config (`user.k8s.api-config`), shared with the UI.
- **TLS:** the agent serves a self-signed certificate. In Node, `nodeK8sOptions` pins it by
  fingerprint. The fingerprint is read from inside the appliance over the authenticated Incus API,
  so the first connection doesn't have to be taken on trust. Browsers verify the certificate
  themselves: approve it once, as in the UI.
- Deploying without `credentials` generates the agent's Incus client certificate. That needs the
  optional `node-forge` peer dependency.
- `K8sAgentClient` is the raw `/v1` client, if you want the agent API without the helpers.

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

// Remote daemon with a trusted client certificate, pinning its self-signed server certificate
const remote = createIncusClient({
  ...nodeTransport({
    url: "https://incus.example.com:8443",
    cert: readFileSync("client.crt"),
    key: readFileSync("client.key"),
    serverCert: readFileSync("server.crt", "utf8"), // PEM or "sha256:<hex>" fingerprint
  }),
  project: "default",
});

// OIDC bearer token
const oidc = createIncusClient({ url: "https://incus.example.com:8443", token: accessToken });
```

Incus serves a self-signed certificate whose names usually don't include the address you dial, so
use `serverCert`, which pins the certificate by fingerprint, as `incus remote add` does. `ca` is only
for daemons with a CA-issued certificate.

Websockets (events, exec, console) use the same pinning. **Under Bun** there's one caveat: Bun's
`WebSocket` can't pin a certificate, so the pin is checked on a separate TLS connection just before
the websocket opens. Node checks every socket. REST calls are pinned per connection in both.

`IncusClientOptions` also accepts `requester` (your own axios instance), `axios` (extra axios
defaults), `websocket` (a custom connector) and `timeout`.

## 🚀 Releasing

Publishing to npm is automated by `.github/workflows/api-publish.yaml`, using npm trusted publishing
(OIDC, with provenance and no token secret):

1. Bump `version` in `packages/api/package.json`.
2. Push an annotated tag `api-v<version>` (e.g. `api-v0.2.0`).

The workflow runs the full test suite (including live Incus), builds, checks the tarball contents and
publishes. Pre-release versions (`0.2.0-rc.1`) go to the `next` dist-tag. Pushes that change the
workflow itself, and manual runs, are dry runs.

## 🧪 Development

```sh
bun run lint              # tsc
bun run test              # unit tests (mocked transport)
bun run build             # tsup → dist (esm + cjs + d.ts)

# Integration tests against a real daemon. They create and delete a throwaway project and container.
sudo -E bun test test/integration   # INCUS_IMAGE=<fingerprint> INCUS_POOL=<pool> optional
# k8s.test.ts checks an existing management appliance read-only (skipped without one).
# INCENDIO_K8S_E2E=1 also creates, waits for and deletes a 1-node cluster (~10 min).
# https.test.ts runs with INCUS_TEST_URL + INCUS_TEST_CLIENT_CERT/KEY (CI sets them up).
```

Layout follows [Pelican.ts](https://github.com/m41denx/Pelican.ts):

```
src/
  index.ts          humane entry (createIncusClient)
  api/              raw API client: one module per resource
    base/           transport, envelope handling, shared collection classes
    types/          generated API types
  humane/           object-oriented wrappers
  k8s/              Kubernetes: agent client, appliance, clusters, spec builder
  node.ts           Node transport
  types.ts          types entry
scripts/generate-types.ts
```
