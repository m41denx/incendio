import { expect, test } from "bun:test";
import { type Candidate, choose } from "./placement.ts";

const GiB = 1024 ** 3;
const c = (name: string, freeGiB: number, o: Partial<Candidate> = {}): Candidate => ({
  clusterId: `id-${name}`,
  clusterName: name,
  project: "acme",
  placementStatus: "ready",
  clusterStatus: "ready",
  labels: {},
  memoryTotal: 32 * GiB,
  memoryUsed: (32 - freeGiB) * GiB,
  ...o,
});
const pick = (r: ReturnType<typeof choose>) => (r.ok ? r.pick.clusterName : r.reason);

test("the cluster with the most memory free after the request, among those it fits", () => {
  expect(pick(choose([c("a", 4), c("b", 20), c("c", 10)], { memory: 2 * GiB }))).toBe("b");
  // Fraction, not absolute: a small cluster half free beats a big one a third free.
  expect(pick(choose([c("small", 8, { memoryTotal: 16 * GiB, memoryUsed: 8 * GiB }), c("big", 30, { memoryTotal: 90 * GiB, memoryUsed: 60 * GiB })], { memory: GiB }))).toBe("small");
});

test("ties go by name, so the same request lands in the same place", () => {
  expect(pick(choose([c("b", 10), c("a", 10)], { memory: GiB }))).toBe("a");
});

test("only ready placements on usable clusters; degraded clusters still count", () => {
  expect(pick(choose([c("a", 30, { placementStatus: "error" }), c("b", 30, { clusterStatus: "error" }), c("d", 2, { clusterStatus: "degraded" })], { memory: GiB }))).toBe("d");
  expect(pick(choose([c("a", 30, { placementStatus: "pending" })], { memory: GiB }))).toBe("The tenant is not ready on any cluster");
});

test("a label selector narrows the choice, and says so when nothing matches", () => {
  const all = [c("a", 30, { labels: { region: "us" } }), c("b", 5, { labels: { region: "eu", tier: "gold" } })];
  expect(pick(choose(all, { memory: GiB }, { labels: { region: "eu" } }))).toBe("b");
  expect(pick(choose(all, { memory: GiB }, { labels: { region: "ap" } }))).toBe("No cluster of the tenant has region=ap");
});

test("an explicit cluster must be one of the tenant's ready placements", () => {
  const all = [c("a", 30), c("b", 2)];
  expect(pick(choose(all, { memory: GiB }, { clusterId: "id-b" }))).toBe("b");
  expect(pick(choose(all, { memory: GiB }, { clusterId: "id-z" }))).toBe("The tenant is not placed on that cluster");
});

test("nowhere with room: the reason says how much was needed", () => {
  expect(pick(choose([c("a", 1), c("b", 0.5)], { memory: 2 * GiB }))).toBe("No cluster has 2.0 GiB of memory free");
  // Unknown capacity (no inventory yet) is not ruled out, but comes last.
  expect(pick(choose([c("a", 1), c("new", 0, { memoryTotal: 0, memoryUsed: 0 })], { memory: 2 * GiB }))).toBe("new");
  expect(pick(choose([c("a", 8), c("new", 0, { memoryTotal: 0, memoryUsed: 0 })], { memory: 2 * GiB }))).toBe("a");
});
