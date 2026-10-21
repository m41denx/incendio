import { expect, test } from "bun:test";
import { qualify, split, stripBody, stripRequest, qualifyResponse, targetOf } from "./rewrite.ts";

const clusters = ["cluster-b", "cluster-d"];

test("names are qualified with their cluster and split at the last @, only for known clusters", () => {
  expect(qualify("acme", "cluster-b")).toBe("acme@cluster-b");
  expect(split("acme@cluster-b", clusters)).toEqual({ name: "acme", cluster: "cluster-b" });
  expect(split("a@b@cluster-d", clusters)).toEqual({ name: "a@b", cluster: "cluster-d" });
  expect(split("ada@example.com", clusters)).toEqual({ name: "ada@example.com" });
  expect(split("acme", clusters)).toEqual({ name: "acme" });
});

test("the cluster comes from the path, project or target, then the Referer; none means all", () => {
  const t = (path: string, referer?: string) => targetOf(path, referer, clusters);
  expect(t("/1.0/instances?project=acme%40cluster-b&recursion=2")).toEqual({ kind: "one", cluster: "cluster-b" });
  expect(t("/1.0/storage-pools/default%40cluster-d/volumes")).toEqual({ kind: "one", cluster: "cluster-d" });
  expect(t("/1.0/operations/0b1c@cluster-d/wait?timeout=5")).toEqual({ kind: "one", cluster: "cluster-d" });
  expect(t("/1.0/instances?project=acme&target=d1%40cluster-d")).toEqual({ kind: "one", cluster: "cluster-d" });
  expect(t("/1.0/storage-pools?recursion=1", "https://cloud.test/ui/project/acme%40cluster-b/instances/create")).toEqual({ kind: "one", cluster: "cluster-b" });
  expect(t("/1.0/instances?project=acme")).toEqual({ kind: "all" });
  expect(t("/1.0/instances?project=acme", "https://cloud.test/ui/project/acme/instances")).toEqual({ kind: "all" });
  expect(t("/1.0/instances/web?project=acme%40cluster-b&target=d1%40cluster-d").kind).toBe("conflict");
  // A qualified request wins over the page it is made from.
  expect(t("/1.0/instances?project=acme%40cluster-d", "https://cloud.test/ui/project/acme%40cluster-b/")).toEqual({ kind: "one", cluster: "cluster-d" });
});

test("a request for one cluster loses its qualifiers: path, query and JSON body", () => {
  expect(stripRequest("/1.0/storage-pools/default%40cluster-b/volumes/custom/v1?project=acme%40cluster-b&target=d1%40cluster-b", "cluster-b")).toBe(
    "/1.0/storage-pools/default/volumes/custom/v1?project=acme&target=d1",
  );
  expect(stripRequest("/1.0/operations/0b1c%40cluster-b/websocket?secret=s3", "cluster-b")).toBe("/1.0/operations/0b1c/websocket?secret=s3");
  expect(stripRequest("/1.0/instances?project=acme&recursion=2", "cluster-b")).toBe("/1.0/instances?project=acme&recursion=2");
  // A standalone server has one member, named after the cluster: no target is sent.
  expect(stripRequest("/1.0/instances?project=acme%40cluster-b&target=cluster-b%40cluster-b", "cluster-b", { standalone: true })).toBe("/1.0/instances?project=acme");
});

