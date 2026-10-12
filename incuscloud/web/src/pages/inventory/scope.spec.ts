import { expect, test } from "vitest";
import { clusterChoices, listedProject, qualifyPath } from "./scope";

// The facade's project list: a merged entry for each name on several clusters, and every cluster's own.
const names = ["default", "default@cluster-b", "default@cluster-c", "default@cluster-d", "kspike@cluster-b"];

test("the project selector lists each project once: merged ones by name, the rest where they are", () => {
  expect(names.filter(listedProject(names))).toEqual(["default", "kspike@cluster-b"]);
});

test("a per-cluster section of a merged project goes to one cluster: the one last used, else the first", () => {
  expect(qualifyPath("/ui/project/default/profiles", names)).toBe("/ui/project/default%40cluster-b/profiles");
  expect(qualifyPath("/ui/project/default/storage/pools", names, "cluster-c")).toBe("/ui/project/default%40cluster-c/storage/pools");
  // Last used, but the project is not there.
  expect(qualifyPath("/ui/project/kspike/networks", names, "cluster-c")).toBe("/ui/project/kspike%40cluster-b/networks");
});

test("the instance list (and the project's root) stay merged; qualified and unknown projects are left alone", () => {
  for (const path of ["/ui/project/default/instances", "/ui/project/default", "/ui/project/default%40cluster-c/profiles", "/ui/project/nope/profiles", "/clusters", "/ui/cluster/members"])
    expect(qualifyPath(path, names)).toBeNull();
});

test("on another section: the clusters the project is on, each the same section there; no 'All clusters'", () => {
  expect(clusterChoices("/ui/project/default%40cluster-c/profile/web", "", names)).toEqual({
    current: "cluster-c",
    options: [
      { label: "cluster-b", value: "cluster-b", to: "/ui/project/default%40cluster-b/profiles" },
      { label: "cluster-c", value: "cluster-c", to: "/ui/project/default%40cluster-c/profiles" },
      { label: "cluster-d", value: "cluster-d", to: "/ui/project/default%40cluster-d/profiles" },
    ],
  });
});

test("on the instance list: 'All clusters', or one cluster, selected as the inventory tree does", () => {
  expect(clusterChoices("/ui/project/default/instances", "?node=d1%40cluster-d", names)).toEqual({
    current: "cluster-d",
    options: [
      { label: "All clusters", value: "", to: "/ui/project/default/instances" },
      { label: "cluster-b", value: "cluster-b", to: "/ui/project/default/instances?cluster=cluster-b" },
      { label: "cluster-c", value: "cluster-c", to: "/ui/project/default/instances?cluster=cluster-c" },
      { label: "cluster-d", value: "cluster-d", to: "/ui/project/default/instances?cluster=cluster-d" },
    ],
  });
  expect(clusterChoices("/ui/all-projects/instances", "", names)!.options.map((o) => o.to)).toEqual([
    "/ui/all-projects/instances",
    "/ui/all-projects/instances?cluster=cluster-b",
    "/ui/all-projects/instances?cluster=cluster-c",
    "/ui/all-projects/instances?cluster=cluster-d",
  ]);
  // A project on one cluster: just that one.
  expect(clusterChoices("/ui/project/kspike%40cluster-b/instances", "", names)).toEqual({
    current: "cluster-b",
    options: [{ label: "cluster-b", value: "cluster-b", to: "/ui/project/kspike%40cluster-b/instances" }],
  });
});

test("no choice outside projects", () => {
  for (const path of ["/", "/clusters", "/ui/cluster/members", "/ui/operations"]) expect(clusterChoices(path, "", names)).toBeNull();
});
