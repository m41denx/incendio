import { expect, test } from "vitest";
import { clusterOfObj, crumbsOf, objectOf, tabsOf } from "./object";

test("URLs select objects", () => {
  expect(objectOf("/")).toEqual({ kind: "root", tab: "summary" });
  expect(objectOf("/all/warnings")).toEqual({ kind: "root", tab: "warnings" });
  expect(objectOf("/inventory/cluster-d")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "summary" });
  expect(objectOf("/inventory/cluster-d/configure/groups")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "configure", sub: "groups" });
  expect(objectOf("/ui/cluster/member/d1%40cluster-d/hardware")).toEqual({ kind: "member", cluster: "cluster-d", member: "d1@cluster-d" });
  expect(objectOf("/ui/project/default%40cluster-d/storage/volumes")).toEqual({ kind: "project", cluster: "cluster-d", project: "default@cluster-d", tab: "storage" });
  expect(objectOf("/ui/project/default%40cluster-d/network-acls")).toMatchObject({ kind: "project", tab: "networks" });
  expect(objectOf("/ui/project/default%40cluster-d/configuration/limits")).toMatchObject({ kind: "project", tab: "configure" });
  expect(objectOf("/ui/project/default%40cluster-d/instance/web-d1/terminal")).toEqual({ kind: "instance", cluster: "cluster-d", project: "default@cluster-d", name: "web-d1" });
  expect(objectOf("/ui/project/default%40cluster-d/network/incusbr0")).toMatchObject({ kind: "network", name: "incusbr0" });
  expect(objectOf("/ui/project/default%40cluster-d/storage/pool/default%40cluster-d")).toMatchObject({ kind: "pool" });
  for (const p of ["/kubernetes", "/tenants/x", "/ui/project/default/profiles", "/profile"]) expect(objectOf(p)).toEqual({ kind: "none" });
});

test("tabs: one row per object; operators see the root's Clusters; objects with their own row get none", () => {
  const labels = (p: string, operator = true) => tabsOf(objectOf(p), { operator }).map((t) => (t.active ? `[${t.label}]` : t.label));
  expect(labels("/")).toEqual(["[Summary]", "Clusters", "Instances", "Warnings"]);
  expect(labels("/", false)).toEqual(["[Summary]", "Instances", "Warnings"]);
  expect(labels("/inventory/cluster-d/members")).toEqual(["Summary", "[Members]", "Projects", "Networks", "Storage", "Operations", "Configure"]);
  expect(labels("/ui/project/default%40cluster-d/local-images")).toEqual(["Instances", "Profiles", "Networks", "Storage", "[Images]", "Usage", "Configure"]);
  expect(tabsOf(objectOf("/ui/project/default%40cluster-d/storage/pools"), { operator: true }).find((t) => t.label === "Storage")!.to).toBe("/ui/project/default%40cluster-d/storage/pools");
  for (const p of ["/ui/cluster/member/d1%40cluster-d", "/ui/project/default%40cluster-d/instance/web-d1"]) expect(tabsOf(objectOf(p), { operator: true })).toEqual([]);
});

test("breadcrumbs lead back up the tree", () => {
  expect(crumbsOf(objectOf("/ui/project/default%40cluster-d/instance/web-d1"))).toEqual([
    { label: "All clusters", to: "/" },
    { label: "cluster-d", to: "/inventory/cluster-d" },
    { label: "default", to: "/ui/project/default%40cluster-d/instances" },
    { label: "web-d1", to: "/ui/project/default%40cluster-d/instance/web-d1" },
  ]);
  expect(crumbsOf(objectOf("/ui/cluster/member/d1%40cluster-d")).map((c) => c.label)).toEqual(["All clusters", "cluster-d", "d1"]);
  expect(crumbsOf(objectOf("/"))).toEqual([{ label: "All clusters", to: "/" }]);
  expect(clusterOfObj(objectOf("/inventory/cluster-c/storage"))).toBe("cluster-c");
  expect(clusterOfObj(objectOf("/all/instances"))).toBe("");
});
