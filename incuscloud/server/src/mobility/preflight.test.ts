import { expect, test } from "bun:test";
import { preflight, type PreflightInput, type SourceInstance, type TargetFacts } from "./preflight.ts";

const source = (over: Partial<SourceInstance> = {}): SourceInstance => ({
  name: "web",
  type: "container",
  status: "Stopped",
  architecture: "aarch64",
  config: { "limits.memory": "1GiB", "volatile.uuid": "x", "volatile.base_image": "abc", "volatile.eth0.hwaddr": "00:16" },
  devices: {},
  profiles: ["default"],
  expandedDevices: { root: { type: "disk", path: "/", pool: "fast", size: "8GiB" }, eth0: { type: "nic", name: "eth0", network: "incusbr0" } },
  snapshots: 0,
  apiExtensions: ["migration_vm_live"],
  ...over,
});
const target = (over: Partial<TargetFacts> = {}): TargetFacts => ({
  projectExists: true,
  architectures: ["aarch64"],
  pools: ["default"],
  networks: ["incusbr0"],
  profiles: ["default"],
  instanceNames: [],
  defaultProfileDevices: { root: { type: "disk", path: "/", pool: "default" }, eth0: { type: "nic", name: "eth0", network: "incusbr0" } },
  apiExtensions: ["migration_vm_live"],
  ...over,
});
const run = (over: Partial<PreflightInput> = {}) => preflight({ source: source(), target: target(), targetName: "web", mode: "copy", live: false, ...over });

test("a plain stopped container copies cleanly: root pool mapped, volatile keys dropped", () => {
  const r = run();
  expect(r.problems).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.request).toEqual({
    name: "web",
    type: "container",
    architecture: "aarch64",
    config: { "limits.memory": "1GiB", "volatile.base_image": "abc" },
    devices: { root: { type: "disk", path: "/", pool: "default", size: "8GiB" } },
    profiles: ["default"],
  });
});

test("a live move needs Incus's boot record of the running VM (lost after a live move into a restricted project)", () => {
  const vm = (bootState?: string) =>
    source({ type: "virtual-machine", status: "Running", config: { "migration.stateful": "true", ...(bootState !== undefined && { "volatile.vm.boot_state": bootState }) }, apiExtensions: ["migration_vm_live"] });
  const live = (s: SourceInstance) => preflight({ source: s, target: target({ apiExtensions: ["migration_vm_live"] }), targetName: "web", mode: "move", live: true });
  expect(live(vm('{"version":1,"machine_type":"pc-q35-11.1"}')).ok).toBe(true);
  for (const lost of ['{"version":-1,"machine_type":""}', undefined, "not json"]) {
    expect(live(vm(lost)).problems).toEqual(["Restart this VM before moving it live: Incus has no record of how it booted (as after a live move into a tenant project)"]);
  }
});

test("a move keeps the volatile keys (a VM restored live needs its identity); a copy drops them", () => {
  expect(run({ mode: "move" }).request.config).toEqual({ "limits.memory": "1GiB", "volatile.uuid": "x", "volatile.base_image": "abc", "volatile.eth0.hwaddr": "00:16" });
  expect(Object.keys(run({ mode: "copy" }).request.config)).toEqual(["limits.memory", "volatile.base_image"]);
});

test("the pool: explicit, else the target default profile's, else the only one, else ask", () => {
  expect(run({ pool: "default" }).request.devices.root!.pool).toBe("default");
  expect(run({ pool: "nope" }).problems).toContain('Storage pool "nope" does not exist on the target');
  expect(run({ target: target({ pools: ["a", "b"], defaultProfileDevices: { root: { type: "disk", path: "/", pool: "b" } } }) }).request.devices.root!.pool).toBe("b");
  expect(run({ target: target({ pools: ["only"], defaultProfileDevices: {} }) }).request.devices.root!.pool).toBe("only");
  expect(run({ target: target({ pools: ["a", "b"], defaultProfileDevices: {} }) }).problems).toContain("Choose a storage pool on the target");
});

