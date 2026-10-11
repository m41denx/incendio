import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { IncusAdminClient } from "../incus/admin-client.ts";
import { generateClientCertificate } from "../incus/certs.ts";
import { ensureDefaultProfile, ensureProject, projectConfigFor } from "./projects.ts";

let fake: FakeIncus;
let client: IncusAdminClient;
const tenant = { id: "11111111-1111-1111-1111-111111111111", slug: "acme", quotas: { instances: 10, cpu: 8, memory: 16, disk: 100 } };

beforeAll(async () => {
  fake = await new FakeIncus().start();
  const id = await generateClientCertificate("t");
  client = new IncusAdminClient({ url: fake.url, fingerprint: fake.fingerprint, ...id });
  await client.request("POST", "/1.0/certificates", { type: "client", trust_token: fake.token(), name: "t" });
});
afterAll(() => fake.stop());
beforeEach(() => {
  for (const name of [...fake.projects.keys()]) if (name !== "default") fake.projects.delete(name);
});

test("project config: restricted, own images/profiles/volumes, shared networks, marker, limits", () => {
  expect(projectConfigFor(tenant)).toEqual({
    restricted: "true",
    "restricted.backups": "allow",
    "features.images": "true",
    "features.profiles": "true",
    "features.storage.volumes": "true",
    "features.storage.buckets": "true",
    "features.networks": "false",
    "user.incuscloud.tenant": tenant.id,
    "limits.instances": "10",
    "limits.cpu": "8",
    "limits.memory": "16GiB",
    "limits.disk": "100GiB",
  });
  expect(projectConfigFor({ ...tenant, quotas: {} })["limits.cpu"]).toBeUndefined();
});

test("creates the project, then only follows quota changes", async () => {
  expect(await ensureProject(client, "acme", tenant)).toBe("created");
  expect(fake.projects.get("acme")!.config["limits.memory"]).toBe("16GiB");
  expect(await ensureProject(client, "acme", tenant)).toBe("unchanged");
  expect(await ensureProject(client, "acme", { ...tenant, quotas: { instances: 20 } })).toBe("updated");
  const c = fake.projects.get("acme")!.config;
  expect(c["limits.instances"]).toBe("20");
  expect(c["limits.memory"]).toBeUndefined();
});

test("projects made before backups existed get restricted.backups=allow", async () => {
  expect(await ensureProject(client, "acme", tenant)).toBe("created");
  delete fake.projects.get("acme")!.config["restricted.backups"];
  expect(await ensureProject(client, "acme", tenant)).toBe("updated");
  expect(fake.projects.get("acme")!.config["restricted.backups"]).toBe("allow");
});

test("a project that is not this tenant's is refused and untouched", async () => {
  fake.projects.set("acme", { config: { "user.owner": "someone" }, description: "", profiles: new Map() });
  await expect(ensureProject(client, "acme", tenant)).rejects.toMatchObject({ status: 409 });
  expect(fake.projects.get("acme")!.config).toEqual({ "user.owner": "someone" });
});

test("the default profile gets the default project's root disk and NIC", async () => {
  await ensureProject(client, "acme", tenant);
  await ensureDefaultProfile(client, "acme");
  expect(fake.projects.get("acme")!.profiles.get("default")!.devices).toEqual({ root: { type: "disk", path: "/", pool: "local" }, eth0: { type: "nic", name: "eth0", network: "incusbr0" } });
  const puts = fake.patches.length;
  await ensureDefaultProfile(client, "acme");
  expect(fake.patches.length).toBe(puts);
});

test("without devices in the default project, the first pool and managed bridge are used", async () => {
  const def = fake.projects.get("default")!.profiles.get("default")!;
  const saved = def.devices;
  def.devices = {};
  fake.pools = [{ name: "fast", driver: "zfs" }];
  fake.networks = [{ name: "eth9", type: "physical", managed: false }, { name: "br1", type: "bridge", managed: true }];
  try {
    await ensureProject(client, "acme", tenant);
    await ensureDefaultProfile(client, "acme");
    expect(fake.projects.get("acme")!.profiles.get("default")!.devices).toEqual({ root: { type: "disk", path: "/", pool: "fast" }, eth0: { type: "nic", name: "eth0", network: "br1" } });
  } finally {
    def.devices = saved;
  }
});

test("with quotas, the default profile gets per-instance limits Incus requires, capped at the quota", async () => {
  await ensureProject(client, "acme", tenant);
  await ensureDefaultProfile(client, "acme", { cpu: 8, memory: 16, disk: 5 });
  const p = fake.projects.get("acme")!.profiles.get("default")!;
  expect(p.config).toEqual({ "limits.cpu": "1", "limits.memory": "1GiB" });
  expect(p.devices.root).toEqual({ type: "disk", path: "/", pool: "local", size: "5GiB" });
});

test("tenant-set profile limits are kept; no quotas, no limits", async () => {
  await ensureProject(client, "acme", tenant);
  const prof = fake.projects.get("acme")!.profiles.get("default")!;
  prof.config = { "limits.memory": "512MiB" };
  await ensureDefaultProfile(client, "acme", { memory: 16 });
  expect(prof.config).toEqual({ "limits.memory": "512MiB" });
  fake.projects.delete("acme");
  await ensureProject(client, "acme", { ...tenant, quotas: {} });
  await ensureDefaultProfile(client, "acme", {});
  expect(fake.projects.get("acme")!.profiles.get("default")!.config).toEqual({});
  expect(fake.projects.get("acme")!.profiles.get("default")!.devices.root!.size).toBeUndefined();
});
