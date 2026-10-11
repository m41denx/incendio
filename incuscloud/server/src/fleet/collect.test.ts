import { expect, test } from "bun:test";
import { ClusterError } from "../incus/admin-client.ts";
import { collectInventory } from "./collect.ts";

/** A client answering GETs from a path → metadata map (Incus JSON shapes), 404 otherwise. */
const stub = (routes: Record<string, unknown>) => ({
  seen: [] as string[],
  async request<T>(method: string, path: string) {
    this.seen.push(`${method} ${path}`);
    if (!(path in routes)) throw new ClusterError(404, `Cluster: not found ${path}`);
    return { type: "sync" as const, status_code: 200, metadata: routes[path] as T };
  },
});

const running = {
  name: "web",
  project: "acme",
  type: "container",
  status: "Running",
  location: "n1",
  description: "Front",
  architecture: "x86_64",
  created_at: "2026-10-01T10:00:00Z",
  config: { "user.secret": "never stored" },
  expanded_config: { "image.os": "Ubuntu", "image.release": "noble", "limits.cpu": "2", "limits.memory": "1GiB" },
  state: {
    status: "Running",
    cpu: { usage: 5_000_000_000 },
    memory: { usage: 100, total: 1000 },
    disk: { root: { usage: 4096, total: 0 }, data: { usage: -1 } },
    network: {
      eth0: { type: "broadcast", counters: { bytes_received: 10, bytes_sent: 20 }, addresses: [{ address: "10.0.0.5" }, { address: "fd42::5" }, { address: "fe80::1" }] },
      lo: { type: "loopback", counters: { bytes_received: 999, bytes_sent: 999 }, addresses: [{ address: "127.0.0.1" }, { address: "::1" }] },
    },
  },
};
const stopped = { ...running, name: "db", project: "default", status: "Stopped", description: "", expanded_config: {}, state: { status: "Stopped", cpu: { usage: 0 }, memory: { usage: 0, total: 0 }, disk: {}, network: null } };
const common = {
  "/1.0/instances?recursion=2&all-projects=true": [running, stopped],
  "/1.0/storage-pools?recursion=1": [{ name: "local", driver: "zfs", status: "Created" }],
  "/1.0/networks?recursion=1&all-projects=true": [
    { name: "incusbr0", project: "default", type: "bridge", managed: true, status: "Created", description: "" },
    { name: "eth0", project: "default", type: "physical", managed: false, status: "", description: "" },
  ],
};

test("a standalone server is one member named after it", async () => {
  const c = stub({
    ...common,
    "/1.0": { environment: { server_clustered: false, server_name: "solo" } },
    "/1.0/resources": { cpu: { total: 8, architecture: "x86_64" }, memory: { total: 8000, used: 3000 } },
    "/1.0/storage-pools/local/resources": { space: { total: 100, used: 40 } },
  });
  const s = await collectInventory(c);
  expect(s.clustered).toBe(false);
  expect(s.members).toEqual([{ name: "solo", url: "", status: "Online", roles: [], architecture: "x86_64", cpuThreads: 8, memoryTotal: 8000, memoryUsed: 3000, load1: null, uptimeS: null }]);
  expect(s.pools).toEqual([{ member: "solo", name: "local", driver: "zfs", status: "Created", spaceTotal: 100, spaceUsed: 40 }]);
  expect(s.networks).toEqual([{ project: "default", name: "incusbr0", type: "bridge", managed: true, status: "Created", description: "" }]);
});

