import { describe, expect, it } from "bun:test";
import {
  buildPoolManifest,
  loadBalancerServices,
  MetalLBBody,
  outsideSubnet,
  overlapping,
  parseRange,
  suggestRange,
} from "./metallb.ts";

// The appliance host's bridge "gay": DHCP .51-.80, OVN .5-.50.
const gay = {
  cidr: "10.133.241.1/24",
  reserved: ["10.133.241.51-10.133.241.80", "10.133.241.5-10.133.241.50"],
  used: ["10.133.241.54", "10.133.241.59", "10.133.241.61"],
};

describe("parseRange", () => {
  it("reads ranges, CIDRs and single addresses", () => {
    expect(parseRange("10.0.0.10-10.0.0.20")).toEqual({ start: 167772170, end: 167772180 });
    expect(parseRange("10.0.0.0/30")).toEqual({ start: 167772160, end: 167772163 });
    expect(parseRange("10.0.0.7")).toEqual({ start: 167772167, end: 167772167 });
  });

  it("rejects malformed input", () => {
    for (const bad of ["10.0.0.20-10.0.0.10", "10.0.0.256", "10.0.0.0/33", "fd00::1", "x"]) {
      expect(parseRange(bad)).toBeNull();
    }
  });
});

describe("MetalLBBody", () => {
  it("needs at least one valid IPv4 range", () => {
    expect(MetalLBBody.safeParse({ addresses: ["10.0.0.200-10.0.0.220"] }).success).toBe(true);
    expect(MetalLBBody.safeParse({ addresses: [] }).success).toBe(false);
    expect(MetalLBBody.safeParse({ addresses: ["fd00::/64"] }).success).toBe(false);
  });
});

describe("suggestRange", () => {
  it("picks the highest free block, away from DHCP, OVN and the broadcast", () => {
    expect(suggestRange(gay)).toEqual({
      range: "10.133.241.235-10.133.241.254",
      subnet: "10.133.241.0/24",
      warning: undefined,
    });
  });

  it("steps below addresses in use", () => {
    const busy = { ...gay, used: [...gay.used, "10.133.241.240"] };
    expect(suggestRange(busy).range).toBe("10.133.241.220-10.133.241.239");
  });

  it("warns when DHCP may lease from the whole subnet", () => {
    expect(suggestRange({ ...gay, reserved: [] }).warning).toMatch(/ipv4.dhcp.ranges/);
  });

  it("gives up on a subnet with no room", () => {
    const tiny = { cidr: "10.0.0.1/28", reserved: ["10.0.0.2-10.0.0.14"], used: [] };
    expect(suggestRange(tiny).range).toBeNull();
  });
});

describe("outsideSubnet", () => {
  it("flags pool addresses the L2 speaker cannot announce", () => {
    expect(
      outsideSubnet(["10.133.241.200-10.133.241.210", "192.168.1.10-192.168.1.20"], gay.cidr),
    ).toEqual(["192.168.1.10-192.168.1.20"]);
  });
});

describe("buildPoolManifest", () => {
  it("declares the agent's pool and its L2 advertisement", () => {
    const list = JSON.parse(buildPoolManifest([" 10.0.0.200-10.0.0.220 "])) as {
      items: { kind: string; metadata: { name: string }; spec: Record<string, unknown> }[];
    };
    expect(list.items.map((i) => i.kind)).toEqual(["IPAddressPool", "L2Advertisement"]);
    expect(list.items[0]?.spec.addresses).toEqual(["10.0.0.200-10.0.0.220"]);
    expect(list.items[1]?.spec.ipAddressPools).toEqual(["incendio"]);
  });
});

describe("loadBalancerServices", () => {
  it("lists LoadBalancer services with their external addresses", () => {
    expect(
      loadBalancerServices({
        items: [
          {
            metadata: { name: "web", namespace: "default" },
            spec: { type: "LoadBalancer", ports: [{ port: 80, protocol: "TCP" }] },
            status: { loadBalancer: { ingress: [{ ip: "10.133.241.235" }] } },
          },
          { metadata: { name: "pending", namespace: "apps" }, spec: { type: "LoadBalancer" } },
          { metadata: { name: "kubernetes", namespace: "default" }, spec: { type: "ClusterIP" } },
        ],
      }),
    ).toEqual([
      { namespace: "default", name: "web", addresses: ["10.133.241.235"], ports: ["80/TCP"] },
      { namespace: "apps", name: "pending", addresses: [], ports: [] },
    ]);
  });
});

describe("overlapping", () => {
  it("finds entries that clash with other clusters' pools", () => {
    expect(
      overlapping(
        ["10.133.241.230-10.133.241.240", "10.133.241.100"],
        ["10.133.241.235-10.133.241.254"],
      ),
    ).toEqual(["10.133.241.230-10.133.241.240"]);
  });

  it("lets suggestRange skip them when passed as reserved", () => {
    const taken = { ...gay, taken: ["10.133.241.235-10.133.241.254"] };
    expect(suggestRange(taken).range).toBe("10.133.241.215-10.133.241.234");
    // Other pools do not count as a DHCP range: the warning still fires.
    expect(suggestRange({ ...taken, reserved: [] }).warning).toMatch(/dhcp/);
  });
});
