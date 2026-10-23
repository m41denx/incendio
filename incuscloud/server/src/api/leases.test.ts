import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { aclEntries, auditLog, clusters, instanceLeases, instances, placements } from "../db/schema.ts";
import { recordOwner } from "../acl/owners.ts";
import { scheduleLeases } from "../leases/leases.ts";
import { harness, type Actor } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let lab: string;
let acme: { id: string };
let ids: Record<string, string>;
let people: Record<"admin" | "op" | "ta" | "m" | "v" | "u" | "out", Actor>;
const POLICY = { days: 30, action: "stop", extendDays: 7, maxExtensions: 1 };

beforeEach(async () => {
  h = await harness();
  lab = (await h.db.insert(clusters).values({ name: "lab", url: "https://x", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  acme = await h.tenant("acme");
  await h.db.insert(placements).values({ tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" });
  ids = {};
  for (const name of ["mine", "theirs"]) ids[name] = (await h.db.insert(instances).values({ clusterId: lab, project: "acme", name, type: "container", status: "Running", search: name }).returning())[0]!.id;
  people = {
    admin: await h.user("admin@x.test", { platformRole: "admin" }),
    op: await h.user("op@x.test", { platformRole: "operator" }),
    ta: await h.user("ta@x.test", { tenants: { [acme.id]: "admin" } }),
    m: await h.user("m@x.test", { tenants: { [acme.id]: "member" } }),
    v: await h.user("v@x.test", { tenants: { [acme.id]: "viewer" } }),
    u: await h.user("u@x.test"),
    out: await h.user("out@x.test"),
  };
  await h.db.insert(aclEntries).values({ path: "/tenants/acme", role: "user", userId: people.u.id });
  await recordOwner(h.db, { clusterId: lab, project: "acme", name: "mine" }, `user:${people.u.id}`, "event");
});

const setPolicy = (a: Actor, policy: unknown) => h.call(a, "PUT", `/api/v1/tenants/${acme.id}/lease-policy`, { policy });

test("the policy is the platform's: tenant admins can't set it; removing it removes the leases", async () => {
  expect((await setPolicy(people.ta, POLICY)).status).toBe(403);
  expect((await setPolicy(people.admin, { ...POLICY, days: 0 })).status).toBe(400);
  expect((await setPolicy(people.admin, POLICY)).status).toBe(200);
  await scheduleLeases(h.db);
  expect((await h.db.select().from(instanceLeases)).length).toBe(2);
  expect((await setPolicy(people.op, null)).status).toBe(200);
  expect(await h.db.select().from(instanceLeases)).toEqual([]);
  // Audited, the refusal too.
  const audit = await h.db.select({ result: auditLog.result }).from(auditLog).where(eq(auditLog.action, "tenant.lease_policy.set"));
  expect(audit.map((a) => a.result).sort()).toEqual(["denied", "success", "success"]);
});

test("an instance shows its lease; only the platform may set its end", async () => {
  expect((await h.call(people.m, "GET", `/api/v1/instances/${ids.mine}`)).body.lease).toBeNull();
  await setPolicy(people.admin, POLICY);
  await scheduleLeases(h.db);
  const seen = await h.call(people.m, "GET", `/api/v1/instances/${ids.mine}`);
  expect(seen.body.lease).toMatchObject({ extensions: 0, maxExtensions: 1, extendDays: 7, action: "stop" });
  expect(seen.body.canSetLease).toBe(false);
  expect((await h.call(people.admin, "GET", `/api/v1/instances/${ids.mine}`)).body.canSetLease).toBe(true);

  expect((await h.call(people.ta, "PUT", `/api/v1/instances/${ids.mine}/lease`, { expiresAt: null })).status).toBe(403);
  expect((await h.call(people.admin, "PUT", `/api/v1/instances/${ids.mine}/lease`, { expiresAt: "not a date" })).status).toBe(400);
  const never = await h.call(people.admin, "PUT", `/api/v1/instances/${ids.mine}/lease`, { expiresAt: null });
  expect([never.status, never.body.expiresAt]).toEqual([200, null]);
});

test("extending: whoever may configure the instance, once here; not viewers, Users for others' instances, or outsiders", async () => {
  const extend = (a: Actor, id = ids.mine!) => h.call(a, "POST", `/api/v1/instances/${id}/lease/extend`);
  expect((await extend(people.m)).status).toBe(404); // no policy yet
  await setPolicy(people.admin, POLICY);
  await scheduleLeases(h.db);
  expect((await extend(people.v)).status).toBe(403);
  expect((await extend(people.out)).status).toBe(404);
  expect((await extend(people.u, ids.theirs)).status).toBe(404);
  const r = await extend(people.u);
  expect([r.status, r.body.extensions]).toEqual([200, 1]);
  const again = await extend(people.m);
  expect([again.status, again.body.error.message]).toEqual([409, "No extensions left: the tenant allows one"]);
});

test("a tenant's leases: what each reader may see of them", async () => {
  await setPolicy(people.admin, POLICY);
  await scheduleLeases(h.db);
  const list = async (a: Actor) => {
    const r = await h.call(a, "GET", `/api/v1/tenants/${acme.id}/leases`);
    return r.status === 200 ? (r.body.leases as { name: string }[]).map((l) => l.name).sort() : r.status;
  };
  expect(await list(people.m)).toEqual(["mine", "theirs"]);
  expect(await list(people.u)).toEqual(["mine"]);
  expect(await list(people.out)).toBe(404);
  expect((await h.call(people.m, "GET", `/api/v1/tenants/${acme.id}/leases`)).body).toMatchObject({ policy: POLICY, canSet: false });
  expect((await h.call(people.admin, "GET", `/api/v1/tenants/${acme.id}/leases`)).body.canSet).toBe(true);
});
