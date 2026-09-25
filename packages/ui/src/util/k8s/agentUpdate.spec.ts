import {
  buildAgentRollbackScript,
  buildAgentUpdateScript,
  compareAgentVersions,
  isAgentUpdateAvailable,
  parseAgentManifest,
} from "./agentUpdate";

const SUM_A = "a".repeat(64);
const SUM_B = "b".repeat(64);
const MANIFEST = JSON.stringify({
  version: "0.2.0",
  binaries: {
    amd64: { name: "k8s-api-linux-amd64", sha256: SUM_A },
    arm64: { name: "k8s-api-linux-arm64", sha256: SUM_B },
  },
});

describe("parseAgentManifest", () => {
  it("reads the version and per-arch binaries", () => {
    const manifest = parseAgentManifest(MANIFEST);
    expect(manifest.version).toBe("0.2.0");
    expect(manifest.binaries.arm64).toEqual({
      name: "k8s-api-linux-arm64",
      sha256: SUM_B,
    });
  });

  it("rejects missing checksums and unsafe asset names", () => {
    const bad = JSON.parse(MANIFEST) as {
      binaries: { amd64: { name: string; sha256: string } };
    };
    bad.binaries.amd64.sha256 = "nope";
    expect(() => parseAgentManifest(JSON.stringify(bad))).toThrow(/amd64/);
    bad.binaries.amd64 = { name: "x; rm -rf /", sha256: SUM_A };
    expect(() => parseAgentManifest(JSON.stringify(bad))).toThrow(/amd64/);
  });

  it("rejects a manifest without a version", () => {
    expect(() => parseAgentManifest("{}")).toThrow(/version/);
  });
});

describe("agent versions", () => {
  it("compares numerically, not as strings", () => {
    expect(compareAgentVersions("0.10.0", "0.9.1")).toBeGreaterThan(0);
    expect(compareAgentVersions("0.2.0", "0.2.0")).toBe(0);
  });

  it("offers an update only for a newer release", () => {
    expect(isAgentUpdateAvailable("0.0.1", "0.2.0")).toBe(true);
    expect(isAgentUpdateAvailable("0.2.0", "0.2.0")).toBe(false);
    expect(isAgentUpdateAvailable("0.3.0", "0.2.0")).toBe(false);
    expect(isAgentUpdateAvailable(undefined, "0.2.0")).toBe(false);
  });
});

describe("buildAgentUpdateScript", () => {
  const script = buildAgentUpdateScript(
    parseAgentManifest(MANIFEST),
    "https://x/rel",
  );

  it("verifies the checksum before touching the running binary", () => {
    const verify = script.indexOf("sha256sum -c");
    expect(verify).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(
      script.indexOf("cp -f /usr/local/bin/incendio-k8s"),
    );
    expect(script).toContain(`name='k8s-api-linux-amd64'; sum='${SUM_A}'`);
    expect(script).toContain(`'https://x/rel/'"$name"`);
  });

  it("keeps the previous binary and restarts the service", () => {
    expect(script).toContain(
      "cp -f /usr/local/bin/incendio-k8s /usr/local/bin/incendio-k8s.prev",
    );
    expect(script).toMatch(/systemctl restart incendio-k8s\n/);
  });
});

describe("buildAgentRollbackScript", () => {
  const script = buildAgentRollbackScript();

  it("refuses without a previous binary", () => {
    expect(script).toContain("test -x /usr/local/bin/incendio-k8s.prev ||");
  });

  it("swaps the binaries, so a second rollback undoes the first", () => {
    const current = script.indexOf(
      "mv -f /usr/local/bin/incendio-k8s /usr/local/bin/incendio-k8s.prev",
    );
    const previous = script.indexOf(
      "mv -f /usr/local/bin/incendio-k8s.rollback /usr/local/bin/incendio-k8s",
    );
    expect(current).toBeGreaterThan(-1);
    expect(previous).toBeGreaterThan(current);
    expect(script).toMatch(/systemctl restart incendio-k8s\n/);
  });
});
