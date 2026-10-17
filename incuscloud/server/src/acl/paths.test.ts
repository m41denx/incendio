import { expect, test } from "bun:test";
import { chain, formatPath, parsePath, type AclPath } from "./paths.ts";

test("every path kind round-trips", () => {
  const all: AclPath[] = [
    { kind: "root" },
    { kind: "platform" },
    { kind: "cluster", cluster: "lab" },
    { kind: "group", cluster: "lab", group: "gpu" },
    { kind: "project", cluster: "lab", project: "acme" },
    { kind: "instance", cluster: "lab", project: "acme", instance: "web" },
    { kind: "tenant", tenant: "acme" },
    { kind: "kubernetes", tenant: "acme", name: "prod" },
  ];
  for (const p of all) expect(parsePath(formatPath(p))).toEqual(p);
  expect(all.map(formatPath)).toEqual([
    "/",
    "/platform",
    "/clusters/lab",
    "/clusters/lab/groups/gpu",
    "/clusters/lab/projects/acme",
    "/clusters/lab/projects/acme/instances/web",
    "/tenants/acme",
    "/tenants/acme/kubernetes/prod",
  ]);
});

test("malformed paths are refused", () => {
  for (const s of ["", "clusters/lab", "/clusters", "/clusters/a/b", "/tenants/x/y/z", "/clusters/a b", "/clusters/lab/", "/platform/x", "//", "/clusters/lab/projects/acme/instances"])
    expect([s, parsePath(s)]).toEqual([s, null]);
});

test("a chain runs from the path to /, through the tenant whose project it is", () => {
  const tenantOf = (c: string, p: string) => (c === "c" && p === "acme" ? "acme" : undefined);
  const at = (s: string) => chain(parsePath(s)!, tenantOf);
  expect(at("/clusters/c/projects/acme/instances/web")).toEqual(["/clusters/c/projects/acme/instances/web", "/clusters/c/projects/acme", "/tenants/acme", "/clusters/c", "/"]);
  expect(at("/clusters/c/projects/default")).toEqual(["/clusters/c/projects/default", "/clusters/c", "/"]);
  expect(at("/clusters/c/groups/gpu")).toEqual(["/clusters/c/groups/gpu", "/clusters/c", "/"]);
  expect(at("/tenants/acme/kubernetes/prod")).toEqual(["/tenants/acme/kubernetes/prod", "/tenants/acme", "/"]);
  expect(at("/platform")).toEqual(["/platform", "/"]);
  expect(at("/")).toEqual(["/"]);
});
