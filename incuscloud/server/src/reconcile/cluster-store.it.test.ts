import { expect, test } from "bun:test";
import { openClusterStore } from "./cluster-store.ts";
import { installIncusModel } from "../test/incus-model.ts";

// Live: IC_IT_OPENFGA=http://127.0.0.1:18080 (scripts/dev-openfga.sh)
const url = process.env.IC_IT_OPENFGA;
const token = process.env.IC_IT_OPENFGA_TOKEN ?? "dev-openfga-key";
const live = test.if(!!url);

live("stores are found by id or name, or created", async () => {
  const name = `it-cluster-${crypto.randomUUID()}`;
  const a = await openClusterStore({ url: url!, token, name });
  expect((await openClusterStore({ url: url!, token, name })).storeId).toBe(a.storeId);
  expect((await openClusterStore({ url: url!, token, name, storeId: a.storeId })).storeId).toBe(a.storeId);
  const gone = await openClusterStore({ url: url!, token, name: `${name}-x`, storeId: "01JZZZZZZZZZZZZZZZZZZZZZZZ" });
  expect(gone.storeId).not.toBe("01JZZZZZZZZZZZZZZZZZZZZZZZ");
});

live("managed tuples are written and read; foreign ones are invisible to readManaged", async () => {
  const s = await openClusterStore({ url: url!, token, name: `it-cluster-${crypto.randomUUID()}` });
  expect(await s.hasModel()).toBe(false);
  await installIncusModel(url!, token, s.storeId);
  expect(await s.hasModel()).toBe(true);
  const managed = { user: "user:u1", relation: "member", object: "group:incuscloud-platform-admin" };
  const foreign = { user: "user:alice", relation: "admin", object: "project:acme" };
  await s.write([managed, foreign], []);
  expect(await s.readManaged()).toEqual([managed]);
  await s.write([], [managed]);
  expect(await s.readManaged()).toEqual([]);
});
