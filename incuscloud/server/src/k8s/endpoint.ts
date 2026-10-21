import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { clusterMembers, clusters, k8sClusters } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { ClusterError, type IncusAdminClient } from "../incus/admin-client.ts";

/** Where a workload cluster's API is reached: a member's address, a port, and the member that owns the forward. */
export interface Endpoint {
  host: string;
  port: number;
  /** The member the forward and the load balancer live on; "" on a single-member cluster. */
  member: string;
}

/** The forward IncusCloud creates when none exists on the address. */
const FORWARD_DESCRIPTION = "IncusCloud Kubernetes endpoints";
const portDescription = (id: string) => `incuscloud k8s ${id}`;
const API_PORT = "6443";

const hostOf = (url: string) => new URL(url).hostname.replace(/^\[|\]$/g, "");

/**
 * The member a new workload cluster runs on, and its address. On a
 * multi-member cluster the load balancer and every node go on one member
 * (without OVN each member's bridge is its own network): the one asked for,
 * else the online member with the most memory free. On a single-member
 * cluster: "" and the cluster's address.
 */
export async function pickMember(db: Db, clusterId: string, want?: string): Promise<{ host: string; member: string }> {
  const [c] = await db.select({ name: clusters.name, url: clusters.url }).from(clusters).where(eq(clusters.id, clusterId));
  if (!c) throw new ApiError(404, "not_found", "Cluster not found");
  const members = await db.select().from(clusterMembers).where(eq(clusterMembers.clusterId, clusterId));
  let host = hostOf(c.url);
  let member = "";
  if (members.length > 1) {
    const chosen = want
      ? members.find((m) => m.name === want)
      : members.filter((m) => m.status === "Online").sort((a, b) => b.memoryTotal - b.memoryUsed - (a.memoryTotal - a.memoryUsed) || a.name.localeCompare(b.name))[0];
    if (!chosen) throw new ApiError(409, "bad_member", want ? `${c.name} has no member "${want}"` : `${c.name} has no online member`);
    if (chosen.status !== "Online") throw new ApiError(409, "bad_member", `${chosen.name} is ${chosen.status}`);
    if (!chosen.url) throw new ApiError(409, "bad_member", `The address of ${chosen.name} is not known yet`);
    host = hostOf(chosen.url);
    member = chosen.name;
  }
  return { host, member };
}

/** An endpoint for a new workload cluster: its member's address and the lowest port in the range not yet used there. */
export async function pickEndpoint(db: Db, clusterId: string, [low, high]: [number, number], want?: string): Promise<Endpoint> {
  const { host, member } = await pickMember(db, clusterId, want);
  const used = new Set(
    (await db.select({ port: k8sClusters.endpointPort }).from(k8sClusters).where(and(eq(k8sClusters.clusterId, clusterId), eq(k8sClusters.endpointHost, host)))).map((r) => r.port),
  );
  for (let port = low; port <= high; port++) if (!used.has(port)) return { host, port, member };
  throw new ApiError(409, "no_port", `No free port for a Kubernetes API endpoint on ${host} (${low}-${high})`);
}

/** The network the project's default profile attaches its NIC to: where the load balancer gets its address. */
export async function defaultNetwork(client: IncusAdminClient, project: string): Promise<string> {
  const r = await client.request<{ devices: Record<string, Record<string, string>> }>("GET", `/1.0/profiles/default?project=${encodeURIComponent(project)}`);
  const nic = Object.values(r.metadata.devices ?? {}).find((d) => d.type === "nic" && d.network);
  if (!nic) throw new ApiError(409, "no_network", `The default profile of project ${project} has no managed network`);
  return nic.network!;
}

interface InstanceState {
  name: string;
  location: string;
  config: Record<string, string>;
  state?: { network?: Record<string, { addresses: Array<{ family: string; address: string; scope: string }> }> } | null;
}

/** CAPN's load balancer for a workload cluster, found by the keys CAPN sets on it; null until it exists. */
export async function findLb(client: IncusAdminClient, project: string, name: string, namespace: string): Promise<{ name: string; member: string; address: string | null } | null> {
  const r = await client.request<InstanceState[]>("GET", `/1.0/instances?project=${encodeURIComponent(project)}&recursion=2`);
  const lb = r.metadata.find(
    (i) => i.config["user.cluster-name"] === name && i.config["user.cluster-namespace"] === namespace && i.config["user.cluster-role"] === "loadbalancer",
  );
  if (!lb) return null;
  let address: string | null = null;
  for (const [nic, s] of Object.entries(lb.state?.network ?? {})) {
    if (nic === "lo") continue;
    address = s.addresses.find((a) => a.family === "inet" && a.scope === "global")?.address ?? null;
    if (address) break;
  }
  return { name: lb.name, member: lb.location, address };
}

/**
 * Removes a deleted workload cluster's instances CAPN left in the project. A
 * create CAPN gave up on (an image still downloading) keeps running in Incus
 * and lands later, so operations touching the cluster's instances (CAPN
 * names them `<cluster>-…`) are waited for first. Returns the names removed.
 */
