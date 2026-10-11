import { expect, test } from "bun:test";
import { harness } from "./test/harness.ts";

test("health endpoint", async () => {
  const h = await harness();
  const r = await h.call(null, "GET", "/healthz");
  expect(r.body).toEqual({ status: "ok" });
});

test("API errors use the shared shape", async () => {
  const h = await harness();
  const r = await h.call(null, "GET", "/api/v1/nothing-here");
  expect(r.status).toBe(404);
  expect(r.body).toEqual({ error: { code: "not_found", message: "Not found" } });
});

test("validation errors are 400 in the shared shape", async () => {
  const h = await harness();
  const admin = await h.user("a@example.com", { platformRole: "admin" });
  const r = await h.call(admin, "POST", "/api/v1/users", { email: 42 });
  expect(r.status).toBe(400);
  expect(r.body.error.code).toBe("invalid_request");
});
