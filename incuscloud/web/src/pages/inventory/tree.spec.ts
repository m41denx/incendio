import { clusterOf, nameOf } from "./tree";

test("qualified names split into name and cluster", () => {
  expect(clusterOf("d1@cluster-d")).toBe("cluster-d");
  expect(nameOf("d1@cluster-d")).toBe("d1");
  expect(clusterOf("plain")).toBe("");
  expect(nameOf("plain")).toBe("plain");
});