export async function removeLeftovers(client: IncusAdminClient, project: string, name: string, namespace: string): Promise<string[]> {
  const q = `project=${encodeURIComponent(project)}`;
  const ops = await client.request<{ running?: Array<{ id: string; resources?: { instances?: string[] } | null }> }>("GET", `/1.0/operations?${q}&recursion=1`);
  const ours = (url: string) => decodeURIComponent(new URL(url, "https://x").pathname.split("/").pop() ?? "").startsWith(`${name}-`);
  for (const op of ops.metadata.running ?? []) {
    if (!(op.resources?.instances ?? []).some(ours)) continue;
    // Its outcome does not matter, only that it is over.
    await client.wait(op.id).catch(() => undefined);
  }
  const r = await client.request<InstanceState[]>("GET", `/1.0/instances?${q}&recursion=1`);
  const left = r.metadata.filter((i) => i.config["user.cluster-name"] === name && i.config["user.cluster-namespace"] === namespace);
  for (const i of left) {
    const path = `/1.0/instances/${encodeURIComponent(i.name)}?${q}`;
    const stop = await client.request("PUT", `/1.0/instances/${encodeURIComponent(i.name)}/state?${q}`, { action: "stop", force: true }).catch(() => null);
    if (stop?.operation) await client.wait(stop.operation).catch(() => undefined);
    const del = await client.request("DELETE", path);
    if (del.operation) await client.wait(del.operation);
  }
  return left.map((i) => i.name);
}

export interface ForwardSpec extends Endpoint {
  network: string;
  /** The load balancer's address. */
  target: string;
  /** The workload cluster's id, which marks our port in a shared forward. */
  id: string;
}

interface Port {
  description: string;
  protocol: string;
  listen_port: string;
  target_port: string;
  target_address: string;
}
interface Forward {
  description: string;
  config: Record<string, string>;
  ports: Port[];
}

// Every call names the member: without ?target= Incus creates a forward on the member serving the request.
const forwardsPath = (f: Pick<ForwardSpec, "network" | "member">, address?: string) =>
  `/1.0/networks/${encodeURIComponent(f.network)}/forwards${address ? `/${encodeURIComponent(address)}` : ""}${f.member ? `?target=${encodeURIComponent(f.member)}` : ""}`;

const getForward = async (client: IncusAdminClient, f: Pick<ForwardSpec, "network" | "member" | "host">): Promise<Forward | null> => {
  try {
    return (await client.request<Forward>("GET", forwardsPath(f, f.host))).metadata;
  } catch (e) {
    if (e instanceof ClusterError && e.clusterStatus === 404) return null;
    throw e;
  }
};

/**
 * Forwards host:port to the load balancer's API port. The forward on the
 * address may be shared (other workload clusters, or the operator's own
 * ports): only the port marked as this cluster's is added or changed.
 */
export async function ensureForward(client: IncusAdminClient, f: ForwardSpec): Promise<"created" | "updated" | "unchanged"> {
  const ours: Port = { description: portDescription(f.id), protocol: "tcp", listen_port: String(f.port), target_port: API_PORT, target_address: f.target };
  const existing = await getForward(client, f);
  if (!existing) {
    await client.request("POST", forwardsPath(f), { listen_address: f.host, description: FORWARD_DESCRIPTION, ports: [ours] });
    return "created";
  }
  const ports = existing.ports ?? [];
  const clash = ports.find((p) => p.listen_port === ours.listen_port && p.description !== ours.description);
  if (clash) throw new ApiError(409, "port_in_use", `Port ${f.port} on ${f.host} is already forwarded (${clash.description || "not by IncusCloud"})`);
  const i = ports.findIndex((p) => p.description === ours.description);
  // Field by field: Incus orders them its own way and adds some (snat).
  const same = (p: Port) => (Object.keys(ours) as Array<keyof Port>).every((k) => String(p[k] ?? "") === String(ours[k]));
  if (i >= 0 && same(ports[i]!)) return "unchanged";
  const next = i >= 0 ? ports.map((p, j) => (j === i ? ours : p)) : [...ports, ours];
  await client.request("PUT", forwardsPath(f, f.host), { description: existing.description, config: existing.config ?? {}, ports: next });
  return "updated";
}

/** Removes this cluster's port; deletes the forward when it was IncusCloud's and nothing is left. Already gone is fine. */
export async function removeForward(client: IncusAdminClient, f: ForwardSpec): Promise<void> {
  const existing = await getForward(client, f);
  if (!existing) return;
  const ports = (existing.ports ?? []).filter((p) => p.description !== portDescription(f.id));
  if (ports.length === (existing.ports ?? []).length) return;
  if (!ports.length && existing.description === FORWARD_DESCRIPTION) {
    await client.request("DELETE", forwardsPath(f, f.host));
    return;
  }
  await client.request("PUT", forwardsPath(f, f.host), { description: existing.description, config: existing.config ?? {}, ports });
}
