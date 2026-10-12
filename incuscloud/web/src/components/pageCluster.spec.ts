import { pageCluster } from "./Shell";

test("a page belongs to the cluster its first qualified path segment names", () => {
  expect(pageCluster("/ui/project/acme@cluster-b/instances/create")).toBe("cluster-b");
  expect(pageCluster("/ui/project/acme%40cluster-d/instance/web")).toBe("cluster-d");
  expect(pageCluster("/ui/cluster/member/d1@cluster-d")).toBe("cluster-d");
  expect(pageCluster("/ui/all-projects/instances")).toBe("");
  expect(pageCluster("/ui/project/acme/instances")).toBe("");
});
