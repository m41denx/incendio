import { expect, test } from "vitest";
import { clusterOfObj, crumbsOf, objectOf, subsOf, tabsOf } from "./object";

test("URLs select objects", () => {
  expect(objectOf("/")).toEqual({ kind: "root", tab: "summary" });
  expect(objectOf("/all/warnings")).toEqual({ kind: "root", tab: "warnings" });
  expect(objectOf("/inventory/cluster-d")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "summary" });
  expect(objectOf("/inventory/cluster-d/configure/groups")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "configure", sub: "groups" });
  expect(objectOf("/ui/cluster/member/d1%40cluster-d/hardware")).toEqual({ kind: "member", cluster: "cluster-d", member: "d1@cluster-d" });
  expect(objectOf("/ui/project/default%40cluster-d/storage/volumes")).toEqual({ kind: "project", cluster: "cluster-d", project: "default@cluster-d", tab: "storage", sub: "volumes" });
  expect(objectOf("/ui/project/default%40cluster-d/network-acls")).toMatchObject({ kind: "project", tab: "networks", sub: "acls" });
  // Detail pages without a tab row of their own stay in their project's tab.
  expect(objectOf("/ui/project/default%40cluster-d/network-acl/web")).toMatchObject({ kind: "project", tab: "networks", sub: "acls", detail: "web" });
  expect(objectOf("/ui/project/default%40cluster-d/placement-groups")).toMatchObject({ kind: "project", tab: "configure", sub: "placement" });
  expect(objectOf("/inventory/cluster-d/groups/placement")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "groups", sub: "placement" });
  expect(objectOf("/inventory/cluster-d/networks")).toEqual({ kind: "cluster", cluster: "cluster-d", tab: "networks" });
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
  expect(labels("/inventory/cluster-d/members")).toEqual(["Summary", "[Members]", "Groups", "Projects", "Networks", "Storage", "Operations", "Access", "Configure"]);
  expect(labels("/ui/project/default%40cluster-d/local-images")).toEqual(["Instances", "Profiles", "Networks", "Storage", "Images", "Usage", "Access", "Configure"].map((l) => (l === "Images" ? "[Images]" : l)));
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

test("tabs with several pages have a side menu: every Incendio page of a cluster or project", () => {
  const menu = (p: string, operator = true) => subsOf(objectOf(p), { operator }).map((t) => (t.active ? `[${t.label}]` : t.label));
  expect(menu("/inventory/cluster-d/groups/placement")).toEqual(["Cluster groups", "[Placement groups]"]);
  expect(menu("/inventory/cluster-d/networks/acls")).toEqual(["Networks", "[ACLs]", "Address sets", "Zones", "IPAM", "Integrations"]);
  expect(menu("/inventory/cluster-d/storage/volumes")).toEqual(["Pools", "[Volumes]", "Buckets", "Custom ISOs"]);
  expect(menu("/inventory/cluster-d/access/identities")).toEqual(["[Identities]", "Groups", "IdP groups", "Grants", "Check"]);
  expect(menu("/inventory/cluster-d/configure/settings")).toEqual(["IncusCloud", "[Server settings]", "Cluster settings", "Cluster links", "Replicators", "Certificates", "Logging", "ACME", "Warnings"]);
  expect(menu("/inventory/cluster-d/configure/settings", false)[0]).toBe("[Server settings]");
  expect(menu("/inventory/cluster-d/members")).toEqual([]);
  expect(subsOf(objectOf("/inventory/cluster-d/networks/acls"), { operator: true })[1]!.to).toBe("/inventory/cluster-d/networks/acls");
  // A project's side menus are Incendio's own pages.
  expect(menu("/ui/project/p%40cluster-d/storage/buckets")).toEqual(["Pools", "Volumes", "[Buckets]", "Custom ISOs"]);
  expect(menu("/ui/project/p%40cluster-d/network-acl/web")).toEqual(["Networks", "[ACLs]", "Address sets", "Zones", "IPAM"]);
  expect(menu("/ui/project/p%40cluster-d/configuration/limits")).toEqual(["[Configuration]", "Placement groups"]);
  expect(subsOf(objectOf("/ui/project/p%40cluster-d/storage/buckets"), { operator: true })[0]!.to).toBe("/ui/project/p%40cluster-d/storage/pools");
  expect(menu("/ui/project/p%40cluster-d/instances")).toEqual([]);
  // The first page of a tab with a side menu is its own.
  expect(tabsOf(objectOf("/inventory/cluster-d"), { operator: true }).find((t) => t.label === "Networks")!.to).toBe("/inventory/cluster-d/networks");
});

test("a detail page in a project's tab has a breadcrumb of its own", () => {
  expect(crumbsOf(objectOf("/ui/project/p%40cluster-d/network-acl/web")).map((c) => c.label)).toEqual(["All clusters", "cluster-d", "p", "web"]);
});
