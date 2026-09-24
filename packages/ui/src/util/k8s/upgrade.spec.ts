import { runningVersion, upgradeTargets } from "./upgrade";
import type { K8sMachine } from "./clusterNodes";

const AVAILABLE = [
  "v1.37.0",
  "v1.36.4",
  "v1.36.1",
  "v1.35.5",
  "v1.35.0",
  "v1.34.0",
];

describe("upgradeTargets", () => {
  it("offers newer patches and the next minor only", () => {
    expect(upgradeTargets("v1.36.1", AVAILABLE)).toEqual([
      "v1.37.0",
      "v1.36.4",
    ]);
    expect(upgradeTargets("v1.35.0", AVAILABLE)).toEqual([
      "v1.36.4",
      "v1.36.1",
      "v1.35.5",
    ]);
  });

  it("offers nothing on the newest version or an unparsable one", () => {
    expect(upgradeTargets("v1.37.0", AVAILABLE)).toEqual([]);
    expect(upgradeTargets("custom", AVAILABLE)).toEqual([]);
  });

  it("never jumps two minors, even over a missing image", () => {
    expect(upgradeTargets("v1.33.5", AVAILABLE)).toEqual(["v1.34.0"]);
    const noV134 = AVAILABLE.filter((v) => !v.startsWith("v1.34."));
    expect(upgradeTargets("v1.33.5", noV134)).toEqual([]);
  });
});

describe("runningVersion", () => {
  const machine = (version?: string): K8sMachine => ({
    name: "m",
    role: "worker",
    phase: "Running",
    ready: true,
    version,
  });

  it("is the oldest machine version while an upgrade rolls out", () => {
    expect(
      runningVersion([machine("v1.37.0"), machine("v1.36.4"), machine()]),
    ).toBe("v1.36.4");
  });

  it("is undefined without versioned machines", () => {
    expect(runningVersion([machine()])).toBeUndefined();
  });
});
