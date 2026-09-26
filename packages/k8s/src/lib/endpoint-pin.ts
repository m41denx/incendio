/**
 * A fixed IPv4 API endpoint for clusters behind CAPN's haproxy load balancer.
 *
 * Left alone, CAPN takes the endpoint from the load balancer instance's first
 * address the moment it has one (controller_normal.go: `Host = lbIPs[0]`). On
 * a dual-stack bridge the SLAAC IPv6 often lands before the DHCP IPv4, so the
 * endpoint becomes an IPv6 address haproxy never listens on and the control
 * plane never comes up. CAPN keeps an endpoint that is already set, so the
 * agent picks a free IPv4, pins it on the load balancer's NIC (a profile) and
 * hands it to the LXCCluster through a ClusterClass variable of its own.
 * Pure helpers here; the Incus and kubectl side is in endpoint-ops.ts.
 */

// Cluster variable carrying the pinned address, and the ClusterClass patch
// that copies it into LXCCluster.spec.controlPlaneEndpoint.
export const ENDPOINT_VARIABLE = "incendioControlPlaneHost";
export const ENDPOINT_PATCH = "incendioControlPlaneEndpoint";
// Per-project profile that gives the load balancer instance its address.
export const LB_PROFILE = "incendio-lb";

const DEFAULT_INFRA_API = "infrastructure.cluster.x-k8s.io/v1alpha2";

interface Named {
  name?: string;
}

export interface ClusterClassObject {
  spec?: {
    infrastructure?: { templateRef?: { apiVersion?: string; kind?: string } };
    variables?: Named[];
    patches?: Named[];
  };
}

export type JsonPatchOp = { op: "add"; path: string; value: unknown };

/**
 * JSON-patch ops that teach the ClusterClass the endpoint variable and patch;
 * none when it already has both. Additive and inert for clusters that do not
 * set the variable, so existing clusters see no change.
 */
export function classEndpointPatch(cc: ClusterClassObject): JsonPatchOp[] {
  const spec = cc.spec ?? {};
  const ops: JsonPatchOp[] = [];
  const variable = {
    name: ENDPOINT_VARIABLE,
    required: false,
    schema: {
      openAPIV3Schema: {
        type: "string",
        description:
          "IPv4 address of the control plane endpoint, pinned on the lxc/oci load balancer by the Incendio agent",
      },
    },
  };
  const templateRef = spec.infrastructure?.templateRef;
  const patch = {
    name: ENDPOINT_PATCH,
    description: "Control plane endpoint pinned by the Incendio agent",
    enabledIf: `{{ if .${ENDPOINT_VARIABLE} }}true{{ end }}`,
    definitions: [
      {
        selector: {
          apiVersion: templateRef?.apiVersion ?? DEFAULT_INFRA_API,
          kind: templateRef?.kind ?? "LXCClusterTemplate",
          matchResources: { infrastructureCluster: true },
        },
        jsonPatches: [
          {
            op: "add",
            path: "/spec/template/spec/controlPlaneEndpoint",
            valueFrom: {
              template: `host: {{ .${ENDPOINT_VARIABLE} | quote }}\nport: 6443`,
            },
          },
        ],
      },
    ],
  };
  if (!spec.variables?.some((v) => v.name === ENDPOINT_VARIABLE)) {
    ops.push(
      spec.variables
        ? { op: "add", path: "/spec/variables/-", value: variable }
        : { op: "add", path: "/spec/variables", value: [variable] },
    );
  }
  if (!spec.patches?.some((p) => p.name === ENDPOINT_PATCH)) {
    // Appended, so it runs after the class's own LXCCluster patch.
    ops.push(
      spec.patches
        ? { op: "add", path: "/spec/patches/-", value: patch }
        : { op: "add", path: "/spec/patches", value: [patch] },
    );
  }
  return ops;
}

// ---- generated manifest -----------------------------------------------------

interface TopologyVariable {
  name?: string;
  value?: unknown;
}

export interface ManifestDoc {
  kind?: string;
  spec?: { topology?: { classRef?: { name?: string }; variables?: TopologyVariable[] } };
  [key: string]: unknown;
}

type HaproxyLoadBalancer = { profiles?: string[]; [key: string]: unknown };

/** The documents of `clusterctl generate` output (one or many). */
export function parseManifest(yaml: string): ManifestDoc[] {
  const parsed = Bun.YAML.parse(yaml) as ManifestDoc | ManifestDoc[] | null;
  if (parsed === null) return [];
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (d): d is ManifestDoc => d !== null && typeof d === "object",
  );
}

