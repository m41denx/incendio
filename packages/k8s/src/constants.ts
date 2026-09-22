export const AGENT = {
  name: "incendio-k8s-agent",
  version: "0.0.1",
  apiVersion: "v1",
} as const;

export const FLAVORS = ["bridge", "ovn"] as const;
export type Flavor = (typeof FLAVORS)[number];
