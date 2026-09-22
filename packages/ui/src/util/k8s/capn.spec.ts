import {
  buildTemplateVariables,
  defaultK8sClusterConfig,
  generateEnvExports,
  type K8sClusterConfig,
} from "./capn";

const custom: K8sClusterConfig = {
  ...defaultK8sClusterConfig,
  loadBalancer: "kube-vip",
  lbHost: "10.0.42.1",
  controlPlaneProfiles: "default, k8s",
  workerTarget: "node2",
  installKubeadm: true,
  imageName: "ubuntu/24.04",
  controlPlaneCustomFlavor: true,
  controlPlaneFlavor: "t3.medium",
};

// Golden output: the preview the create page shows must not drift while the
// variable map is shared with the agent.
describe("generateEnvExports", () => {
  it("renders the default config", () => {
    expect(generateEnvExports(defaultK8sClusterConfig)).toMatchInlineSnapshot(`
      "export CLUSTER_NAME=c1
      export KUBERNETES_VERSION=v1.37.0
      export LXC_SECRET_NAME=lxc-secret
      export LOAD_BALANCER='lxc: {profiles: [default], flavor: c1-m1}'
      export CONTROL_PLANE_MACHINE_COUNT=1
      export WORKER_MACHINE_COUNT=1
      export CONTROL_PLANE_MACHINE_TYPE=container
      export WORKER_MACHINE_TYPE=container
      export CONTROL_PLANE_MACHINE_FLAVOR=c2-m4
      export WORKER_MACHINE_FLAVOR=c2-m4
      export PRIVILEGED=true
      export DEPLOY_KUBE_FLANNEL=true
      export POD_CIDR=[10.244.0.0/16]
      export SERVICE_CIDR=[10.96.0.0/12]"
    `);
  });

  it("renders a customised config", () => {
    expect(generateEnvExports(custom)).toMatchInlineSnapshot(`
      "export CLUSTER_NAME=c1
      export KUBERNETES_VERSION=v1.37.0
      export LXC_SECRET_NAME=lxc-secret
      export LOAD_BALANCER='kube-vip: {host: 10.0.42.1}'
      export CONTROL_PLANE_MACHINE_COUNT=1
      export WORKER_MACHINE_COUNT=1
      export CONTROL_PLANE_MACHINE_TYPE=container
      export WORKER_MACHINE_TYPE=container
      export CONTROL_PLANE_MACHINE_FLAVOR=t3.medium
      export WORKER_MACHINE_FLAVOR=c2-m4
      export CONTROL_PLANE_MACHINE_PROFILES=[default, k8s]
      export WORKER_MACHINE_TARGET="node2"
      export PRIVILEGED=true
      export DEPLOY_KUBE_FLANNEL=true
      export INSTALL_KUBEADM=true
      export LXC_IMAGE_NAME=ubuntu/24.04
      export POD_CIDR=[10.244.0.0/16]
      export SERVICE_CIDR=[10.96.0.0/12]"
    `);
  });
});

describe("buildTemplateVariables", () => {
  it("carries every form option the agent must apply", () => {
    const vars = buildTemplateVariables({
      ...defaultK8sClusterConfig,
      deployKubeFlannel: true,
    });
    expect(vars.DEPLOY_KUBE_FLANNEL).toBe("true");
    expect(vars.PRIVILEGED).toBeDefined();
    expect(vars.LOAD_BALANCER).toMatch(/^lxc: /);
    expect(vars.POD_CIDR).toMatch(/^\[.*\]$/);
  });

  it("stores raw values without shell quoting", () => {
    const vars = buildTemplateVariables(custom);
    expect(vars.LOAD_BALANCER).toBe("kube-vip: {host: 10.0.42.1}");
    expect(vars.WORKER_MACHINE_TARGET).toBe("node2");
    expect(vars.CONTROL_PLANE_MACHINE_FLAVOR).toBe("t3.medium");
  });

  it("leaves agent-owned identity out of the map", () => {
    const vars = buildTemplateVariables(defaultK8sClusterConfig);
    expect(vars).not.toHaveProperty("LXC_SECRET_NAME");
  });
});
