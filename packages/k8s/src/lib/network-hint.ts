import { incusClient } from "./incus.ts";
import { resolveWorkloadResources } from "./projects.ts";
import { suggestRange, type Suggestion } from "./metallb.ts";

/**
 * Which Incus network a cluster's nodes (and so MetalLB's L2 addresses) live
 * on, and a free address block on it. An existing cluster's network is its
 * project's default-profile NIC; a new cluster gets the one create would pick.
 */

interface Profile {
  devices?: Record<string, { type?: string; network?: string }>;
}

async function clusterNetwork(project: string | null): Promise<string> {
  if (project) {
    const { data } = await incusClient().get(
      `/1.0/profiles/default?project=${encodeURIComponent(project)}`,
    );
    const nic = Object.values((data?.metadata as Profile)?.devices ?? {}).find(
      (d) => d.type === "nic" && d.network,
    );
    if (nic?.network) return nic.network;
  }
  return (await resolveWorkloadResources()).network;
}

/** IPv4 addresses leased or assigned on `network`, across every project. */
async function usedAddresses(network: string): Promise<string[]> {
  const client = incusClient();
  const { data } = await client.get("/1.0/projects");
  const projects = ((data?.metadata ?? []) as string[]).map(
    (url) => url.split("/").pop() ?? "",
  );
  // The leases API only answers for one project at a time.
  const lists = await Promise.all(
    projects.map(async (project) => {
      try {
        const res = await client.get(
          `/1.0/networks/${encodeURIComponent(network)}/leases?project=${encodeURIComponent(decodeURIComponent(project))}`,
        );
        return ((res.data?.metadata ?? []) as { address?: string }[])
          .map((l) => l.address ?? "")
          .filter((a) => a.includes("."));
      } catch {
        return [];
      }
    }),
  );
  return [...new Set(lists.flat())];
}

export interface NetworkHint extends Suggestion {
  network: string;
  /** ipv4.address of the network (gateway/prefix). */
  cidr: string;
}

/** What `suggestRange` needs to know about `network`, read from Incus. */
async function networkFacts(network: string): Promise<{ cidr: string; reserved: string[]; used: string[] }> {
  const { data } = await incusClient().get(`/1.0/networks/${encodeURIComponent(network)}`);
  const config = (data?.metadata?.config ?? {}) as Record<string, string>;
  return {
    cidr: config["ipv4.address"] ?? "",
    reserved: [config["ipv4.dhcp.ranges"], config["ipv4.ovn.ranges"]].filter(
      (r): r is string => !!r,
    ),
    used: await usedAddresses(network),
  };
}

/**
 * `taken`: other clusters' MetalLB pools and API endpoints. They are not DHCP
 * leases, so the network knows nothing about them; the agent does.
 */
export async function metallbNetworkHint(
  project: string | null,
  taken: string[] = [],
): Promise<NetworkHint> {
  const network = await clusterNetwork(project);
  const facts = await networkFacts(network);
  return { network, cidr: facts.cidr, ...suggestRange({ ...facts, taken }) };
}

/**
 * A free IPv4 on `network` for a new cluster's API endpoint (the highest one
 * outside the DHCP/OVN ranges, leases and `taken`), or null when the network
 * has no IPv4 subnet or no free address.
 */
export async function pickEndpointAddress(
  network: string,
  taken: string[],
): Promise<string | null> {
  const suggestion = suggestRange({ ...(await networkFacts(network)), taken }, 1);
  return suggestion.range?.split("-")[0] ?? null;
}
