import { describe, expect, it } from "bun:test";
import { customImageError, upgradeError } from "./upgrade.ts";

describe("upgradeError", () => {
  it("allows the next minor and patch releases", () => {
    expect(upgradeError("v1.36.4", "v1.37.0")).toBeNull();
    expect(upgradeError("v1.36.1", "v1.36.4")).toBeNull();
  });

  it("refuses skipping a minor version (kubeadm upgrades one at a time)", () => {
    expect(upgradeError("v1.35.5", "v1.37.0")).toMatch(/one minor version at a time.*v1\.36\.x/);
  });

  it("refuses downgrades, no-ops and major jumps", () => {
    expect(upgradeError("v1.37.0", "v1.36.4")).toMatch(/downgrades/);
    expect(upgradeError("v1.37.0", "v1.37.0")).toMatch(/already runs/);
    expect(upgradeError("v1.37.0", "v2.0.0")).toMatch(/major/);
  });

  it("rejects malformed versions", () => {
    expect(upgradeError("v1.37.0", "1.38.0")).toMatch(/invalid/);
  });
});

describe("customImageError", () => {
  it("blocks upgrades of clusters pinned to a custom image", () => {
    expect(customImageError({ LXC_IMAGE_NAME: "my-node" })).toMatch(/custom node image 'my-node'/);
  });

  it("allows the default kubeadm image and install-at-boot images", () => {
    expect(customImageError({})).toBeNull();
    expect(customImageError(undefined)).toBeNull();
    expect(customImageError({ LXC_IMAGE_NAME: "" })).toBeNull();
    expect(
      customImageError({ LXC_IMAGE_NAME: "ubuntu/24.04", INSTALL_KUBEADM: "true" }),
    ).toBeNull();
  });
});
