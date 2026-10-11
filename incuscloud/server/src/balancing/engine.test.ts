import { expect, test } from "bun:test";
import { type Guest, type Member, plan, spread } from "./engine.ts";

const GiB = 1024 ** 3;
const member = (name: string, memUsedGiB: number, o: Partial<Member> = {}): Member => ({ name, maintenance: false, total: { memory: 16 * GiB, cpu: 8, disk: 100 * GiB }, used: { memory: memUsedGiB * GiB, cpu: 1, disk: 10 * GiB }, ...o });
const guest = (name: string, on: string, memGiB: number, o: Partial<Guest> = {}): Guest => ({
  project: "acme",
  name,
  member: on,
  type: "container",
  running: true,
  movable: true,
  used: { memory: memGiB * GiB, cpu: 0.5, disk: 1 * GiB },
  assigned: { memory: memGiB * GiB, cpu: 1, disk: 5 * GiB },
  hints: {},
  ...o,
});
const base = { method: "memory" as const, mode: "used" as const, balanciness: 10, maxMoves: 10 };
const moves = (p: ReturnType<typeof plan>) => p.moves.map((m) => `${m.name}:${m.from}→${m.to}:${m.reason}`);

test("spread is the highest member percentage minus the lowest", () => {
  expect(spread([member("a", 12), member("b", 4)], [], "memory", "used")).toBe(50);
  // Assigned: what the guests were given, over capacity.
  expect(spread([member("a", 0), member("b", 0)], [guest("x", "a", 8)], "memory", "assigned")).toBe(50);
});

test("balanced enough: nothing moves", () => {
  const p = plan({ ...base, members: [member("a", 6), member("b", 5)], guests: [guest("x", "a", 2)] });
  expect(p.moves).toEqual([]);
  expect(p.before).toBeCloseTo(6.25);
});

test("the larger guests on the busiest member move to the most free one until the spread is within the threshold", () => {
  const p = plan({ ...base, members: [member("a", 12), member("b", 2), member("c", 4)], guests: [guest("small", "a", 1), guest("big", "a", 4), guest("mid", "a", 2)] });
  expect(moves(p)).toEqual(["big:a→b:balance", "mid:a→c:balance"]);
  expect(p.after).toBeLessThanOrEqual(10);
  expect(p.after).toBeLessThan(p.before);
});

test("a move that would overfill the target or not help is not planned", () => {
  // Only guest is bigger than the gap: moving it would just swap the imbalance.
  const p = plan({ ...base, members: [member("a", 10), member("b", 4)], guests: [guest("huge", "a", 9)] });
  expect(p.moves).toEqual([]);
  expect(p.notes.join(" ")).toMatch(/no move improves/i);
  const full = plan({ ...base, members: [member("a", 15), member("b", 14, { total: { memory: 16 * GiB, cpu: 8, disk: 100 * GiB } })], guests: [guest("g", "a", 4)] });
  expect(full.moves).toEqual([]);
});

test("guests that may not move stay: balance=false, unmovable (running containers without restart), maintenance members", () => {
  const p = plan({
    ...base,
    members: [member("a", 14), member("b", 2), member("m", 0, { maintenance: true })],
    guests: [guest("keep", "a", 6, { hints: { balance: false } }), guest("live", "a", 4, { movable: false }), guest("ok", "a", 3)],
  });
  expect(moves(p)).toEqual(["ok:a→b:balance"]);
  // The maintenance member is never a target, nor counted in the spread.
  expect(p.moves.every((m) => m.to !== "m")).toBe(true);
});

test("an affinity group moves together, to where it fits", () => {
  const p = plan({
    ...base,
    members: [member("a", 13), member("b", 2), member("c", 5)],
    guests: [guest("web1", "a", 2, { hints: { affinity: "web" } }), guest("web2", "a", 2, { hints: { affinity: "web" } }), guest("db", "a", 1)],
  });
  expect(moves(p)).toEqual(["web1:a→b:balance", "web2:a→b:balance", "db:a→c:balance"]);
});

