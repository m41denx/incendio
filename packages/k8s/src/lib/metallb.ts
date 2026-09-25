import { z } from "zod";

/**
 * MetalLB for workload clusters: the service load balancer CAPN does not
 * provide (its haproxy only fronts kube-apiserver), so `type: LoadBalancer`
 * services would stay <pending>. L2 mode: the speaker answers ARP for pool
 * addresses on the Incus network the nodes sit on. Pure helpers here; the
 * kubectl side is in metallb-ops.ts.
 */

export const METALLB_NAMESPACE = "metallb-system";
// The pool and advertisement the agent owns (users may add their own).
export const METALLB_POOL = "incendio";

// ---- IPv4 helpers -----------------------------------------------------------

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipToInt(ip: string): number | null {
  const m = IPV4.exec(ip.trim());
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return null;
  return octets.reduce((acc, o) => acc * 256 + o, 0);
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");
}

export interface IpRange {
  start: number;
  end: number;
}

/** "a.b.c.d-e.f.g.h", "a.b.c.d/nn" or a single address, as an inclusive range. */
export function parseRange(value: string): IpRange | null {
  const text = value.trim();
  if (text.includes("-")) {
    const [a = "", b = ""] = text.split("-");
    const start = ipToInt(a);
    const end = ipToInt(b);
    return start !== null && end !== null && start <= end ? { start, end } : null;
  }
  if (text.includes("/")) {
    const [ip = "", bits = ""] = text.split("/");
    const base = ipToInt(ip);
    const prefix = Number(bits);
    if (base === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return null;
    }
    const size = 2 ** (32 - prefix);
    const start = Math.floor(base / size) * size;
    return { start, end: start + size - 1 };
  }
  const single = ipToInt(text);
  return single === null ? null : { start: single, end: single };
}

const overlaps = (a: IpRange, b: IpRange) => a.start <= b.end && b.start <= a.end;

// ---- request ----------------------------------------------------------------

export const MetalLBBody = z.object({
  // Ranges or CIDRs the load balancer hands out, e.g. 10.0.0.200-10.0.0.220.
  addresses: z
    .array(z.string())
    .min(1, "give at least one address range")
    .max(16)
    .refine((list) => list.every((a) => parseRange(a) !== null), {
      message: "addresses must be IPv4 ranges (a.b.c.d-e.f.g.h), CIDRs or single addresses",
    }),
});

export type MetalLBRequest = z.infer<typeof MetalLBBody>;

// ---- manifests --------------------------------------------------------------

/** The agent's IPAddressPool + L2Advertisement, as a kubectl-applyable list. */
export function buildPoolManifest(addresses: string[]): string {
  const meta = { name: METALLB_POOL, namespace: METALLB_NAMESPACE };
  return JSON.stringify({
    apiVersion: "v1",
    kind: "List",
    items: [
      {
        apiVersion: "metallb.io/v1beta1",
        kind: "IPAddressPool",
        metadata: meta,
        spec: { addresses: addresses.map((a) => a.trim()) },
      },
      {
        apiVersion: "metallb.io/v1beta1",
        kind: "L2Advertisement",
        metadata: meta,
        spec: { ipAddressPools: [METALLB_POOL] },
      },
    ],
  });
}

// ---- address suggestion -----------------------------------------------------

export interface NetworkFacts {
  /** ipv4.address, e.g. 10.133.241.1/24 (gateway/prefix). */
  cidr: string;
  /** ipv4.dhcp.ranges and ipv4.ovn.ranges, comma separated. */
  reserved: string[];
  /** Addresses already leased or assigned on the network. */
  used: string[];
  /** Other clusters' MetalLB pools (not leases, so the network cannot tell). */
  taken?: string[];
}

export interface Suggestion {
  /** Proposed range, or null when no free block of that size exists. */
  range: string | null;
  subnet: string;
  /** Why the range may still collide (e.g. DHCP serving the whole subnet). */
  warning?: string;
}

