// Kubernetes version upgrades: which versions a cluster can move to next.
// Mirrors the agent's rule (packages/k8s/src/lib/upgrade.ts): kubeadm moves
// one minor version at a time, never down, and only to versions that have a
// prebuilt kubeadm image.
import { KUBEADM_VERSIONS } from "util/k8s/capn";
import type { K8sMachine } from "util/k8s/clusterNodes";

interface Version {
  major: number;
  minor: number;
  patch: number;
}

const parse = (version: string): Version | null => {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match
    ? {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
      }
    : null;
};

const compare = (a: Version, b: Version): number =>
  a.major - b.major || a.minor - b.minor || a.patch - b.patch;

/** Versions `current` can be upgraded to, newest first. */
export const upgradeTargets = (
  current: string,
  available: readonly string[] = KUBEADM_VERSIONS,
): string[] => {
  const from = parse(current);
  if (!from) return [];
  return available.filter((candidate) => {
    const to = parse(candidate);
    return (
      to !== null &&
      to.major === from.major &&
      compare(to, from) > 0 &&
      to.minor - from.minor <= 1
    );
  });
};

/**
 * The version the cluster's nodes actually run: the oldest machine version,
 * which lags the target while an upgrade rolls out.
 */
export const runningVersion = (machines: K8sMachine[]): string | undefined => {
  let oldest: { raw: string; parsed: Version } | undefined;
  for (const machine of machines) {
    const parsed = machine.version ? parse(machine.version) : null;
    if (
      machine.version &&
      parsed &&
      (!oldest || compare(parsed, oldest.parsed) < 0)
    ) {
      oldest = { raw: machine.version, parsed };
    }
  }
  return oldest?.raw;
};
