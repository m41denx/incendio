import {
  diagnoseBootstrap,
  extractBootstrapError,
  shouldDiagnoseBootstrap,
} from "./bootstrap";
import type { ClusterNode } from "./clusterNodes";
import type { LxdInstance } from "types/instance";

// Tail of /var/log/cloud-init-output.log from a real control-plane node that
// was given 1 CPU (cluster "demo").
const NUM_CPU_LOG = `+ kubeadm init --config /run/kubeadm/kubeadm.yaml
[init] Using Kubernetes version: v1.37.0
[preflight] Running pre-flight checks
\t[WARNING Swap]: swap is supported for cgroup v2 only.
\t[WARNING SystemVerification]: missing optional cgroups: hugetlb
[preflight] Some fatal errors occurred:
\t[ERROR NumCPU]: the number of available CPUs 1 is less than the required 2
[preflight] If you know what you are doing, you can make a check non-fatal with \`--ignore-preflight-errors=...\`
error: error execution phase preflight: preflight checks failed
To see the stack trace of this error execute with --v=5 or higher
+ set -x
Cloud-init v. 26.1-0ubuntu1~24.04.1 finished at Wed, 23 Sep 2026 19:56:42 +0000.`;

describe("extractBootstrapError", () => {
  it("prefers kubeadm's [ERROR ...] preflight lines", () => {
    expect(extractBootstrapError(NUM_CPU_LOG)).toBe(
      "[ERROR NumCPU]: the number of available CPUs 1 is less than the required 2",
    );
  });

  it("falls back to an error: line", () => {
    expect(
      extractBootstrapError(
        "[kubelet-check] waiting\nerror: error execution phase wait-control-plane: timed out\n",
      ),
    ).toBe("error: error execution phase wait-control-plane: timed out");
  });

  it("returns null when nothing looks like an error", () => {
    expect(extractBootstrapError("all good\n")).toBeNull();
  });
});

describe("diagnoseBootstrap", () => {
  it("is running while cloud-init has not finished", () => {
    expect(
      diagnoseBootstrap({ cloudInitDone: false, succeeded: false, log: null })
        .state,
    ).toBe("running");
  });

  it("is succeeded once CAPI's sentinel file exists", () => {
    expect(
      diagnoseBootstrap({ cloudInitDone: true, succeeded: true, log: null })
        .state,
    ).toBe("succeeded");
  });

  it("is failed when cloud-init finished without the sentinel", () => {
    // cloud-init itself reports `status: done` here — only the missing
    // sentinel tells us kubeadm failed.
    const d = diagnoseBootstrap({
      cloudInitDone: true,
      succeeded: false,
      log: NUM_CPU_LOG,
    });
    expect(d.state).toBe("failed");
    expect(d.reason).toMatch(/NumCPU/);
    expect(d.logTail).toContain("kubeadm init");
  });

  it("still reports a failure when the log is unreadable", () => {
    const d = diagnoseBootstrap({
      cloudInitDone: true,
      succeeded: false,
      log: null,
    });
    expect(d.state).toBe("failed");
    expect(d.reason).toMatch(/did not complete/);
  });

  it("is unknown when the files could not be read", () => {
    expect(
      diagnoseBootstrap({ cloudInitDone: null, succeeded: null, log: null })
        .state,
    ).toBe("unknown");
  });
});

describe("shouldDiagnoseBootstrap", () => {
  const node = (status: string, nodeName?: string, ready = false) =>
    ({
      name: "n",
      instance: { name: "n", status } as LxdInstance,
      machine: {
        name: "n",
        role: "worker",
        phase: "Provisioned",
        ready,
        nodeName,
      },
    }) as ClusterNode;

  it("checks running nodes whose machine never joined", () => {
    expect(shouldDiagnoseBootstrap(node("Running"))).toBe(true);
  });

  it("skips nodes that joined (a reboot wipes the /run sentinel)", () => {
    expect(shouldDiagnoseBootstrap(node("Running", "n"))).toBe(false);
  });

  it("skips stopped instances and load balancers (no machine)", () => {
    expect(shouldDiagnoseBootstrap(node("Stopped"))).toBe(false);
    expect(
      shouldDiagnoseBootstrap({
        name: "lb",
        instance: { name: "lb", status: "Running" } as LxdInstance,
      } as ClusterNode),
    ).toBe(false);
  });
});
