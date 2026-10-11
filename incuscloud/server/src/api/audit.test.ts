import { beforeEach, expect, test } from "bun:test";
import { audit } from "../audit/log.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
beforeEach(async () => {
  h = await harness();
});

test("platform viewers read the log newest first, with filters and a limit", async () => {
  const v = await h.user("v@example.com", { platformRole: "viewer" });
  for (let i = 0; i < 5; i++) await audit(h.db, { actor: { type: "user", id: "u" }, action: i % 2 ? "a.odd" : "a.even", result: "success", target: { type: "x", id: String(i) } });
  const all = await h.call(v, "GET", "/api/v1/audit?limit=3");
  expect(all.body.map((r: { targetId: string }) => r.targetId)).toEqual(["4", "3", "2"]);
  const odd = await h.call(v, "GET", "/api/v1/audit?action=a.odd");
  expect(odd.body.map((r: { targetId: string }) => r.targetId)).toEqual(["3", "1"]);
  const before = await h.call(v, "GET", `/api/v1/audit?before=${all.body[2].id}`);
  expect(before.body.map((r: { targetId: string }) => r.targetId)).toEqual(["1", "0"]);
});

test("tenant admins see only their tenant's rows; others are refused", async () => {
  const [a, b] = [await h.tenant("aaa"), await h.tenant("bbb")];
  const ta = await h.user("ta@example.com", { tenants: { [a.id]: "admin" } });
  await audit(h.db, { actor: { type: "user", id: "u" }, action: "tenant.update", result: "success", target: { type: "tenant", id: a.id } });
  await audit(h.db, { actor: { type: "user", id: "u" }, action: "sa.create", result: "success", target: { type: "service_account", id: "s" }, detail: { tenantId: a.id } });
  await audit(h.db, { actor: { type: "user", id: "u" }, action: "tenant.update", result: "success", target: { type: "tenant", id: b.id } });
  expect((await h.call(ta, "GET", "/api/v1/audit")).status).toBe(403);
  const r = await h.call(ta, "GET", `/api/v1/audit?tenant=${a.id}`);
  expect(r.body.map((x: { action: string }) => x.action)).toEqual(["sa.create", "tenant.update"]);
  expect((await h.call(ta, "GET", `/api/v1/audit?tenant=${b.id}`)).status).toBe(403);
});
