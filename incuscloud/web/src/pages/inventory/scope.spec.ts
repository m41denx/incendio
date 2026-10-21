import { expect, test } from "vitest";
import { qualifyPath } from "./scope";

// The facade's project list: every cluster's own.
const names = ["default@cluster-b", "default@cluster-c", "default@cluster-d", "kspike@cluster-b"];

test("an unqualified project's page goes to one cluster: the one last used, else the first", () => {
  expect(qualifyPath("/ui/project/default/profiles", names)).toBe("/ui/project/default%40cluster-b/profiles");
  expect(qualifyPath("/ui/project/default/storage/pools", names, "cluster-c")).toBe("/ui/project/default%40cluster-c/storage/pools");
  // Last used, but the project is not there.
  expect(qualifyPath("/ui/project/kspike/networks", names, "cluster-c")).toBe("/ui/project/kspike%40cluster-b/networks");
});

test("projects are never merged: an unqualified instance list goes to one cluster too; qualified and unknown projects are left alone", () => {
  expect(qualifyPath("/ui/project/default/instances", names, "cluster-d")).toBe("/ui/project/default%40cluster-d/instances");
  expect(qualifyPath("/ui/project/default", names)).toBe("/ui/project/default%40cluster-b/");
  for (const path of ["/ui/project/default%40cluster-c/profiles", "/ui/project/nope/profiles", "/clusters", "/ui/cluster/members"]) expect(qualifyPath(path, names)).toBeNull();
});
