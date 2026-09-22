import { buildApplianceInstance, resolveApplianceDevices } from "./appliance";
import type { LxdProfile } from "types/profile";
import type { LxdNetwork } from "types/network";
import type { LxdStoragePool } from "types/storage";

const profile = (devices: LxdProfile["devices"]): LxdProfile => ({
  name: "default",
  description: "",
  config: {},
  devices,
});

const pool = (name: string, status = "Created"): LxdStoragePool =>
  ({ name, status, driver: "dir", description: "" }) as LxdStoragePool;

const network = (
  name: string,
  type: string,
  managed: boolean,
  ipv4?: string,
): LxdNetwork =>
  ({
    name,
    type,
    managed,
    config: ipv4 ? { "ipv4.address": ipv4 } : {},
  }) as LxdNetwork;

describe("resolveApplianceDevices", () => {
  it("adds nothing when the default profile has a root disk and a NIC", () => {
    const devices = resolveApplianceDevices(
      profile({
        root: { type: "disk", path: "/", pool: "p" },
        eth0: { type: "nic", network: "br" },
      }),
      [pool("p")],
      [network("br", "bridge", true, "10.0.0.1/24")],
    );
    expect(devices).toEqual({});
  });

  it("adds root + eth0 when the default profile is empty", () => {
    const devices = resolveApplianceDevices(
      profile({}),
      [pool("nevergoonalone")],
      [
        network("eth0", "physical", false),
        network("rwg", "ovn", true, "10.158.198.1/24"),
        network("gay", "bridge", true, "10.133.241.1/24"),
      ],
    );
    expect(devices).toEqual({
      root: { type: "disk", path: "/", pool: "nevergoonalone" },
      eth0: { type: "nic", name: "eth0", network: "gay" },
    });
  });

  it("skips NAT-less bridges and unmanaged networks", () => {
    const devices = resolveApplianceDevices(
      profile({ root: { type: "disk", path: "/", pool: "p" } }),
      [pool("p")],
      [
        network("br-int", "bridge", false),
        network("nonat", "bridge", true, "none"),
        network("ok", "bridge", true, "10.1.0.1/24"),
      ],
    );
    expect(devices).toEqual({
      eth0: { type: "nic", name: "eth0", network: "ok" },
    });
  });

  it("throws a clear error when no storage pool exists", () => {
    expect(() =>
      resolveApplianceDevices(
        profile({}),
        [],
        [network("b", "bridge", true, "10.0.0.1/24")],
      ),
    ).toThrow(/storage pool/i);
  });

  it("throws a clear error when no usable network exists", () => {
    expect(() => resolveApplianceDevices(profile({}), [pool("p")], [])).toThrow(
      /network/i,
    );
  });
});

describe("buildApplianceInstance", () => {
  it("merges extra devices alongside the proxy device", () => {
    const body = buildApplianceInstance({
      cloudInit: "#cloud-config\n{}",
      cpu: 2,
      memory: "4GiB",
      devices: { root: { type: "disk", path: "/", pool: "p" } },
    });
    expect(body.devices).toMatchObject({
      root: { type: "disk", path: "/", pool: "p" },
      "k8s-api": { type: "proxy" },
    });
  });
});

describe("appliance image", () => {
  it("uses the cloud variant so cloud-init runs the bootstrap", () => {
    const body = buildApplianceInstance({
      cloudInit: "#cloud-config\n{}",
      cpu: 2,
      memory: "4GiB",
    });
    const source = body.source as { alias: string };
    // The default images: variant ships without cloud-init, so user-data is
    // silently ignored and the appliance never bootstraps.
    expect(source.alias).toMatch(/\/cloud$/);
  });
});
