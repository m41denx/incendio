import { expect, test } from "bun:test";
import { FakeAuthz } from "./fake.ts";
import { PlatformAuthz, type Tuple } from "./platform.ts";

// Live: IC_IT_OPENFGA=http://127.0.0.1:18080 (scripts/dev-openfga.sh)
const url = process.env.IC_IT_OPENFGA;

const tuples: Tuple[] = [
  { user: "user:padmin", relation: "admin", object: "platform:main" },
  { user: "user:pop", relation: "operator", object: "platform:main" },
  { user: "user:pview", relation: "viewer", object: "platform:main" },
  { user: "platform:main", relation: "platform", object: "tenant:t1" },
  { user: "platform:main", relation: "platform", object: "tenant:t2" },
  { user: "user:owner1", relation: "owner", object: "tenant:t1" },
  { user: "user:admin1", relation: "admin", object: "tenant:t1" },
  { user: "user:member1", relation: "member", object: "tenant:t1" },
  { user: "user:viewer1", relation: "viewer", object: "tenant:t1" },
  { user: "user:member2", relation: "member", object: "tenant:t2" },
  { user: "platform:main", relation: "platform", object: "cluster:c1" },
  { user: "platform:main", relation: "platform", object: "cluster:c2" },
  { user: "tenant:t1", relation: "tenant", object: "cluster:c1" },
  { user: "user:cview", relation: "viewer", object: "cluster:c2" },
];
const users = ["padmin", "pop", "pview", "owner1", "admin1", "member1", "viewer1", "member2", "cview", "nobody"].map((u) => `user:${u}`);
const checks: Array<[string, string]> = [
  ["platform:main", "admin"], ["platform:main", "operator"], ["platform:main", "viewer"],
  ...["tenant:t1", "tenant:t2"].flatMap((o) => ["owner", "admin", "member", "viewer"].map((r) => [o, r] as [string, string])),
  ...["cluster:c1", "cluster:c2"].flatMap((o) => ["admin", "viewer", "can_access"].map((r) => [o, r] as [string, string])),
];

test.if(!!url)("the fake agrees with OpenFGA on every check and listing", async () => {
  const real = await PlatformAuthz.init({ url: url!, token: "dev-openfga-key", storeName: `fake-x-${crypto.randomUUID()}` });
  const fake = new FakeAuthz();
  await real.write(tuples);
  await fake.write(tuples);
  const diffs: string[] = [];
  for (const u of users) {
    for (const [o, r] of checks) {
      const [a, b] = await Promise.all([real.check(u, r, o), fake.check(u, r, o)]);
      if (a !== b) diffs.push(`${u} ${r} ${o}: openfga=${a} fake=${b}`);
    }
    for (const [type, rel] of [["tenant", "viewer"], ["tenant", "admin"], ["cluster", "can_access"], ["cluster", "admin"]] as const) {
      const [a, b] = await Promise.all([real.listObjects(u, rel, type), fake.listObjects(u, rel, type)]);
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`list ${u} ${rel} ${type}: ${a} vs ${b}`);
    }
  }
  expect(diffs).toEqual([]);
});

test("fake write/delete semantics", async () => {
  const f = new FakeAuthz();
  const t = { user: "user:a", relation: "owner", object: "tenant:x" };
  await f.write([t, t]);
  expect(await f.check("user:a", "admin", "tenant:x")).toBe(true);
  await f.write([], [t, t]);
  expect(await f.check("user:a", "admin", "tenant:x")).toBe(false);
});
