import { expect, test } from "bun:test";
import { KUBERNETES_VERSIONS, SIZES, namespaceOf, upgradeError, usageOf } from "./model.ts";

const GiB = 1024 ** 3;

test("sizes are CAPN flavors (Incus instance types)", () => {
  expect(SIZES.small).toEqual({ cpu: 2, memoryGiB: 2, flavor: "c2-m2" });
  expect(SIZES.medium.flavor).toBe("c2-m4");
  expect(SIZES.large.flavor).toBe("c4-m8");
});

test("a cluster's usage counts every node and the load balancer, with a 10 GiB root disk each", () => {
  expect(usageOf("medium", 1, 2)).toEqual({ instances: 4, cpu: 2 * 3 + 1, memory: 3 * 4 * GiB + GiB, disk: 4 * 10 * GiB });
  expect(usageOf("small", 3, 0)).toEqual({ instances: 4, cpu: 7, memory: 7 * GiB, disk: 40 * GiB });
});

test("usage of added nodes alone, for a scale-up (no load balancer)", () => {
  expect(usageOf("large", 0, 2, { lb: false })).toEqual({ instances: 2, cpu: 8, memory: 16 * GiB, disk: 20 * GiB });
});

test("upgrades go one minor version forward, to an offered version", () => {
  expect(KUBERNETES_VERSIONS).toEqual(["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"]);
  expect(upgradeError("v1.36.4", "v1.37.0")).toBeNull();
  expect(upgradeError("v1.36.4", "v1.36.4")).toBeNull();
  expect(upgradeError("v1.35.5", "v1.37.0")).toBe("Upgrade one minor version at a time: v1.35.5 can go to v1.36 next");
  expect(upgradeError("v1.37.0", "v1.36.4")).toBe("Kubernetes cannot be downgraded (v1.37.0 to v1.36.4)");
  expect(upgradeError("v1.36.4", "v1.37.9")).toBe("v1.37.9 is not offered; choose one of v1.34.0, v1.35.5, v1.36.4, v1.37.0");
});

test("each tenant's clusters live in namespace ic-<slug>", () => {
  expect(namespaceOf("acme")).toBe("ic-acme");
});
