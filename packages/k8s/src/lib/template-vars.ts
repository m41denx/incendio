import { z } from "zod";

/**
 * CAPN default-template variables a create request may set (see
 * docs/k8s/capn-reference.md §3.1). The UI builds these with the same function
 * that renders its "Cluster variables" preview, so the preview is exactly what
 * gets applied.
 */
export const TEMPLATE_VARIABLES = [
  "LOAD_BALANCER",
  "CONTROL_PLANE_MACHINE_TYPE",
  "WORKER_MACHINE_TYPE",
  "CONTROL_PLANE_MACHINE_FLAVOR",
  "WORKER_MACHINE_FLAVOR",
  "CONTROL_PLANE_MACHINE_PROFILES",
  "WORKER_MACHINE_PROFILES",
  "CONTROL_PLANE_MACHINE_DEVICES",
  "WORKER_MACHINE_DEVICES",
  "CONTROL_PLANE_MACHINE_TARGET",
  "WORKER_MACHINE_TARGET",
  "PRIVILEGED",
  "DEPLOY_KUBE_FLANNEL",
  "INSTALL_KUBEADM",
  "LXC_IMAGE_NAME",
  "POD_CIDR",
  "SERVICE_CIDR",
] as const;

/**
 * Carried in the same map for the preview, but clusterctl takes them as flags
 * built from the request's dedicated fields, which stay authoritative.
 */
const FLAG_OWNED = [
  "CLUSTER_NAME",
  "KUBERNETES_VERSION",
  "CONTROL_PLANE_MACHINE_COUNT",
  "WORKER_MACHINE_COUNT",
] as const;

const ALLOWED = new Set<string>([...TEMPLATE_VARIABLES, ...FLAG_OWNED]);
const FLAG_OWNED_SET = new Set<string>(FLAG_OWNED);

/**
 * Unknown keys are rejected rather than ignored: silently dropping options is
 * how clusters used to come up without the CNI the user had selected.
 * LXC_SECRET_NAME is agent-owned (it creates that identity secret).
 */
export const TemplateVariables = z
  .record(z.string(), z.string().max(4096))
  .superRefine((vars, ctx) => {
    for (const key of Object.keys(vars)) {
      if (!ALLOWED.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `unsupported template variable '${key}'`,
        });
      }
    }
  });

export interface TemplateEnvDefaults {
  secretName: string;
  defaultLoadBalancer: string;
}

/** Environment for `clusterctl generate cluster`. */
export function templateEnv(
  variables: Record<string, string>,
  { secretName, defaultLoadBalancer }: TemplateEnvDefaults,
): Record<string, string> {
  const env: Record<string, string> = {
    // A cluster without a CNI never gets Ready nodes, so default it on.
    DEPLOY_KUBE_FLANNEL: "true",
    LOAD_BALANCER: defaultLoadBalancer,
  };
  for (const [key, value] of Object.entries(variables)) {
    if (!FLAG_OWNED_SET.has(key)) env[key] = value;
  }
  env.LXC_SECRET_NAME = secretName;
  return env;
}
