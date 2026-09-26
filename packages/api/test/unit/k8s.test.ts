import { describe, expect, test } from "bun:test";
import axios, {
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from "axios";
import {
  K8sAgentClient,
  K8sAgentError,
  buildApplianceCloudInit,
  buildTemplateVariables,
  createClusterRequest,
  extractBootstrapError,
  groupClusterNodes,
  resolveApplianceDevices,
  upgradeTargets,
} from "../../src/k8s";
import { normalizeFingerprint } from "../../src/utils/certificates";

describe("cluster spec → CAPN variables", () => {
  test("defaults match the UI create form", () => {
    // packages/ui/src/util/k8s/capn.ts buildTemplateVariables(defaultK8sClusterConfig)
    // with clusterName "demo".
    expect(buildTemplateVariables({ name: "demo" })).toEqual({
      CLUSTER_NAME: "demo",
      KUBERNETES_VERSION: "v1.37.0",
      LOAD_BALANCER: "lxc: {profiles: [default], flavor: c1-m1}",
      CONTROL_PLANE_MACHINE_COUNT: "1",
      WORKER_MACHINE_COUNT: "1",
      CONTROL_PLANE_MACHINE_TYPE: "container",
      WORKER_MACHINE_TYPE: "container",
      CONTROL_PLANE_MACHINE_FLAVOR: "c2-m4",
      WORKER_MACHINE_FLAVOR: "c2-m4",
      PRIVILEGED: "true",
      DEPLOY_KUBE_FLANNEL: "true",
      POD_CIDR: "[10.244.0.0/16]",
      SERVICE_CIDR: "[10.96.0.0/12]",
    });
  });

  test("options map onto variables", () => {
    const vars = buildTemplateVariables({
      name: "prod",
      kubernetesVersion: "v1.36.4",
      controlPlane: {
        count: 3,
        type: "vm",
        flavor: { cpu: 4, memoryGiB: 8 },
        profiles: ["default", "fast"],
        target: "@gpu",
      },
      workers: { count: 5, flavor: "t3.medium" },
      loadBalancer: { type: "ovn", host: "10.0.0.10", network: "ovn0" },
      flannel: false,
      image: "custom/kubeadm",
      variables: { POD_CIDR: "[10.1.0.0/16]" },
    });
    expect(vars).toMatchObject({
      KUBERNETES_VERSION: "v1.36.4",
      CONTROL_PLANE_MACHINE_COUNT: "3",
      CONTROL_PLANE_MACHINE_TYPE: "virtual-machine",
      CONTROL_PLANE_MACHINE_FLAVOR: "c4-m8",
      CONTROL_PLANE_MACHINE_PROFILES: "[default, fast]",
      CONTROL_PLANE_MACHINE_TARGET: "@gpu",
      WORKER_MACHINE_COUNT: "5",
      WORKER_MACHINE_FLAVOR: "t3.medium",
      LOAD_BALANCER: "ovn: {host: 10.0.0.10, networkName: ovn0}",
      DEPLOY_KUBE_FLANNEL: "false",
      LXC_IMAGE_NAME: "custom/kubeadm",
      POD_CIDR: "[10.1.0.0/16]",
    });
    expect(vars.WORKER_MACHINE_PROFILES).toBeUndefined();
  });

  test("rejects a control plane kubeadm cannot initialize", () => {
    expect(() =>
      buildTemplateVariables({ name: "x", controlPlane: { flavor: "c1-m4" } }),
    ).toThrow(/at least 2 CPUs/);
    expect(() =>
      buildTemplateVariables({
        name: "x",
        controlPlane: { flavor: { cpu: 2, memoryGiB: 1 } },
      }),
    ).toThrow(/1700 MiB/);
  });

  test("request body carries counts and version from the spec", () => {
    const body = createClusterRequest({
      name: "demo",
      workers: { count: 0 },
      project: "k8s-demo",
    });
    expect(body).toMatchObject({
      name: "demo",
      kubernetesVersion: "v1.37.0",
      controlPlaneCount: 1,
      workerCount: 0,
      project: "k8s-demo",
    });
    expect(body.metallb).toBeUndefined();
  });

  test("request body carries MetalLB addresses when asked", () => {
    const body = createClusterRequest({
      name: "demo",
      metallb: ["10.0.0.200-10.0.0.219"],
    });
    expect(body.metallb).toEqual({ addresses: ["10.0.0.200-10.0.0.219"] });
    expect(body.variables).not.toHaveProperty("metallb");
  });

  test("upgrade targets: newer, same major, at most one minor ahead", () => {
    expect(upgradeTargets("v1.35.0")).toEqual([
      "v1.36.4",
      "v1.36.1",
      "v1.35.5",
    ]);
    expect(upgradeTargets("v1.37.0")).toEqual([]);
    expect(upgradeTargets("bogus")).toEqual([]);
  });
});

describe("appliance", () => {
  test("cloud-init writes credentials and agent env, then runs the pinned bootstrap", () => {
    const text = buildApplianceCloudInit({
      token: "tok",
      jwtSecret: "jwt",
      corsOrigin: "https://incus:8443",
      agentHost: "incus",
      incusApiUrl: "https://10.0.0.1:8443",
      credentials: { clientCrt: "CRT", clientKey: "KEY" },
      serverCrt: "SRV",
      repo: "m41denx/incendio",
      tag: "appliance-v1",
    });
    expect(text.startsWith("#cloud-config\n")).toBe(true);
    const config = JSON.parse(text.slice("#cloud-config\n".length)) as {
      write_files: { path: string; content: string }[];
      runcmd: string[];
    };
    const env = config.write_files.find((f) =>
      f.path.endsWith("agent.env"),
    )!.content;
    expect(env).toContain("AGENT_TOKEN=tok");
    expect(env).toContain("INCUS_API_URL=https://10.0.0.1:8443");
    expect(env).toContain("AGENT_TLS_SAN=incus");
    expect(config.runcmd.at(-1)).toContain("bash /opt/incendio/bootstrap.sh");
  });

  test("adds a root disk and NIC only when the default profile lacks them", () => {
    const pools = [{ name: "fast", status: "Created" }] as never;
    const networks = [
      {
        name: "ovn0",
        type: "ovn",
        managed: true,
        config: { "ipv4.address": "10.1.0.1/24" },
      },
      {
        name: "br0",
        type: "bridge",
        managed: true,
        config: { "ipv4.address": "10.0.0.1/24" },
      },
      { name: "eth9", type: "physical", managed: false, config: {} },
    ] as never;
    expect(
      resolveApplianceDevices({ devices: {} } as never, pools, networks),
    ).toEqual({
      root: { type: "disk", path: "/", pool: "fast" },
      eth0: { type: "nic", name: "eth0", network: "br0" },
    });
    const full = {
      devices: {
        root: { type: "disk", path: "/", pool: "default" },
        eth0: { type: "nic", network: "incusbr0" },
      },
    } as never;
    expect(resolveApplianceDevices(full, pools, networks)).toEqual({});
  });
});

describe("nodes", () => {
  test("joins CAPN-stamped instances with CAPI machines", () => {
    const instance = (name: string, role: string, machine?: string) =>
      ({
        name,
        status: "Running",
        config: {
          "user.cluster-name": "c1",
          "user.cluster-role": role,
          ...(machine ? { "user.machine-name": machine } : {}),
        },
      }) as never;
    const nodes = groupClusterNodes(
      "c1",
      [
        instance("c1-cp", "control-plane", "c1-cp"),
        instance("c1-lb", "loadbalancer"),
        instance("c1-w1", "worker", "c1-w1"),
        { name: "other", config: { "user.cluster-name": "c2" } } as never,
      ],
      [
        {
          name: "c1-cp",
          role: "control-plane",
          phase: "Running",
          ready: true,
          nodeName: "c1-cp",
        },
        { name: "c1-w1", role: "worker", phase: "Running", ready: true },
        { name: "c1-w2", role: "worker", phase: "Pending", ready: false },
      ],
    );
    expect(
      nodes.map((n) => `${n.role}:${n.name}:${!!n.instance}:${!!n.machine}`),
    ).toEqual([
      "control-plane:c1-cp:true:true",
      "loadbalancer:c1-lb:true:false",
      "worker:c1-w1:true:true",
      "worker:c1-w2:false:true",
    ]);
  });

  test("extracts kubeadm preflight errors", () => {
    const log = [
      "[init] Using Kubernetes version: v1.37.0",
      "[ERROR NumCPU]: the number of available CPUs 1 is less than the required 2",
      "[ERROR Mem]: the system RAM (1024 MB) is less than the minimum 1700 MB",
      "error execution phase preflight",
    ].join("\n");
    expect(extractBootstrapError(log)).toBe(
      "[ERROR NumCPU]: the number of available CPUs 1 is less than the required 2; [ERROR Mem]: the system RAM (1024 MB) is less than the minimum 1700 MB",
    );
    expect(extractBootstrapError("ok\nerror: something broke\n")).toBe(
      "error: something broke",
    );
  });
});

describe("agent client", () => {
  const client = (
    reply: (config: InternalAxiosRequestConfig) => [number, unknown],
  ) => {
    const calls: InternalAxiosRequestConfig[] = [];
    const adapter: AxiosAdapter = async (config) => {
      calls.push(config);
      const [status, data] = reply(config);
      const response = {
        data,
        status,
        statusText: String(status),
        headers: {},
        config,
      };
      if (status >= 400) {
        throw new axios.AxiosError(
          "fail",
          String(status),
          config,
          undefined,
          response,
        );
      }
      return response;
    };
    return {
      agent: new K8sAgentClient({
        url: "https://agent:8843/",
        token: "tok",
        axios: { adapter },
      }),
      calls,
    };
  };

  test("sends the bearer token and unwraps responses", async () => {
    const { agent, calls } = client((c) =>
      c.url === "/v1/clusters"
        ? [200, { clusters: [{ name: "c1" }] }]
        : [404, {}],
    );
    expect((await agent.listClusters()).map((c) => c.name)).toEqual(["c1"]);
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
    expect(calls[0]!.baseURL).toBe("https://agent:8843");
  });

  test("maps { error, detail } and 401 into K8sAgentError", async () => {
    const { agent } = client((c) =>
      c.url === "/v1/clusters/c1/kubeconfig"
        ? [
            409,
            {
              error: "kubeconfig not available yet",
              detail: "the control plane has not finished initializing",
            },
          ]
        : [401, { error: "unauthorized" }],
    );
    const err = await agent.getKubeconfig("c1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(K8sAgentError);
    expect((err as K8sAgentError).status).toBe(409);
    expect((err as Error).message).toBe(
      "kubeconfig not available yet: the control plane has not finished initializing",
    );
    const unauthorized = await agent.listClusters().catch((e: unknown) => e);
    expect((unauthorized as K8sAgentError).isUnauthorized).toBe(true);
  });

  test("MetalLB and controller endpoints", async () => {
    const { agent, calls } = client((c) => {
      const key = `${c.method?.toUpperCase()} ${c.url}`;
      switch (key) {
        case "GET /v1/clusters/c1/metallb":
          return [
            200,
            {
              state: "installed",
              addresses: ["10.0.0.200-10.0.0.219"],
              services: [],
            },
          ];
        case "PUT /v1/clusters/c1/metallb":
          return [202, { state: "installing", requested: ["10.0.0.200/30"] }];
        case "DELETE /v1/clusters/c1/metallb":
          return [202, { state: "removing" }];
        case "GET /v1/clusters/metallb-hint":
          return [
            200,
            {
              network: "br0",
              cidr: "10.0.0.1/24",
              subnet: "10.0.0.0/24",
              range: "10.0.0.235-10.0.0.254",
            },
          ];
        case "GET /v1/management/controllers":
          return [
            200,
            {
              deployments: [],
              unreachable: [],
              restarting: false,
              watchdog: true,
            },
          ];
        case "POST /v1/management/controllers/restart":
          return [
            202,
            {
              at: "2026-09-26T00:00:00Z",
              reason: "requested from the UI",
              automatic: false,
            },
          ];
        default:
          return [404, {}];
      }
    });
    expect((await agent.getMetalLB("c1")).state).toBe("installed");
    expect((await agent.setMetalLB("c1", ["10.0.0.200/30"])).state).toBe(
      "installing",
    );
    expect(JSON.parse(String(calls.at(-1)!.data))).toEqual({
      addresses: ["10.0.0.200/30"],
    });
    expect((await agent.removeMetalLB("c1")).state).toBe("removing");
    expect((await agent.getMetalLBHint("c1")).range).toBe(
      "10.0.0.235-10.0.0.254",
    );
    expect(calls.at(-1)!.params).toEqual({ cluster: "c1" });
    await agent.getMetalLBHint();
    expect(calls.at(-1)!.params).toBeUndefined();
    expect((await agent.getControllers()).watchdog).toBe(true);
    expect((await agent.restartControllers()).automatic).toBe(false);
  });
});

test("fingerprint spellings normalize to lowercase hex", () => {
  expect(normalizeFingerprint("sha256:ABCD")).toBe("abcd");
  expect(normalizeFingerprint("AB:CD:EF")).toBe("abcdef");
});
