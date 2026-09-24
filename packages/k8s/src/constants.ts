import pkg from "../package.json" with { type: "json" };

// package.json is the single source of the agent version: build-release.sh
// stamps it into the release manifest the UI compares against.
export const AGENT = {
  name: "incendio-k8s-agent",
  version: pkg.version,
  apiVersion: "v1",
} as const;

// CAPN template variants. These match the flavors the UI generator emits and
// the ones `clusterctl generate cluster -i incus [--flavor ovn]` understands.
export const FLAVORS = ["default", "ovn"] as const;
export type Flavor = (typeof FLAVORS)[number];

// Which plane an Incus project hosts. Recorded in `user.incendio.role` and used
// for detection (see docs/k8s/deploy-model.md §5).
export const ROLES = ["management", "workload"] as const;
export type Role = (typeof ROLES)[number];
