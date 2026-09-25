/**
 * Runs against a real Incus daemon over the unix socket (needs access to it,
 * e.g. `sudo -E bun test test/integration`). Everything happens inside a
 * throwaway project that is deleted afterwards.
 *
 * INCUS_SOCKET  socket path (default: auto-detect)
 * INCUS_IMAGE   local container image fingerprint/alias (default: first local container image)
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createIncusClient, type IncusClient, type Instance } from "../../src";
import { nodeTransport } from "../../src/node";

const PROJECT = `sdk-it-${Date.now().toString(36)}`;
const root = createIncusClient(nodeTransport());
let client: IncusClient;
let pool: string;
let image: string;
let c1: Instance;

beforeAll(async () => {
  const defaultProfile = await root.getProfile("default");
  pool =
    process.env.INCUS_POOL ??
    defaultProfile.devices.root?.pool ??
    (await root.$api.storagePools.names())[0]!;
  image =
    process.env.INCUS_IMAGE ??
    (await root.listImages()).find((i) => i.type === "container")!.fingerprint;

  // Own profiles/volumes, shared images from the default project.
  await root.createProject({
    name: PROJECT,
    description: "@incendio/api integration test",
    config: { "features.images": "false" },
  });
  client = root.useProject(PROJECT);
}, 60_000);

afterAll(async () => {
  const project = await root.getProject(PROJECT).catch(() => null);
  if (!project) return;
  const instances = await client.listInstances().catch(() => []);
  for (const instance of instances) {
    await instance.delete({ force: true }).catch(() => undefined);
  }
  for (const name of await root.$api.storagePools.names()) {
    const volumes = client.$api.storagePool(name).volumes;
    for (const volume of await volumes.names().catch(() => [])) {
      await client.$api
        .storagePool(name)
        .volume(volume)
        .delete()
        .catch(() => undefined);
    }
  }
  await project.delete();
}, 120_000);

describe("server", () => {
  test("info reports a trusted connection", async () => {
    const info = await root.info();
    expect(info.auth).toBe("trusted");
    expect(info.api_extensions.length).toBeGreaterThan(100);
    expect(await root.hasExtension("instances")).toBe(true);
  });

  test("resources and metrics", async () => {
    const resources = await root.$api.server.resources();
    expect(resources.cpu.total).toBeGreaterThan(0);
    expect(await root.$api.server.metrics()).toContain("incus_");
  });
});

describe("profiles", () => {
  test("create, edit with ETag, rename, delete", async () => {
    const profile = await client.createProfile({
      name: "sdk",
      config: { "limits.cpu": "1" },
    });
    await profile.setConfig({ "limits.cpu": null, "limits.memory": "256MiB" });
    expect(profile.config).toEqual({ "limits.memory": "256MiB" });
    await profile.rename("sdk2");
    expect((await client.$api.profiles.names()).sort()).toEqual([
      "default",
      "sdk2",
    ]);
    await profile.delete();
  });
});

describe("instance lifecycle", () => {
  test("launch", async () => {
    c1 = await client.launchInstance({
      name: "c1",
      image,
      devices: { root: { type: "disk", path: "/", pool } },
    });
    expect(c1.isRunning).toBe(true);
    expect(c1.project).toBe(PROJECT);
  }, 120_000);

  test("exec returns output and exit code", async () => {
    expect(await c1.exec(["echo", "hello"])).toEqual({
      exitCode: 0,
      stdout: "hello\n",
      stderr: "",
    });
    const failed = await c1.exec(["sh", "-c", "echo oops >&2; exit 7"]);
    expect(failed.exitCode).toBe(7);
    expect(failed.stderr).toBe("oops\n");
    const env = await c1.exec(["sh", "-c", "echo $FOO; pwd"], {
      env: { FOO: "bar" },
      cwd: "/tmp",
    });
    expect(env.stdout).toBe("bar\n/tmp\n");
  }, 30_000);

  test("interactive exec over websockets", async () => {
    const session = await c1.execInteractive(
      ["sh", "-c", "read x; echo got:$x"],
      {
        interactive: false,
      },
    );
    let out = "";
    session.onData((bytes, stream) => {
      if (stream === "stdout") out += new TextDecoder().decode(bytes);
    });
    session.write("ping\n");
    session.closeStdin();
    expect(await session.wait()).toBe(0);
    expect(out).toBe("got:ping\n");
  }, 30_000);

  test("files", async () => {
    await c1.files.mkdir("/root/sdk", { mode: 0o750 });
    await c1.writeFile("/root/sdk/a.txt", "hello file", { mode: 0o640 });
    await c1.writeFile("/root/sdk/a.txt", "!", { write: "append" });
    expect(await c1.readTextFile("/root/sdk/a.txt")).toBe("hello file!");
    expect(await c1.listDir("/root/sdk")).toEqual(["a.txt"]);
    const stat = await c1.files.stat("/root/sdk/a.txt");
    expect(stat).toMatchObject({ type: "file", mode: 0o640, uid: 0 });
    await c1.files.symlink("/root/sdk/link", "a.txt");
    const link = await c1.files.get("/root/sdk/link");
    expect(link.type).toBe("symlink");
    await c1.deleteFile("/root/sdk", { recursive: true });
    expect(await c1.listDir("/root")).not.toContain("sdk");
  }, 30_000);

  test("config and devices", async () => {
    await c1.setConfig({ "user.sdk": "yes", "limits.cpu": "1" });
    await c1.refresh({ full: false });
    expect(c1.config["user.sdk"]).toBe("yes");
    await c1.setConfig({ "user.sdk": null });
    expect(c1.config["user.sdk"]).toBeUndefined();
    await c1.setDescription("sdk test instance");
    expect((await c1.$api.get()).description).toBe("sdk test instance");
  }, 30_000);

  test("snapshots", async () => {
    await c1.writeFile("/root/marker", "before");
    const snap = await c1.createSnapshot("s0");
    expect(snap.name).toBe("s0");
    await c1.writeFile("/root/marker", "after");
    await snap.restore();
    expect(await c1.readTextFile("/root/marker")).toBe("before");
    await snap.rename("s1");
    const snaps = await c1.getSnapshots({ refresh: true });
    expect(snaps.map((s) => s.name)).toEqual(["s1"]);
    const copy = await snaps[0]!.copyTo("c1-from-snap");
    expect(copy.name).toBe("c1-from-snap");
    await copy.delete();
    await snaps[0]!.delete();
    expect(await c1.$api.snapshots.names()).toEqual([]);
  }, 120_000);

  test("events stream lifecycle actions", async () => {
    const actions: string[] = [];
    const sub = await client.on("lifecycle", (e) => {
      if (e.metadata.name === "c1") actions.push(e.metadata.action);
    });
    await c1.stop({ force: true });
    expect(c1.isStopped).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    sub.close();
    expect(actions).toContain("instance-stopped");
  }, 60_000);

  test("rename, list, delete", async () => {
    await c1.rename("c2");
    expect(await client.$api.instances.names()).toEqual(["c2"]);
    const [listed] = await client.listInstances({ full: true });
    expect(listed!.state?.status).toBe("Stopped");
    await c1.delete();
    expect(await client.$api.instances.names()).toEqual([]);
  }, 60_000);
});

describe("storage volumes", () => {
  // No `size`: quota support depends on the pool driver/host (e.g. btrfs
  // quotas are unavailable in unprivileged VMs).
  test("create, files, snapshot, config, attach, delete", async () => {
    const storagePool = await client.getStoragePool(pool);
    const vol = await storagePool.createVolume("data", {
      config: { "user.purpose": "test" },
    });
    expect(vol.config["user.purpose"]).toBe("test");
    expect(vol.project).toBe(PROJECT);

    if (await client.hasExtension("file_storage_volume")) {
      await vol.files.write("/hello.txt", "from volume");
      expect(await vol.files.readText("/hello.txt")).toBe("from volume");
    }

    await vol.createSnapshot("snap0");
    expect((await vol.listSnapshots()).map((s) => s.name)).toEqual(["snap0"]);
    await vol.deleteSnapshot("snap0");

    await vol.setConfig({ "user.purpose": null, "user.owner": "sdk" });
    expect(vol.config).toEqual({ "user.owner": "sdk" });

    const holder = await client.createInstance({
      name: "holder",
      devices: { root: { type: "disk", path: "/", pool } },
    });
    await vol.attachTo("holder", "/mnt/data");
    await holder.refresh({ full: false });
    expect(holder.devices.data).toEqual({
      type: "disk",
      pool,
      source: "data",
      path: "/mnt/data",
    });
    expect((await vol.refresh()).usedBy).toHaveLength(1);
    await holder.delete();
    await vol.delete();
  }, 60_000);
});

describe("operations and errors", () => {
  test("404 surfaces as IncusError", async () => {
    const err = await client.getInstance("missing").catch((e: unknown) => e);
    expect((err as { isNotFound?: boolean }).isNotFound).toBe(true);
  });

  test("failed operation throws IncusOperationError", async () => {
    const err = await client
      .createInstance({ name: "bad", image: "0000000000000000" })
      .catch((e: unknown) => e);
    expect((err as Error).name).toMatch(/Incus(Operation)?Error/);
  });
});
