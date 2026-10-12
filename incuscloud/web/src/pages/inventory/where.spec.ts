import { clustersOf, placeFor, projectsOn } from "./where";

const projects = ["default", "acme", "default@cluster-b", "acme@cluster-b", "default@cluster-d", "beta@cluster-d", "acme@cluster-c"];

test("clusters and the projects on each come from the qualified project names", () => {
  expect(clustersOf(projects)).toEqual(["cluster-b", "cluster-c", "cluster-d"]);
  expect(projectsOn(projects, "cluster-d")).toEqual(["beta", "default"]);
});

test("on a chosen cluster: the same project, else default, else the first one there", () => {
  expect(placeFor(projects, { base: "acme", cluster: "cluster-b" })).toBe("acme@cluster-b");
  expect(placeFor(projects, { base: "acme", cluster: "cluster-d" })).toBe("default@cluster-d");
  expect(placeFor(projects, { base: "zeta", cluster: "cluster-c" })).toBe("acme@cluster-c");
  expect(placeFor(projects, { base: "acme", cluster: "nope" })).toBeNull();
});

test("without a cluster: the first cluster that has the project, else default somewhere, else anything", () => {
  expect(placeFor(projects, { base: "acme" })).toBe("acme@cluster-b");
  expect(placeFor(projects, { base: "beta" })).toBe("beta@cluster-d");
  expect(placeFor(projects, { base: "zeta" })).toBe("default@cluster-b");
  expect(placeFor(["x@c1"], { base: "zeta" })).toBe("x@c1");
  expect(placeFor([], { base: "zeta" })).toBeNull();
});
