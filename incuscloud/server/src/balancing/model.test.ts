import { expect, test } from "bun:test";
import type { InstanceSnapshot, Snapshot } from "../fleet/collect.ts";
import { bytesOf, cpusOf, DEFAULT_POLICY, modelOf } from "./model.ts";

const GiB = 1024 ** 3;
const inst = (name: string, location: string, over: Partial<InstanceSnapshot> = {}): InstanceSnapshot => ({
  project: "acme",
  name,
  type: "container",
  status: "Running",
  location,
  description: "",
  architecture: "x86_64",
  createdAt: "",
  imageOs: "",
  imageRelease: "",
  limitsCpu: "2",
  limitsMemory: "1GiB",
  cpuNs: 1,
  memoryUsed: 512 * 1024 ** 2,
  memoryTotal: null,
  diskUsed: 2 * GiB,
  netRx: 0,
  netTx: 0,
  addresses: [],
  hints: {},
  stateful: false,
  ...over,
});
const snap = (instances: InstanceSnapshot[]): Snapshot => ({
  clustered: true,
  members: [
    { name: "d1", url: "", status: "Online", roles: [], architecture: "x86_64", cpuThreads: 4, memoryTotal: 8 * GiB, memoryUsed: 6 * GiB, load1: 3, uptimeS: 1 },
    { name: "d2", url: "", status: "Evacuated", roles: [], architecture: "x86_64", cpuThreads: 4, memoryTotal: 8 * GiB, memoryUsed: 1 * GiB, load1: 0.5, uptimeS: 1 },
    { name: "d3", url: "", status: "Online", roles: [], architecture: "x86_64", cpuThreads: 8, memoryTotal: 16 * GiB, memoryUsed: 2 * GiB, load1: 1, uptimeS: 1 },
  ],
  pools: [
    { member: "d1", name: "default", driver: "dir", status: "Created", spaceTotal: 100 * GiB, spaceUsed: 30 * GiB },
    { member: "d1", name: "fast", driver: "dir", status: "Created", spaceTotal: 50 * GiB, spaceUsed: 10 * GiB },
    { member: "d3", name: "default", driver: "dir", status: "Created", spaceTotal: 200 * GiB, spaceUsed: null },
  ],
  networks: [],
  instances,
});

test("sizes as Incus writes them", () => {
  expect(bytesOf("1GiB")).toBe(GiB);
  expect(bytesOf("512MB")).toBe(512e6);
  expect(bytesOf("2048")).toBe(2048);
  expect(bytesOf("50%")).toBeNull();
  expect(bytesOf("")).toBeNull();
  expect(cpusOf("2")).toBe(2);
  expect(cpusOf("0-3")).toBe(4);
  expect(cpusOf("0,2,4-5")).toBe(4);
  expect(cpusOf("")).toBeNull();
});

test("members: capacity and load per method; evacuated, offline and excluded members are in maintenance", () => {
  const { members } = modelOf(snap([]), { ...DEFAULT_POLICY, excludeMembers: ["d3"] }, new Map());
  expect(members.map((m) => [m.name, m.maintenance])).toEqual([
    ["d1", false],
    ["d2", true],
    ["d3", true],
  ]);
  expect(members[0]).toMatchObject({ total: { memory: 8 * GiB, cpu: 4, disk: 150 * GiB }, used: { memory: 6 * GiB, cpu: 3, disk: 40 * GiB } });
  // Unknown pool use counts as none.
  expect(members[2]!.used.disk).toBe(0);
});

test("guests: used from the inventory (cpu from the measured rate), assigned from limits", () => {
  const { guests } = modelOf(snap([inst("web", "d1"), inst("nolimits", "d1", { limitsCpu: "", limitsMemory: "50%", memoryUsed: 300 })]), DEFAULT_POLICY, new Map([["acme/web", 0.75]]));
  expect(guests[0]).toMatchObject({ project: "acme", name: "web", member: "d1", running: true, used: { memory: 512 * 1024 ** 2, cpu: 0.75, disk: 2 * GiB }, assigned: { memory: GiB, cpu: 2, disk: 2 * GiB } });
  // Without limits: what it uses now, and one CPU.
  expect(guests[1]).toMatchObject({ used: { cpu: 0 }, assigned: { memory: 300, cpu: 1 } });
});

test("what may move: stopped always; running VMs that can move live; other running ones only with restarts allowed; never frozen or excluded projects", () => {
  const s = snap([
    inst("stopped", "d1", { status: "Stopped", memoryUsed: null }),
    inst("ct", "d1"),
    inst("vm-live", "d1", { type: "virtual-machine", stateful: true }),
    inst("vm", "d1", { type: "virtual-machine" }),
    inst("frozen", "d1", { status: "Frozen" }),
    inst("theirs", "d1", { project: "keepout" }),
  ]);
  const movable = (allowRestart: boolean) =>
    modelOf(s, { ...DEFAULT_POLICY, allowRestart, excludeProjects: ["keepout"] }, new Map())
      .guests.filter((g) => g.movable)
      .map((g) => g.name);
  expect(movable(false)).toEqual(["stopped", "vm-live"]);
  expect(movable(true)).toEqual(["stopped", "ct", "vm-live", "vm"]);
  // A stopped guest uses nothing now.
  expect(modelOf(s, DEFAULT_POLICY, new Map()).guests[0]!.used.memory).toBe(0);
});

test("instances without a known member are left out", () => {
  expect(modelOf(snap([inst("lost", ""), inst("gone", "d9")]), DEFAULT_POLICY, new Map()).guests).toEqual([]);
});
