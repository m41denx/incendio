import { expect, test } from "bun:test";
import { PlatformAuthz } from "./platform.ts";

// Live: scripts/dev-openfga.sh, then IC_IT_OPENFGA=http://127.0.0.1:18080
const url = process.env.IC_IT_OPENFGA;
const token = process.env.IC_IT_OPENFGA_TOKEN ?? "dev-openfga-key";
const live = test.if(!!url);

live("roles flow through tenants to clusters", async () => {
  const a = await PlatformAuthz.init({ url: url!, token, storeName: `t-${crypto.randomUUID()}` });
  await a.write([
    { user: "platform:main", relation: "platform", object: "tenant:t1" },
    { user: "user:u1", relation: "member", object: "tenant:t1" },
    { user: "tenant:t1", relation: "tenant", object: "cluster:c1" },
    { user: "platform:main", relation: "platform", object: "cluster:c1" },
  ]);
  expect(await a.check("user:u1", "can_access", "cluster:c1")).toBe(true);
  expect(await a.check("user:u2", "can_access", "cluster:c1")).toBe(false);
  expect(await a.check("user:u1", "admin", "tenant:t1")).toBe(false);

  await a.write([{ user: "user:boss", relation: "admin", object: "platform:main" }]);
  expect(await a.check("user:boss", "admin", "tenant:t1")).toBe(true);
  expect(await a.check("user:boss", "admin", "cluster:c1")).toBe(true);
  expect(await a.listObjects("user:u1", "can_access", "cluster")).toEqual(["cluster:c1"]);
});

live("writes and deletes are idempotent", async () => {
  const a = await PlatformAuthz.init({ url: url!, token, storeName: `t-${crypto.randomUUID()}` });
  const t = { user: "user:u1", relation: "owner", object: "tenant:t1" };
  await a.write([t]);
  await a.write([t]);
  await a.write([], [t]);
  await a.write([], [t]);
  expect(await a.check("user:u1", "owner", "tenant:t1")).toBe(false);
});

live("init reuses the store and model", async () => {
  const storeName = `t-${crypto.randomUUID()}`;
  const a = await PlatformAuthz.init({ url: url!, token, storeName });
  const b = await PlatformAuthz.init({ url: url!, token, storeName });
  expect(b.storeId).toBe(a.storeId);
  expect(b.modelId).toBe(a.modelId);
});
