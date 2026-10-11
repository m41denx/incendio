import { expect, test } from "bun:test";
import { suggest, type SuggestInput } from "./suggest.ts";

const GiB = 1024 ** 3;
const base = (): SuggestInput => ({
  threshold: 20,
  clusters: [
    { id: "hot", name: "hot", memoryTotal: 100 * GiB, memoryUsed: 80 * GiB },
    { id: "cool", name: "cool", memoryTotal: 100 * GiB, memoryUsed: 30 * GiB },
    { id: "mid", name: "mid", memoryTotal: 100 * GiB, memoryUsed: 50 * GiB },
  ],
  placements: [
    { tenantId: "t1", tenantSlug: "acme", clusterId: "hot", project: "acme" },
    { tenantId: "t1", tenantSlug: "acme", clusterId: "cool", project: "acme-c" },
  ],
  instances: [
    { id: "i1", clusterId: "hot", project: "acme", name: "big", status: "Running", memoryUsed: 12 * GiB },
    { id: "i2", clusterId: "hot", project: "acme", name: "mid", status: "Running", memoryUsed: 8 * GiB },
    { id: "i3", clusterId: "hot", project: "acme", name: "small", status: "Running", memoryUsed: 1 * GiB },
    { id: "i4", clusterId: "hot", project: "acme", name: "off", status: "Stopped", memoryUsed: null },
    { id: "i5", clusterId: "hot", project: "other", name: "notours", status: "Running", memoryUsed: 30 * GiB },
  ],
});

test("a tenant on a hot and a cool cluster: its largest instances, until the gap is within the threshold", () => {
  const s = suggest(base());
  expect(s.map((x) => `${x.name}:${x.fromClusterId}→${x.toClusterId}:${x.toProject}`)).toEqual(["big:hot→cool:acme-c", "mid:hot→cool:acme-c"]);
  expect(s[0]).toMatchObject({ tenantId: "t1", tenantSlug: "acme", instanceId: "i1", project: "acme", memoryBytes: 12 * GiB });
  expect(s[0]!.reason).toBe("hot is at 80% memory, cool at 30%");
});

test("no suggestion within the threshold, for one cluster, or when a move would only flip the gap", () => {
  const b = base();
  b.threshold = 60;
  expect(suggest(b)).toEqual([]);
  const one = base();
  one.placements = one.placements.slice(0, 1);
  expect(suggest(one)).toEqual([]);
  // Gap of 25 points; the only instance would make it 35 the other way.
  const flip = base();
  flip.clusters[0]!.memoryUsed = 55 * GiB;
  flip.instances = [{ id: "i1", clusterId: "hot", project: "acme", name: "huge", status: "Running", memoryUsed: 30 * GiB }];
  expect(suggest(flip)).toEqual([]);
});

test("each tenant is suggested between its own clusters only", () => {
  const b = base();
  b.placements.push({ tenantId: "t2", tenantSlug: "beta", clusterId: "mid", project: "beta" }, { tenantId: "t2", tenantSlug: "beta", clusterId: "hot", project: "beta-h" });
  b.instances.push({ id: "b1", clusterId: "hot", project: "beta-h", name: "b", status: "Running", memoryUsed: 5 * GiB });
  const s = suggest(b);
  // beta: hot (80%) vs mid (50%): 30 points; its 5 GiB instance narrows it.
  expect(s.filter((x) => x.tenantId === "t2").map((x) => `${x.name}:${x.toClusterId}:${x.toProject}`)).toEqual(["b:mid:beta"]);
});
