import { expect, test } from "bun:test";
import { createApp } from "./app.ts";

test("health endpoint", async () => {
  const r = await createApp({}).handle(new Request("http://localhost/healthz"));
  expect(await r.json()).toEqual({ status: "ok" });
});

test("API errors use the shared shape", async () => {
  const r = await createApp({}).handle(new Request("http://localhost/api/v1/nothing-here"));
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
});