const clusterDoc = (docs: ManifestDoc[]) => docs.find((d) => d.kind === "Cluster");

/** ClusterClass the generated Cluster uses, if any. */
export function clusterClassName(docs: ManifestDoc[]): string | undefined {
  return clusterDoc(docs)?.spec?.topology?.classRef?.name;
}

/**
 * The haproxy load balancer (`lxc` or `oci`) of the generated Cluster, or null
 * for load balancers that already come with a fixed address (kube-vip, ovn).
 */
export function haproxyLoadBalancer(
  docs: ManifestDoc[],
): { kind: "lxc" | "oci"; spec: HaproxyLoadBalancer } | null {
  const lb = clusterDoc(docs)?.spec?.topology?.variables?.find(
    (v) => v.name === "loadBalancer",
  )?.value as Record<string, HaproxyLoadBalancer | null> | undefined;
  for (const kind of ["lxc", "oci"] as const) {
    if (lb && kind in lb) return { kind, spec: lb[kind] ?? {} };
  }
  return null;
}

/**
 * The manifest with the endpoint pinned: the Cluster sets the endpoint
 * variable and its load balancer also gets `profile` (which carries the
 * address). Null when the load balancer is not an haproxy instance.
 */
export function pinEndpoint(
  docs: ManifestDoc[],
  host: string,
  profile = LB_PROFILE,
): ManifestDoc[] | null {
  const lb = haproxyLoadBalancer(docs);
  const cluster = clusterDoc(docs);
  const topology = cluster?.spec?.topology;
  if (!lb || !cluster || !topology) return null;
  const profiles = lb.spec.profiles?.length ? lb.spec.profiles : ["default"];
  const loadBalancer = {
    [lb.kind]: {
      ...lb.spec,
      profiles: profiles.includes(profile) ? profiles : [...profiles, profile],
    },
  };
  const variables = (topology.variables ?? [])
    .filter((v) => v.name !== ENDPOINT_VARIABLE)
    .map((v) => (v.name === "loadBalancer" ? { ...v, value: loadBalancer } : v));
  variables.push({ name: ENDPOINT_VARIABLE, value: host });
  const pinned: ManifestDoc = {
    ...cluster,
    spec: { ...cluster.spec, topology: { ...topology, variables } },
  };
  return docs.map((d) => (d === cluster ? pinned : d));
}

/** Documents as one kubectl-applyable JSON List. */
export function manifestList(docs: ManifestDoc[]): string {
  return JSON.stringify({ apiVersion: "v1", kind: "List", items: docs });
}

// ---- detection --------------------------------------------------------------

/** Host of an `https://host:port` / `https://[v6]:port` endpoint. */
export function endpointHost(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  const m = /^https?:\/\/(\[[^\]]+\]|[^/:]+)/.exec(endpoint);
  return m?.[1]?.replace(/^\[|\]$/g, "");
}

/**
 * Why a cluster that is not up will never come up on its own: CAPN gave its
 * haproxy load balancer an IPv6 endpoint (see the module comment). Only for
 * haproxy load balancers; kube-vip and OVN take the address they were given.
 */
export function endpointProblem(input: {
  endpoint?: string;
  available: boolean;
  haproxy: boolean;
}): string | undefined {
  const host = endpointHost(input.endpoint);
  if (input.available || !input.haproxy || !host?.includes(":")) return undefined;
  return (
    `The API endpoint ${host} is an IPv6 address, but the cluster's haproxy load balancer ` +
    "only listens on IPv4, so the control plane cannot come up. The load balancer got its " +
    "IPv6 address before its IPv4 one. Delete the cluster and create it again: the agent " +
    "now pins an IPv4 endpoint for new clusters."
  );
}

/** `doc` with `ops` (appends from classEndpointPatch) applied, for a class in a manifest. */
export function applyClassPatch<T extends ClusterClassObject>(doc: T, ops: JsonPatchOp[]): T {
  const spec: Record<string, unknown> = { ...(doc.spec ?? {}) };
  for (const op of ops) {
    const [, , key, dash] = op.path.split("/");
    if (!key) continue;
    const list = Array.isArray(spec[key]) ? (spec[key] as unknown[]) : [];
    spec[key] = dash === "-" ? [...list, op.value] : (op.value as unknown[]);
  }
  return { ...doc, spec };
}
