import { specFromSize } from "./model.ts";
import { beforeEach, expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import type { Db } from "../db/index.ts";
import { clusterMembers, clusters, k8sClusters, tenants } from "../db/schema.ts";
import { FakeCluster } from "./fake-cluster.ts";
import { defaultNetwork, ensureForward, findLb, pickEndpoint, removeForward } from "./endpoint.ts";

let db: Db;
let clusterId: string;
let tenantId: string;

beforeEach(async () => {
  db = await testDb();
  clusterId = (await db.insert(clusters).values({ name: "lab", url: "https://10.0.0.5:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "" }).returning())[0]!.id;
  tenantId = (await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning())[0]!.id;
});

const taken = (port: number, host = "10.0.0.5") =>
  db.insert(k8sClusters).values({ tenantId, clusterId, name: `k${port}`, namespace: "ic-acme", version: "v1.36.4", controlPlanes: 1, workers: 0, size: "small", spec: specFromSize("small"), endpointHost: host, endpointPort: port, createdBy: "u" });

test("a single-member cluster: its address, the lowest free port, no member pinned", async () => {
  await db.insert(clusterMembers).values({ clusterId, name: "lab", url: "", status: "Online" });
  expect(await pickEndpoint(db, clusterId, [16443, 16446])).toEqual({ host: "10.0.0.5", port: 16443, member: "" });
  await taken(16443);
  await taken(16444, "10.9.9.9");
  expect(await pickEndpoint(db, clusterId, [16443, 16446])).toEqual({ host: "10.0.0.5", port: 16444, member: "" });
});

test("a multi-member cluster: everything on one member (one bridge without OVN), the one with most memory free, on its address", async () => {
  await db.insert(clusterMembers).values([
    { clusterId, name: "m1", url: "https://10.0.0.6:8443", status: "Online", memoryTotal: 8 * 2 ** 30, memoryUsed: 6 * 2 ** 30 },
    { clusterId, name: "m2", url: "https://10.0.0.7:8443", status: "Online", memoryTotal: 8 * 2 ** 30, memoryUsed: 2 * 2 ** 30 },
    { clusterId, name: "m3", url: "https://10.0.0.8:8443", status: "Offline", memoryTotal: 64 * 2 ** 30, memoryUsed: 0 },
  ]);
  expect(await pickEndpoint(db, clusterId, [16443, 16446])).toEqual({ host: "10.0.0.7", port: 16443, member: "m2" });
  // Ports are per address: another member's are its own.
  await taken(16443, "10.0.0.6");
  expect(await pickEndpoint(db, clusterId, [16443, 16446], "m1")).toEqual({ host: "10.0.0.6", port: 16444, member: "m1" });
});

test("a member asked for must be one of the cluster's, and online", async () => {
  await db.insert(clusterMembers).values([
    { clusterId, name: "m1", url: "https://10.0.0.6:8443", status: "Online" },
    { clusterId, name: "m3", url: "https://10.0.0.8:8443", status: "Offline" },
  ]);
  await expect(pickEndpoint(db, clusterId, [16443, 16446], "m9")).rejects.toThrow('lab has no member "m9"');
  await expect(pickEndpoint(db, clusterId, [16443, 16446], "m3")).rejects.toThrow("m3 is Offline");
});

test("a full range is refused", async () => {
  await db.insert(clusterMembers).values({ clusterId, name: "lab", url: "", status: "Online" });
  await taken(16443);
  await taken(16444);
  await expect(pickEndpoint(db, clusterId, [16443, 16444])).rejects.toThrow("No free port for a Kubernetes API endpoint on 10.0.0.5 (16443-16444)");
});

test("the network is the one the project's default profile attaches", async () => {
  const c = new FakeCluster();
  c.profileNetwork = "ovn0";
  expect(await defaultNetwork(c.client, "acme")).toBe("ovn0");
  expect(c.calls[0]!.path).toBe("/1.0/profiles/default?project=acme");
});

test("the load balancer is found by CAPN's keys, with its address and member", async () => {
  const c = new FakeCluster();
  const lb = (name: string, ns: string, addr: string) => ({
    name,
    project: "acme",
    location: "m2",
    config: { "user.cluster-name": "web", "user.cluster-namespace": ns, "user.cluster-role": "loadbalancer" },
    state: { network: { eth0: { addresses: [{ family: "inet6", address: "fd00::9", scope: "global" }, { family: "inet", address: addr, scope: "global" }] }, lo: { addresses: [{ family: "inet", address: "127.0.0.1", scope: "local" }] } } },
  });
  c.instances = [lb("web-x-lb", "other", "10.1.0.8"), { ...lb("web-node", "ic-acme", "10.1.0.4"), config: { "user.cluster-name": "web", "user.cluster-namespace": "ic-acme", "user.cluster-role": "control-plane" } }, lb("web-y-lb", "ic-acme", "10.1.0.9")];
  expect(await findLb(c.client, "acme", "web", "ic-acme")).toEqual({ name: "web-y-lb", member: "m2", address: "10.1.0.9" });
  expect(c.calls[0]!.path).toBe("/1.0/instances?project=acme&recursion=2");
  c.instances = c.instances.map((i) => ({ ...i, state: {} }));
  expect(await findLb(c.client, "acme", "web", "ic-acme")).toEqual({ name: "web-y-lb", member: "m2", address: null });
  c.instances = [];
  expect(await findLb(c.client, "acme", "web", "ic-acme")).toBeNull();
});

const ours = (id: string, port: number, target: string) => ({ description: `incuscloud k8s ${id}`, protocol: "tcp", listen_port: String(port), target_port: "6443", target_address: target });

test("a forward is created for the first endpoint on an address, on its member", async () => {
  const c = new FakeCluster();
  expect(await ensureForward(c.client, { network: "incusbr0", member: "m2", host: "10.0.0.7", port: 16443, target: "10.1.0.9", id: "k1" })).toBe("created");
  expect(c.forwards.get("incusbr0|10.0.0.7")).toMatchObject({ location: "m2", description: "IncusCloud Kubernetes endpoints", ports: [ours("k1", 16443, "10.1.0.9")] });
  expect(c.calls.at(-1)!.path).toBe("/1.0/networks/incusbr0/forwards?target=m2");
});

test("a forward that already says what we want is unchanged, however Incus orders and adds to its port fields", async () => {
  const c = new FakeCluster();
  const f = { network: "incusbr0", member: "m2", host: "10.0.0.7", port: 16443, target: "10.1.0.9", id: "k1" };
  await ensureForward(c.client, f);
  const { description, ...rest } = ours("k1", 16443, "10.1.0.9");
  c.forwards.get("incusbr0|10.0.0.7")!.ports = [{ ...rest, snat: false, description } as never];
  expect(await ensureForward(c.client, f)).toBe("unchanged");
});

test("a shared forward gets our port added or re-targeted; ports that are not ours are left alone", async () => {
  const c = new FakeCluster();
  c.forwards.set("incusbr0|10.0.0.5", { network: "incusbr0", listen_address: "10.0.0.5", description: "admin's", config: { "user.x": "1" }, location: "", ports: [{ description: "ssh", protocol: "tcp", listen_port: "2222", target_port: "22", target_address: "10.1.0.2" }] });
  const f = { network: "incusbr0", member: "", host: "10.0.0.5", port: 16443, target: "10.1.0.9", id: "k1" };
  expect(await ensureForward(c.client, f)).toBe("updated");
  expect(await ensureForward(c.client, f)).toBe("unchanged");
  expect(await ensureForward(c.client, { ...f, target: "10.1.0.10" })).toBe("updated");
  const fw = c.forwards.get("incusbr0|10.0.0.5")!;
  expect(fw.ports).toEqual([{ description: "ssh", protocol: "tcp", listen_port: "2222", target_port: "22", target_address: "10.1.0.2" }, ours("k1", 16443, "10.1.0.10")]);
  expect(fw).toMatchObject({ description: "admin's", config: { "user.x": "1" } });
});

test("removing keeps a forward that still has other ports or is not ours; deletes ours once empty", async () => {
  const c = new FakeCluster();
  const f = (id: string, port: number) => ({ network: "incusbr0", member: "", host: "10.0.0.5", port, target: "10.1.0.9", id });
  await ensureForward(c.client, f("k1", 16443));
  await ensureForward(c.client, f("k2", 16444));
  await removeForward(c.client, f("k1", 16443));
  expect(c.forwards.get("incusbr0|10.0.0.5")!.ports).toEqual([ours("k2", 16444, "10.1.0.9")]);
  await removeForward(c.client, f("k2", 16444));
  expect(c.forwards.has("incusbr0|10.0.0.5")).toBe(false);
  await removeForward(c.client, f("k2", 16444));

  c.forwards.set("incusbr0|10.0.0.6", { network: "incusbr0", listen_address: "10.0.0.6", description: "admin's", config: {}, location: "", ports: [ours("k3", 16443, "10.1.0.9")] });
  await removeForward(c.client, { network: "incusbr0", member: "", host: "10.0.0.6", port: 16443, target: "", id: "k3" });
  expect(c.forwards.get("incusbr0|10.0.0.6")).toMatchObject({ description: "admin's", ports: [] });
});

test("a port the operator already forwards is refused, not taken over", async () => {
  const c = new FakeCluster();
  c.forwards.set("incusbr0|10.0.0.5", { network: "incusbr0", listen_address: "10.0.0.5", description: "admin's", config: {}, location: "", ports: [{ description: "web", protocol: "tcp", listen_port: "16443", target_port: "443", target_address: "10.1.0.2" }] });
  await expect(ensureForward(c.client, { network: "incusbr0", member: "", host: "10.0.0.5", port: 16443, target: "10.1.0.9", id: "k1" })).rejects.toThrow("Port 16443 on 10.0.0.5 is already forwarded (web)");
  expect(c.forwards.get("incusbr0|10.0.0.5")!.ports).toHaveLength(1);
});