test("each blocker is a problem", () => {
  expect(run({ target: target({ projectExists: false }) }).problems).toContain("The target project does not exist");
  expect(run({ target: target({ instanceNames: ["web"] }) }).problems).toContain('An instance named "web" already exists on the target');
  expect(run({ target: target({ architectures: ["x86_64"] }) }).problems).toContain("The target has no aarch64 members");
  expect(run({ source: source({ profiles: ["default", "gpu"] }) }).problems).toContain('Profile "gpu" does not exist on the target');
  const r = run({ target: target({ projectExists: false }) });
  expect(r.ok).toBe(false);
});

test("NICs: a local NIC needs its network on the target; the default profile's comes from the target's", () => {
  const local = source({ devices: { eth1: { type: "nic", network: "private" } }, expandedDevices: { ...source().expandedDevices, eth1: { type: "nic", network: "private" } } });
  expect(run({ source: local }).problems).toContain('Network "private" (eth1) does not exist on the target');
  expect(run({ source: local, target: target({ networks: ["incusbr0", "private"] }) }).request.devices.eth1).toEqual({ type: "nic", network: "private" });
  // eth0 comes from the source's default profile: the target's default profile gives its own.
  expect(run({ target: target({ networks: ["other"], defaultProfileDevices: { root: { type: "disk", path: "/", pool: "default" }, eth0: { type: "nic", network: "other" } } }) }).problems).toEqual([]);
  expect(run({ target: target({ defaultProfileDevices: { root: { type: "disk", path: "/", pool: "default" } } }) }).warnings).toContain('The target\'s default profile has no "eth0": the instance will have no such NIC there');
});

test("attached volumes block; host paths and other devices are warnings", () => {
  const withVolume = source({ devices: { data: { type: "disk", pool: "fast", source: "vol1", path: "/data" } }, expandedDevices: { ...source().expandedDevices, data: { type: "disk", pool: "fast", source: "vol1", path: "/data" } } });
  expect(run({ source: withVolume }).problems).toContain('Volume "vol1" (data) is not migrated; detach it first');
  const withHost = source({ devices: { logs: { type: "disk", source: "/srv/logs", path: "/logs" }, gpu0: { type: "gpu" } }, expandedDevices: { ...source().expandedDevices, logs: { type: "disk", source: "/srv/logs", path: "/logs" }, gpu0: { type: "gpu" } } });
  const r = run({ source: withHost });
  expect(r.problems).toEqual([]);
  expect(r.warnings).toContain('Host path "/srv/logs" (logs) must exist on the target');
  expect(r.warnings).toContain("gpu0 (gpu) is copied as is");
});

test("moving or copying a running container, and snapshots", () => {
  expect(run({ mode: "move", source: source({ status: "Running" }) }).warnings).toContain("The container is stopped for the move and started again on the target");
  expect(run({ mode: "copy", source: source({ status: "Running" }) }).warnings).toContain("The copy is not started");
  expect(run({ source: source({ snapshots: 3 }) }).warnings).toContain("3 snapshots are copied too");
});

test("live moves: only running VMs with migration.stateful, on both sides", () => {
  const vm = source({ type: "virtual-machine", status: "Running", config: { "migration.stateful": "true", "volatile.vm.boot_state": '{"version":1,"machine_type":"pc-q35-11.1"}' } });
  expect(run({ live: true, mode: "move", source: vm }).problems).toEqual([]);
  expect(run({ live: true, source: source({ status: "Running" }) }).problems).toContain("Containers cannot move live");
  expect(run({ live: true, source: { ...vm, status: "Stopped" } }).problems).toContain("Only a running instance moves live");
  expect(run({ live: true, source: { ...vm, config: {} } }).problems).toContain("Live moves need migration.stateful=true on the instance");
  expect(run({ live: true, source: vm, target: target({ apiExtensions: [] }) }).problems).toContain("The target does not support live VM migration");
});