test("a cluster's members carry their load, resources and per-member pool space", async () => {
  const c = stub({
    ...common,
    "/1.0": { environment: { server_clustered: true, server_name: "n1" } },
    "/1.0/cluster/members?recursion=1": [
      { server_name: "n1", url: "https://n1:8443", status: "Online", roles: ["database"], architecture: "x86_64" },
      { server_name: "n2", url: "https://n2:8443", status: "Offline", roles: [], architecture: "aarch64" },
    ],
    "/1.0/resources?target=n1": { cpu: { total: 16 }, memory: { total: 64, used: 16 } },
    "/1.0/cluster/members/n1/state": { sysinfo: { uptime: 3600, load_averages: [0.5, 0.4, 0.3] }, storage_pools: { local: { space: { total: 500, used: 50 } } } },
  });
  const s = await collectInventory(c);
  expect(s.clustered).toBe(true);
  expect(s.members).toEqual([
    { name: "n1", url: "https://n1:8443", status: "Online", roles: ["database"], architecture: "x86_64", cpuThreads: 16, memoryTotal: 64, memoryUsed: 16, load1: 0.5, uptimeS: 3600 },
    // An unreachable member keeps its listing with unknown numbers.
    { name: "n2", url: "https://n2:8443", status: "Offline", roles: [], architecture: "aarch64", cpuThreads: 0, memoryTotal: 0, memoryUsed: 0, load1: null, uptimeS: null },
  ]);
  expect(s.pools).toEqual([{ member: "n1", name: "local", driver: "zfs", status: "Created", spaceTotal: 500, spaceUsed: 50 }]);
});

test("instances: global addresses, summed counters, unknown disk as null, nothing from config", async () => {
  const c = stub({ ...common, "/1.0": { environment: { server_clustered: false, server_name: "solo" } }, "/1.0/resources": { cpu: { total: 1 }, memory: { total: 1, used: 1 } } });
  const s = await collectInventory(c);
  expect(s.instances[0]).toEqual({
    project: "acme",
    name: "web",
    type: "container",
    status: "Running",
    location: "n1",
    description: "Front",
    architecture: "x86_64",
    createdAt: "2026-10-01T10:00:00Z",
    imageOs: "Ubuntu",
    imageRelease: "noble",
    limitsCpu: "2",
    limitsMemory: "1GiB",
    cpuNs: 5_000_000_000,
    memoryUsed: 100,
    memoryTotal: 1000,
    diskUsed: 4096,
    netRx: 10,
    netTx: 20,
    addresses: ["10.0.0.5", "fd42::5"],
    hints: {},
    stateful: false,
  });
  expect(JSON.stringify(s)).not.toContain("never stored");
  expect(s.instances[1]).toMatchObject({ name: "db", status: "Stopped", cpuNs: null, memoryUsed: null, memoryTotal: null, diskUsed: null, netRx: null, netTx: null, addresses: [] });
});

test("balancing hints are the only config kept, and only well-formed ones", async () => {
  const hinted = {
    ...running,
    type: "virtual-machine",
    expanded_config: {
      ...running.expanded_config,
      "migration.stateful": "true",
      "user.incuscloud.affinity": " web ",
      "user.incuscloud.anti-affinity": "nodes",
      "user.incuscloud.pin": "n1, n2,,",
      "user.incuscloud.balance": "false",
      "user.incuscloud.other": "dropped",
      "user.note": "dropped",
    },
  };
  const odd = { ...stopped, name: "odd", expanded_config: { "user.incuscloud.balance": "maybe", "user.incuscloud.affinity": "", "user.incuscloud.pin": " , " } };
  const c = stub({ ...common, "/1.0/instances?recursion=2&all-projects=true": [hinted, odd], "/1.0": { environment: { server_clustered: false, server_name: "solo" } }, "/1.0/resources": { cpu: { total: 1 }, memory: { total: 1, used: 1 } } });
  const s = await collectInventory(c);
  expect(s.instances[0]!.hints).toEqual({ affinity: "web", antiAffinity: "nodes", pin: ["n1", "n2"], balance: false });
  expect(s.instances[0]!.stateful).toBe(true);
  expect(s.instances[1]!.hints).toEqual({});
  expect(JSON.stringify(s)).not.toContain("dropped");
});

test("only an unreadable instance list fails the pass", async () => {
  const c = stub({ "/1.0": { environment: { server_clustered: false, server_name: "solo" } } });
  await expect(collectInventory(c)).rejects.toThrow(/instances/);
});

test("a standalone server's location \"none\" is no location", async () => {
  const c = stub({ ...common, "/1.0": { environment: { server_clustered: false, server_name: "solo" } }, "/1.0/instances?recursion=2&all-projects=true": [{ ...running, location: "none" }] });
  expect((await collectInventory(c)).instances[0]!.location).toBe("");
});