test("a split affinity group is gathered where most of it already runs", () => {
  const p = plan({
    ...base,
    balanciness: 100,
    members: [member("a", 6), member("b", 6)],
    guests: [guest("w1", "a", 1, { hints: { affinity: "web" } }), guest("w2", "a", 1, { hints: { affinity: "web" } }), guest("w3", "b", 1, { hints: { affinity: "web" } })],
  });
  expect(moves(p)).toEqual(["w3:b→a:affinity"]);
});

test("affinity groups are per project: another tenant's group of the same name is unrelated", () => {
  const p = plan({
    ...base,
    balanciness: 100,
    members: [member("a", 6), member("b", 6)],
    guests: [guest("w1", "a", 1, { hints: { affinity: "web" } }), guest("w2", "b", 1, { project: "other", hints: { affinity: "web" } })],
  });
  expect(p.moves).toEqual([]);
});

test("anti-affinity spreads a group over members, and says when it cannot", () => {
  const p = plan({
    ...base,
    balanciness: 100,
    members: [member("a", 6), member("b", 4)],
    guests: [guest("n1", "a", 1, { hints: { antiAffinity: "nodes" } }), guest("n2", "a", 1, { hints: { antiAffinity: "nodes" } }), guest("n3", "a", 1, { hints: { antiAffinity: "nodes" } })],
  });
  expect(moves(p)).toEqual(["n2:a→b:anti-affinity"]);
  expect(p.notes.join(" ")).toMatch(/anti-affinity group "nodes".*3 instances.*2 members/i);
});

test("balancing never breaks anti-affinity", () => {
  const p = plan({
    ...base,
    members: [member("a", 14), member("b", 2)],
    guests: [guest("n1", "a", 4, { hints: { antiAffinity: "x" } }), guest("n2", "b", 1, { hints: { antiAffinity: "x" } }), guest("other", "a", 2)],
  });
  expect(moves(p)).toEqual(["other:a→b:balance"]);
});

test("a pinned guest goes to an allowed member and never elsewhere", () => {
  const p = plan({
    ...base,
    balanciness: 100,
    members: [member("a", 6), member("b", 4), member("c", 2)],
    guests: [guest("p", "a", 2, { hints: { pin: ["b"] } })],
  });
  expect(moves(p)).toEqual(["p:a→b:pin"]);
  const q = plan({ ...base, members: [member("a", 14), member("b", 1)], guests: [guest("p", "a", 4, { hints: { pin: ["a"] } })] });
  expect(q.moves).toEqual([]);
});

test("maxMoves bounds the plan, and no guest moves twice", () => {
  const guests = Array.from({ length: 6 }, (_, i) => guest(`g${i}`, "a", 1));
  const p = plan({ ...base, maxMoves: 2, members: [member("a", 15), member("b", 1)], guests });
  expect(p.moves.length).toBe(2);
  expect(p.notes.join(" ")).toMatch(/2 moves/);
  const all = plan({ ...base, members: [member("a", 15), member("b", 1)], guests });
  expect(new Set(all.moves.map((m) => m.name)).size).toBe(all.moves.length);
});

test("cpu and disk methods, assigned mode", () => {
  const members = [member("a", 4, { used: { memory: 4 * GiB, cpu: 6, disk: 10 * GiB } }), member("b", 4, { used: { memory: 4 * GiB, cpu: 1, disk: 10 * GiB } })];
  const cpu = plan({ ...base, method: "cpu", members, guests: [guest("hot", "a", 1, { used: { memory: GiB, cpu: 2, disk: GiB } })] });
  expect(moves(cpu)).toEqual(["hot:a→b:balance"]);
  const assigned = plan({ ...base, mode: "assigned", members: [member("a", 0), member("b", 0)], guests: [guest("x", "a", 6), guest("y", "a", 2)] });
  // Either move halves the spread: the larger unit wins the tie.
  expect(moves(assigned)).toEqual(["x:a→b:balance"]);
});

test("the same input gives the same plan", () => {
  const input = { ...base, members: [member("a", 12), member("b", 2), member("c", 2)], guests: [guest("g1", "a", 2), guest("g2", "a", 2), guest("g3", "a", 2)] };
  expect(plan(input)).toEqual(plan(input));
});
