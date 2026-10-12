import type { Usage } from "../tenants/quota.ts";

const GiB = 1024 ** 3;

/** Versions with prebuilt CAPN kubeadm images (amd64 and arm64 containers), oldest first. */
export const KUBERNETES_VERSIONS = ["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"] as const;

/** Node sizes: CAPN flavors are Incus instance types (`c<cpus>-m<GiB>`). kubeadm needs 2 CPUs on a control plane. */
export const SIZES = {
  small: { cpu: 2, memoryGiB: 2, flavor: "c2-m2" },
  medium: { cpu: 2, memoryGiB: 4, flavor: "c2-m4" },
  large: { cpu: 4, memoryGiB: 8, flavor: "c4-m8" },
} as const;
export type Size = keyof typeof SIZES;

/** CAPN's haproxy load balancer in front of the control planes. */
export const LB = { cpu: 1, memoryGiB: 1, flavor: "c1-m1" } as const;
/** Every instance gets the project's default root disk (10 GiB, P3). */
export const NODE_DISK = 10 * GiB;

export const CLASS_NAME = "incuscloud-v1";
export const CLASS_NAMESPACE = "incuscloud-system";
export const namespaceOf = (slug: string) => `ic-${slug}`;

/** What a cluster (or, with `lb: false`, added nodes) counts against the tenant's quota. */
export function usageOf(size: Size, controlPlanes: number, workers: number, opts: { lb?: boolean } = {}): Usage {
  const s = SIZES[size];
  const nodes = controlPlanes + workers;
  const lb = opts.lb === false ? 0 : 1;
  return {
    instances: nodes + lb,
    cpu: nodes * s.cpu + lb * LB.cpu,
    memory: (nodes * s.memoryGiB + lb * LB.memoryGiB) * GiB,
    disk: (nodes + lb) * NODE_DISK,
  };
}

const minorOf = (v: string) => Number(/^v1\.(\d+)\./.exec(v)?.[1] ?? NaN);

/** Why `from` cannot become `to`, or null: one minor version forward at most, to an offered version. */
export function upgradeError(from: string, to: string): string | null {
  if (!(KUBERNETES_VERSIONS as readonly string[]).includes(to)) return `${to} is not offered; choose one of ${KUBERNETES_VERSIONS.join(", ")}`;
  const [a, b] = [minorOf(from), minorOf(to)];
  if (b < a || (b === a && to < from)) return `Kubernetes cannot be downgraded (${from} to ${to})`;
  if (b > a + 1) return `Upgrade one minor version at a time: ${from} can go to v1.${a + 1} next`;
  return null;
}
