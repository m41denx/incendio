import { expect, test } from "bun:test";
import { routeRequest } from "./route.ts";

const D = "clusters.example.com";
const r = (host: string, url: string) => routeRequest({ host, url }, D);

test("host routing", () => {
  expect(r("c1.clusters.example.com", "/1.0/instances?recursion=1")).toEqual({ name: "c1", path: "/1.0/instances?recursion=1", mode: "host" });
  expect(r("c1.clusters.example.com:8443", "/1.0")).toEqual({ name: "c1", path: "/1.0", mode: "host" });
  expect(r("C1.Clusters.Example.com", "/")).toEqual({ name: "c1", path: "/", mode: "host" });
});

test("hosts outside the cluster domain are not the gateway's", () => {
  expect(r("cloud.example.com", "/1.0")).toBeNull();
  expect(r("clusters.example.com", "/1.0")).toBeNull();
  expect(r("a.b.clusters.example.com", "/1.0")).toBeNull();
  expect(r("evilclusters.example.com", "/1.0")).toBeNull();
});

test("path routing for the Incus API, Incendio and its documentation", () => {
  expect(r("cloud.example.com", "/clusters/c1/1.0")).toEqual({ name: "c1", path: "/1.0", mode: "path" });
  expect(r("cloud.example.com", "/clusters/c1/1.0/instances?recursion=1")).toEqual({ name: "c1", path: "/1.0/instances?recursion=1", mode: "path" });
  expect(r("cloud.example.com", "/clusters/c1/1.0?project=x")).toEqual({ name: "c1", path: "/1.0?project=x", mode: "path" });
  expect(r("cloud.example.com", "/clusters/c1/ui/")).toEqual({ name: "c1", path: "/ui/", mode: "path" });
  expect(r("cloud.example.com", "/clusters/c1/ui")).toEqual({ name: "c1", path: "/ui", mode: "path" });
  expect(r("cloud.example.com", "/clusters/c1/documentation/x.html")).toEqual({ name: "c1", path: "/documentation/x.html", mode: "path" });
});

test("other /clusters paths belong to the platform UI", () => {
  expect(r("cloud.example.com", "/clusters")).toBeNull();
  expect(r("cloud.example.com", "/clusters/c1")).toBeNull();
  expect(r("cloud.example.com", "/clusters/c1/settings")).toBeNull();
  expect(r("cloud.example.com", "/clusters/c1/1.00")).toBeNull();
  expect(r("cloud.example.com", "/clusters/c1/uix")).toBeNull();
});

test("traversal, encoded separators and invalid names never route", () => {
  expect(r("cloud.example.com", "/clusters/c1/../c2/1.0")).toBeNull();
  expect(r("cloud.example.com", "/clusters/c1%2F..%2Fc2/1.0")).toBeNull();
  expect(r("cloud.example.com", "/clusters/C1/1.0")).toBeNull();
  expect(r("cloud.example.com", "/clusters/-x/1.0")).toBeNull();
  expect(r("cloud.example.com", "/clusters/c1/1.0/../../c2/1.0")).toEqual({ name: "c1", path: "/1.0/../../c2/1.0", mode: "path" });
  expect(r("-x.clusters.example.com", "/1.0")).toBeNull();
});