/**
 * The highest free block of `size` addresses in the network's subnet that
 * avoids the gateway, broadcast, DHCP / OVN ranges and addresses in use.
 * High addresses because Incus hands out DHCP leases from the bottom.
 */
export function suggestRange(facts: NetworkFacts, size = 20): Suggestion {
  const subnetRange = parseRange(facts.cidr);
  const gateway = ipToInt(facts.cidr.split("/")[0] ?? "");
  if (!subnetRange || gateway === null) {
    return { range: null, subnet: facts.cidr, warning: "the network has no IPv4 subnet" };
  }
  const subnet = `${intToIp(subnetRange.start)}/${facts.cidr.split("/")[1] ?? "32"}`;
  const blocked: IpRange[] = [
    { start: subnetRange.start, end: subnetRange.start },
    { start: subnetRange.end, end: subnetRange.end },
    { start: gateway, end: gateway },
  ];
  const dhcp = facts.reserved.flatMap((r) =>
    r
      .split(",")
      .map((part) => parseRange(part))
      .filter((x): x is IpRange => x !== null),
  );
  blocked.push(...dhcp);
  for (const pool of facts.taken ?? []) {
    const r = parseRange(pool);
    if (r) blocked.push(r);
  }
  for (const ip of facts.used) {
    const n = ipToInt(ip);
    if (n !== null) blocked.push({ start: n, end: n });
  }

  for (let end = subnetRange.end - 1; end - size + 1 > subnetRange.start; end--) {
    const candidate = { start: end - size + 1, end };
    const hit = blocked.find((b) => overlaps(b, candidate));
    if (!hit) {
      return {
        range: `${intToIp(candidate.start)}-${intToIp(candidate.end)}`,
        subnet,
        warning:
          dhcp.length === 0
            ? "the network has no ipv4.dhcp.ranges, so its DHCP server may lease these addresses too; restrict ipv4.dhcp.ranges to keep them apart"
            : undefined,
      };
    }
    end = Math.min(end, hit.start); // jump below the obstacle
  }
  return { range: null, subnet, warning: `no free block of ${String(size)} addresses in ${subnet}` };
}

/** Entries of `addresses` that overlap any of `taken` (other clusters' pools). */
export function overlapping(addresses: string[], taken: string[]): string[] {
  const takenRanges = taken
    .map((t) => parseRange(t))
    .filter((r): r is IpRange => r !== null);
  return addresses.filter((a) => {
    const r = parseRange(a);
    return r !== null && takenRanges.some((t) => overlaps(r, t));
  });
}

/** Pool addresses that fall outside the network's subnet (unreachable in L2). */
export function outsideSubnet(addresses: string[], cidr: string): string[] {
  const subnet = parseRange(cidr);
  if (!subnet) return [];
  return addresses.filter((a) => {
    const r = parseRange(a);
    return !r || r.start < subnet.start || r.end > subnet.end;
  });
}

// ---- status -----------------------------------------------------------------

export interface LoadBalancerService {
  namespace: string;
  name: string;
  /** Assigned external addresses; empty while pending. */
  addresses: string[];
  ports: string[];
}

interface ServiceItem {
  metadata?: { name?: string; namespace?: string };
  spec?: { type?: string; ports?: { port?: number; protocol?: string }[] };
  status?: { loadBalancer?: { ingress?: { ip?: string; hostname?: string }[] } };
}

/** `kubectl get services -A -o json` → the LoadBalancer services. */
export function loadBalancerServices(list: { items?: ServiceItem[] }): LoadBalancerService[] {
  return (list.items ?? [])
    .filter((s) => s.spec?.type === "LoadBalancer")
    .map((s) => ({
      namespace: s.metadata?.namespace ?? "",
      name: s.metadata?.name ?? "",
      addresses: (s.status?.loadBalancer?.ingress ?? [])
        .map((i) => i.ip ?? i.hostname ?? "")
        .filter(Boolean),
      ports: (s.spec?.ports ?? []).map(
        (p) => `${String(p.port ?? "?")}/${p.protocol ?? "TCP"}`,
      ),
    }));
}
