import { expect, test, vi } from "vitest";
import { ApiError, request, withQuery } from "./client";
import { mockApi } from "../test/api";

test("returns JSON and sends bodies as JSON", async () => {
  const api = mockApi({ "POST /api/v1/things": (body) => [201, { got: body }] });
  expect(await request("POST", "/api/v1/things", { a: 1 })).toEqual({ got: { a: 1 } });
  expect(api.calls[0]).toMatchObject({ method: "POST", body: { a: 1 } });
});

test("204 is undefined", async () => {
  mockApi({ "DELETE /api/v1/things/1": [204] });
  expect(await request("DELETE", "/api/v1/things/1")).toBeUndefined();
});

test("API errors carry status, code and message", async () => {
  mockApi({ "DELETE /api/v1/tenants/1": [409, { error: { code: "tenant_placed", message: "Remove this tenant from its clusters first" } }] });
  const e = await request("DELETE", "/api/v1/tenants/1").catch((x) => x);
  expect(e).toBeInstanceOf(ApiError);
  expect(e).toMatchObject({ status: 409, code: "tenant_placed", message: "Remove this tenant from its clusters first" });
});

test("401 sends the browser to sign in and back to this page", async () => {
  mockApi({ "GET /api/v1/me": [401, { error: { code: "unauthenticated", message: "Sign in first" } }] });
  window.history.pushState({}, "", "/tenants/42?tab=members");
  const assign = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign, pathname: "/tenants/42", search: "?tab=members" } as Location);
  let settled = false;
  void request("GET", "/api/v1/me").finally(() => (settled = true));
  await new Promise((r) => setTimeout(r, 10));
  expect(assign).toHaveBeenCalledWith("/auth/start?return_to=%2Ftenants%2F42%3Ftab%3Dmembers");
  expect(settled).toBe(false);
});

test("withQuery leaves out empty values", () => {
  expect(withQuery("/x", { a: "1", b: "", c: undefined, d: 0 })).toBe("/x?a=1&d=0");
  expect(withQuery("/x", {})).toBe("/x");
});
