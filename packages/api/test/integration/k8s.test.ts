/**
 * @incendio/api/k8s against a real management appliance (skipped when the
 * daemon has none). Read-only by default; set INCENDIO_K8S_E2E=1 to also
 * create a small cluster, wait for it, read its kubeconfig and delete it.
 */
import { describe, expect, test } from "bun:test";
import { createIncusClient } from "../../src";
import { createK8sClient, K8sAgentError } from "../../src/k8s";
import { nodeK8sOptions, nodeTransport } from "../../src/node";

const incus = createIncusClient(nodeTransport());
const k8s = createK8sClient(incus, nodeK8sOptions);
const hasAppliance =
  (await k8s.appliance.instance().catch(() => null)) !== null;
const E2E = process.env.INCENDIO_K8S_E2E === "1";

describe.if(hasAppliance)("management appliance", () => {
  test("is ready, trusted and pinned", async () => {
    const state = await k8s.appliance.state();
    expect(state.stage).toBe("ready");
    expect(state.agent?.capabilities.capn).toBe(true);
    expect(await k8s.appliance.isTrusted()).toBe(true);
    const handle = await k8s.appliance.handle();
    expect(handle?.fingerprint).toBe(await k8s.appliance.agentFingerprint());
  });

  test("a wrong certificate pin is refused", async () => {
    const handle = (await k8s.appliance.handle())!;
    const pinned = createK8sClient(incus, {
      ...nodeK8sOptions,
      agent: { ...handle, fingerprint: `sha256:${"0".repeat(64)}` },
    });
    const err = await pinned.info().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(K8sAgentError);
    expect((err as Error).message).toContain("does not match the pinned");
  });

  test("clusters list with live status and joined nodes", async () => {
    const clusters = await k8s.listClusters();
    for (const cluster of clusters) {
      expect(cluster.project).toBeTruthy();
      const status = await cluster.getStatus();
      expect(status.name).toBe(cluster.name);
      const nodes = await cluster.nodes();
      if (cluster.isReady) {
        expect(
          nodes.some((n) => n.role === "control-plane" && n.machine?.nodeName),
        ).toBe(true);
        expect(await cluster.kubeconfig()).toContain("apiVersion: v1");
      }
    }
  });
});

describe.if(hasAppliance && E2E)(
  "cluster lifecycle (INCENDIO_K8S_E2E=1)",
  () => {
    const name = `sdk-e2e-${Date.now().toString(36)}`;

    test("create → ready → kubeconfig → delete", async () => {
      const progress: string[] = [];
      const cluster = await k8s.createCluster(
        {
          name,
          // Smallest cluster kubeadm accepts: one control plane, no workers.
          controlPlane: { flavor: { cpu: 2, memoryGiB: 2 } },
          workers: { count: 0 },
        },
        // Wait separately so a failed bring-up still reaches the cleanup.
        { wait: false },
      );
      try {
        await cluster.waitUntilReady({
          timeout: 1500,
          interval: 15,
          onProgress: (s) => {
            const line = `${s.status}/${s.phase ?? "-"} cp ${s.controlPlane.ready ?? "?"}/${s.controlPlane.desired}`;
            if (progress.at(-1) !== line) {
              progress.push(line);
              console.log(`  [${name}] ${line}`);
            }
          },
        });
        expect(cluster.isReady).toBe(true);
        expect(cluster.endpoint).toMatch(/^https:\/\//);
        expect(await cluster.kubeconfig()).toContain(name);
        const nodes = await cluster.nodes();
        expect(nodes.filter((n) => n.role === "control-plane")).toHaveLength(1);
      } finally {
        await cluster.delete();
      }
      const project = cluster.project!;
      expect(await incus.$api.projects.exists(project)).toBe(false);
      expect((await k8s.listClusters()).map((c) => c.name)).not.toContain(name);
    }, 1_800_000);
  },
);
