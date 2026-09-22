import { describe, expect, it } from "bun:test";
import { kubeconfigFromSecret } from "./kubeconfig.ts";

const KUBECONFIG = "apiVersion: v1\nkind: Config\nclusters:\n- cluster:\n    server: https://10.0.0.1:6443\n  name: c1\n";

describe("kubeconfigFromSecret", () => {
  it("decodes the CAPI <cluster>-kubeconfig secret value", () => {
    const secret = { data: { value: Buffer.from(KUBECONFIG).toString("base64") } };
    expect(kubeconfigFromSecret(secret)).toBe(KUBECONFIG);
  });

  it("returns null while CAPI has not written the kubeconfig yet", () => {
    expect(kubeconfigFromSecret({ data: {} })).toBeNull();
    expect(kubeconfigFromSecret({})).toBeNull();
  });
});
