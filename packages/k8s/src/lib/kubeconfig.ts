/**
 * CAPI writes a workload cluster's admin kubeconfig to the `<cluster>-kubeconfig`
 * Secret (single key `value`, base64 YAML) once the control plane is up —
 * the same material `clusterctl get kubeconfig` prints.
 */
export function kubeconfigFromSecret(secret: {
  data?: Record<string, string>;
}): string | null {
  const value = secret.data?.value;
  if (!value) return null;
  return Buffer.from(value, "base64").toString("utf8");
}
