import { describe, expect, it } from "bun:test";
import { nextStatus } from "./lifecycle.ts";
import type { LiveStatus } from "./capi-status.ts";

const live = (over: Partial<LiveStatus>): LiveStatus => ({
  phase: "Provisioned",
  available: true,
  controlPlaneReady: 1,
  workerReady: 1,
  conditions: [],
  machines: [],
  ...over,
});

describe("nextStatus", () => {
  it("keeps a first bring-up in provisioning until Available, rollout or not", () => {
    expect(nextStatus("provisioning", live({ available: false, rollout: "scaling" }))).toBe(
      "provisioning",
    );
    expect(nextStatus("pending", live({ available: true, rollout: "scaling" }))).toBe("ready");
  });

  it("reports day-2 rollouts on a cluster that was ready", () => {
    expect(nextStatus("ready", live({ rollout: "scaling" }))).toBe("scaling");
    expect(nextStatus("scaling", live({ rollout: "upgrading" }))).toBe("upgrading");
    expect(nextStatus("upgrading", live({ rollout: undefined }))).toBe("ready");
  });

  it("falls back to provisioning when a ready cluster loses availability", () => {
    expect(nextStatus("ready", live({ available: false }))).toBe("provisioning");
  });

  it("reports a failed cluster as error whatever came before", () => {
    expect(nextStatus("ready", live({ phase: "Failed" }))).toBe("error");
    expect(nextStatus("provisioning", live({ phase: "Failed" }))).toBe("error");
  });
});