test("JSON responses mark what belongs to the cluster: projects, locations, URLs, operations, global identities", () => {
  const q = (path: string, body: unknown) => qualifyResponse(path, body, "cluster-d");
  expect(
    q("/1.0/instances?recursion=1", {
      type: "sync",
      metadata: [{ name: "web", project: "acme", location: "d1", profiles: ["default"], devices: { root: { pool: "local" } }, config: { "user.note": "ok" } }],
    }),
  ).toEqual({ type: "sync", metadata: [{ name: "web", project: "acme@cluster-d", location: "d1@cluster-d", profiles: ["default"], devices: { root: { pool: "local@cluster-d" } }, config: { "user.note": "ok" } }] });
  expect(
    q("/1.0/profiles/default?project=acme", {
      metadata: {
        name: "default",
        project: "acme",
        used_by: ["/1.0/instances/web?project=acme", "/1.0/instances/db", "/1.0/storage-pools/local/volumes/custom/v1?project=acme&target=d2"],
      },
    }),
  ).toEqual({
    metadata: {
      name: "default",
      project: "acme@cluster-d",
      used_by: ["/1.0/instances/web?project=acme@cluster-d", "/1.0/instances/db?project=default@cluster-d", "/1.0/storage-pools/local@cluster-d/volumes/custom/v1?project=acme@cluster-d&target=d2@cluster-d"],
    },
  });
  // Operations: the envelope's URL and the operation's id; its resources are URLs.
  expect(
    q("/1.0/instances?project=acme", { type: "async", operation: "/1.0/operations/0b1c", metadata: { id: "0b1c", resources: { instances: ["/1.0/instances/web?project=acme"] } } }),
  ).toEqual({ type: "async", operation: "/1.0/operations/0b1c@cluster-d", metadata: { id: "0b1c@cluster-d", resources: { instances: ["/1.0/instances/web?project=acme@cluster-d"] } } });
  expect(q("/1.0/operations?recursion=1", { metadata: { running: [{ id: "a1", resources: {} }] } })).toEqual({ metadata: { running: [{ id: "a1@cluster-d", resources: {} }] } });
  // Global identities, by what was asked for.
  expect(q("/1.0/projects?recursion=1", { metadata: [{ name: "acme", used_by: [] }] })).toEqual({ metadata: [{ name: "acme@cluster-d", used_by: [] }] });
  expect(q("/1.0/storage-pools?recursion=1", { metadata: [{ name: "local", locations: ["d1", "d2"] }] })).toEqual({ metadata: [{ name: "local@cluster-d", locations: ["d1@cluster-d", "d2@cluster-d"] }] });
  expect(q("/1.0/cluster/members?recursion=1", { metadata: [{ server_name: "d1", groups: ["default"] }] })).toEqual({ metadata: [{ server_name: "d1@cluster-d", groups: ["default@cluster-d"] }] });
  expect(q("/1.0/cluster/groups/default", { metadata: { name: "default", members: ["d1"] } })).toEqual({ metadata: { name: "default@cluster-d", members: ["d1@cluster-d"] } });
  expect(q("/1.0/storage-pools", { metadata: ["/1.0/storage-pools/local"] })).toEqual({ metadata: ["/1.0/storage-pools/local@cluster-d"] });
  // Volumes inside a pool are not pools: their names stay.
  expect(q("/1.0/storage-pools/local/volumes?recursion=1&project=acme", { metadata: [{ name: "v1", pool: "local", project: "acme", location: "d1" }] })).toEqual({
    metadata: [{ name: "v1", pool: "local@cluster-d", project: "acme@cluster-d", location: "d1@cluster-d" }],
  });
  // Plain strings that only look qualified-able stay as they are.
  expect(q("/1.0/instances/web?project=acme", { metadata: { name: "web", description: "/1.0 notes", config: { "user.x": "acme" } } })).toEqual({
    metadata: { name: "web", description: "/1.0 notes", config: { "user.x": "acme" } },
  });
});

test("a standalone server's location 'none' is its one member", () => {
  expect(qualifyResponse("/1.0/instances?recursion=1", { metadata: [{ name: "web", location: "none" }] }, "cluster-b", { standalone: true })).toEqual({
    metadata: [{ name: "web", location: "cluster-b@cluster-b" }],
  });
});

test("a request body loses its qualifiers for that cluster, URLs included", () => {
  expect(
    stripBody({ name: "web", source: { type: "copy", source: "db", project: "acme@cluster-b", operation: "/1.0/operations/0b1c@cluster-b" }, devices: { root: { pool: "local@cluster-b" } }, config: { "user.mail": "a@cluster-d" } }, "cluster-b"),
  ).toEqual({ name: "web", source: { type: "copy", source: "db", project: "acme", operation: "/1.0/operations/0b1c" }, devices: { root: { pool: "local" } }, config: { "user.mail": "a@cluster-d" } });
});

test("scope: a qualifier wins, then the scope header, then the referer (qualified or /inventory/<cluster>), else all", () => {
  const cs = ["c1", "c2"];
  expect(targetOf("/1.0/instances?project=p%40c1", "https://x/inventory/c2/nodes", cs, "c2")).toEqual({ kind: "one", cluster: "c1" });
  expect(targetOf("/1.0/cluster/members", "https://x/inventory/c2/nodes", cs, "all")).toEqual({ kind: "all" });
  expect(targetOf("/1.0/cluster/members", undefined, cs, "c1")).toEqual({ kind: "one", cluster: "c1" });
  expect(targetOf("/1.0/cluster/members", "https://x/inventory/c2/nodes", cs)).toEqual({ kind: "one", cluster: "c2" });
  expect(targetOf("/1.0/cluster/members", "https://x/inventory/nope/nodes", cs)).toEqual({ kind: "all" });
  expect(targetOf("/1.0/cluster/members", "https://x/all/instances", cs)).toEqual({ kind: "all" });
});
