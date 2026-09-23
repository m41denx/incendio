import { describe, expect, it } from "bun:test";
import { TemplateVariables, templateEnv } from "./template-vars.ts";

const base = { secretName: "incendio-c1", defaultLoadBalancer: "lxc: {profiles: [default], flavor: c1-m1}" };

describe("TemplateVariables", () => {
  it("accepts known CAPN template variables", () => {
    const parsed = TemplateVariables.safeParse({
      DEPLOY_KUBE_FLANNEL: "true",
      WORKER_MACHINE_FLAVOR: "c4-m8",
      LOAD_BALANCER: "kube-vip: {host: 10.0.42.1}",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown keys instead of silently dropping them", () => {
    const parsed = TemplateVariables.safeParse({ DEPLOY_KUBE_FLANEL: "true" });
    expect(parsed.success).toBe(false);
  });

  it("rejects agent-owned identity", () => {
    expect(TemplateVariables.safeParse({ LXC_SECRET_NAME: "x" }).success).toBe(false);
  });
});

describe("control-plane size", () => {
  const issues = (vars: Record<string, string>) => {
    const r = TemplateVariables.safeParse(vars);
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it("rejects a control plane kubeadm cannot initialize", () => {
    expect(issues({ CONTROL_PLANE_MACHINE_FLAVOR: "c1-m2" })[0]).toMatch(/2 CPUs/);
    expect(issues({ CONTROL_PLANE_MACHINE_FLAVOR: "c2-m1.5" })[0]).toMatch(/1700 MiB/);
  });

  it("accepts the minimum and anything larger", () => {
    expect(issues({ CONTROL_PLANE_MACHINE_FLAVOR: "c2-m2" })).toEqual([]);
    expect(issues({ CONTROL_PLANE_MACHINE_FLAVOR: "c4-m8" })).toEqual([]);
  });

  it("lets AWS-style names through (size unknown)", () => {
    expect(issues({ CONTROL_PLANE_MACHINE_FLAVOR: "t3.medium" })).toEqual([]);
  });

  it("does not constrain workers", () => {
    expect(issues({ WORKER_MACHINE_FLAVOR: "c1-m1" })).toEqual([]);
  });
});

describe("templateEnv", () => {
  it("passes the form's choices through to clusterctl", () => {
    const env = templateEnv(
      { DEPLOY_KUBE_FLANNEL: "true", PRIVILEGED: "false", POD_CIDR: "[10.1.0.0/16]" },
      base,
    );
    expect(env.DEPLOY_KUBE_FLANNEL).toBe("true");
    expect(env.PRIVILEGED).toBe("false");
    expect(env.POD_CIDR).toBe("[10.1.0.0/16]");
  });

  it("always uses the agent's identity secret", () => {
    expect(templateEnv({}, base).LXC_SECRET_NAME).toBe("incendio-c1");
  });

  it("defaults a working CNI and load balancer when the caller sends none", () => {
    const env = templateEnv({}, base);
    expect(env.DEPLOY_KUBE_FLANNEL).toBe("true");
    expect(env.LOAD_BALANCER).toBe(base.defaultLoadBalancer);
  });

  it("respects an explicit opt-out of flannel", () => {
    expect(templateEnv({ DEPLOY_KUBE_FLANNEL: "false" }, base).DEPLOY_KUBE_FLANNEL).toBe("false");
  });

  it("leaves flag-driven values to the dedicated fields", () => {
    const env = templateEnv({ CLUSTER_NAME: "c1", WORKER_MACHINE_COUNT: "3" }, base);
    expect(env).not.toHaveProperty("CLUSTER_NAME");
    expect(env).not.toHaveProperty("WORKER_MACHINE_COUNT");
  });
});
