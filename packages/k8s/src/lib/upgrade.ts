/**
 * Kubernetes version upgrades. Upgrading a ClusterClass-based cluster is one
 * edit — spec.topology.version — after which CAPI replaces the control-plane
 * machines first, then the workers, each new node booting the kubeadm image of
 * the new version (CAPN picks `kubeadm/<version>` when LXC_IMAGE_NAME is empty).
 * kubeadm only supports moving one minor version at a time, so we enforce that
 * here rather than let a node fail mid-rollout.
 */

export const K8S_VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

export interface K8sVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseK8sVersion(version: string): K8sVersion | null {
  const match = K8S_VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function compareK8sVersions(a: K8sVersion, b: K8sVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/** Why `current` cannot be upgraded to `target`, or null when it can. */
export function upgradeError(current: string, target: string): string | null {
  const from = parseK8sVersion(current);
  const to = parseK8sVersion(target);
  if (!to) return `invalid Kubernetes version '${target}' (expected vX.Y.Z)`;
  if (!from) return `the cluster's current version '${current}' is not a vX.Y.Z version`;
  const order = compareK8sVersions(to, from);
  if (order === 0) return `the cluster already runs ${current}`;
  if (order < 0) return `downgrades are not supported (${current} → ${target})`;
  if (to.major !== from.major) {
    return `major version upgrades are not supported (${current} → ${target})`;
  }
  if (to.minor - from.minor > 1) {
    return `upgrade one minor version at a time: v${String(from.major)}.${String(from.minor + 1)}.x is next after ${current}`;
  }
  return null;
}

/**
 * A cluster pinned to a custom node image keeps booting that image, so new
 * nodes would come up with the old kubeadm — unless kubeadm is installed at
 * boot for the machine's version.
 */
export function customImageError(
  variables: Record<string, string> | undefined,
): string | null {
  const image = variables?.LXC_IMAGE_NAME?.trim();
  if (!image) return null;
  if (variables?.INSTALL_KUBEADM === "true") return null;
  return `the cluster uses the custom node image '${image}', which does not change with the Kubernetes version; recreate the cluster to move to a new version`;
}
