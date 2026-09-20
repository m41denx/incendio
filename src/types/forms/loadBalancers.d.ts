export interface LoadBalancerFormValues {
  listenAddress: string;
  description: string;
  ports: LoadBalancerPortFormValues[];
  // Present (even if empty) only in the Incus backend model; its presence is
  // what switches the form/payload from the LXD pool model to backends.
  backends?: LoadBalancerBackendFormValues[];
}

export interface LoadBalancerPortFormValues {
  key: string;
  protocol: "tcp" | "udp";
  listenPort: string;
  // LXD pool model.
  targetPool?: string;
  // Incus backend model (single backend name; sent to the API as a list).
  targetBackend?: string;
}

export interface LoadBalancerBackendFormValues {
  key: string;
  name: string;
  targetAddress: string;
  targetPort: string;
  description?: string;
}

export interface LoadBalancerPoolFormValues {
  name: string;
  description: string;
  targetPort: string;
  protocol: "tcp" | "udp";
  instances: LoadBalancerPoolInstanceFormValues[];
  healthCheckType: "default" | "custom" | "disabled";
  healthCheckInterval?: string;
  healthCheckTimeout?: string;
  healthCheckSuccessCount?: string;
  healthCheckFailureCount?: string;
}

export interface LoadBalancerPoolInstanceFormValues {
  name: string;
  targetPort?: string;
}
