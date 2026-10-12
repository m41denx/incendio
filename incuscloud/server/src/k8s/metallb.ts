import { METALLB_NAMESPACE, METALLB_POOL, buildPoolManifest } from "@incendio/k8s/src/lib/metallb.ts";
import { KubeClient, parseKubeconfig, type Kube, type KubeObject } from "./kube.ts";

/** MetalLB's native manifest (the version Incendio's agent installs). */
export const METALLB_MANIFEST_URL = "https://raw.githubusercontent.com/metallb/metallb/v0.16.0/config/manifests/metallb-native.yaml";

const ORDER = (o: KubeObject) => (o.kind === "CustomResourceDefinition" ? 0 : o.kind === "Namespace" ? 1 : 2);

/**
 * MetalLB's objects as IncusCloud applies them (no kubectl): its CRDs, its
 * namespace, the rest in the manifest's order; then, apart, the pool and L2
 * advertisement it hands addresses out of (Incendio's, from @incendio/k8s).
 */
export function metallbObjects(manifestYaml: string, addresses: string[]): { base: KubeObject[]; pool: KubeObject[] } {
  const parsed = Bun.YAML.parse(manifestYaml) as KubeObject | KubeObject[] | null;
  const docs = (Array.isArray(parsed) ? parsed : [parsed]).filter((d): d is KubeObject => !!d?.kind);
  const base = docs.map((d, i) => ({ d, i })).sort((a, b) => ORDER(a.d) - ORDER(b.d) || a.i - b.i).map((x) => x.d);
  const pool = (JSON.parse(buildPoolManifest(addresses)) as { items: KubeObject[] }).items;
  return { base, pool };
}

const controllerAvailable = async (kube: Kube) => {
  const d = await kube.get("apps/v1", "Deployment", METALLB_NAMESPACE, "controller");
  return ((d?.status as { conditions?: Array<{ type: string; status: string }> } | undefined)?.conditions ?? []).some((c) => c.type === "Available" && c.status === "True");
};

/** Installs (or updates) MetalLB, then its pool once the controller (and its webhook) is up. */
export async function installMetalLB(
  kube: Kube,
  objs: { base: KubeObject[]; pool: KubeObject[] },
  o: { deadlineMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + (o.deadlineMs ?? 180_000);
  for (const obj of objs.base) await kube.apply(obj);
  while (!(await controllerAvailable(kube))) {
    if (Date.now() >= deadline) throw new Error("MetalLB's controller did not become available in time");
    await sleep(5_000);
  }
  for (const obj of objs.pool) await kube.apply(obj);
}

/** Whether MetalLB runs in a workload cluster, and the addresses of IncusCloud's pool. */
export async function metallbState(kube: Kube): Promise<{ installed: boolean; ready: boolean; addresses: string[] }> {
  const controller = await kube.get("apps/v1", "Deployment", METALLB_NAMESPACE, "controller");
  if (!controller) return { installed: false, ready: false, addresses: [] };
  const pool = await kube.get("metallb.io/v1beta1", "IPAddressPool", METALLB_NAMESPACE, METALLB_POOL);
  return { installed: true, ready: await controllerAvailable(kube), addresses: ((pool?.spec as { addresses?: string[] } | undefined)?.addresses ?? []).slice() };
}

/** A workload cluster's API, through the admin kubeconfig CAPI keeps for it in the management cluster. */
export async function workloadKubeconfig(mgmt: Kube, namespace: string, name: string): Promise<string | null> {
  const secret = (await mgmt.get("v1", "Secret", namespace, `${name}-kubeconfig`)) as { data?: { value?: string } } | null;
  return secret?.data?.value ? Buffer.from(secret.data.value, "base64").toString("utf8") : null;
}

export const kubeFromKubeconfig = (text: string): Kube => new KubeClient(parseKubeconfig(text));
