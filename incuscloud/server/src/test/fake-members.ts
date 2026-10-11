import { ClusterError } from "../incus/admin-client.ts";

/** One instance on the fake cluster. */
export interface FakeInstance {
  project: string;
  name: string;
  type: "container" | "virtual-machine";
  status: "Running" | "Stopped" | "Frozen";
  location: string;
  memory: number;
  config: Record<string, string>;
}

export interface FakeMember {
  name: string;
  status: "Online" | "Evacuated" | "Offline";
  memoryTotal: number;
  /** Used by the host itself; instances' memory is added on top. */
  memoryBase: number;
  cpus: number;
}

/**
 * A clustered Incus with members, enough for the balancing jobs: the
 * inventory reads, same-cluster moves (`POST /1.0/instances/<n>?target=`),
 * start/stop, and member evacuation and restore. Moving a running instance
 * needs `live` and a VM, as on Incus.
 */
export function fakeMembers(members: FakeMember[], instances: FakeInstance[]) {
  const log: string[] = [];
  const find = (project: string, name: string) => instances.find((i) => i.project === project && i.name === name);
  const used = (m: string) => members.find((x) => x.name === m)!.memoryBase + instances.filter((i) => i.location === m && i.status === "Running").reduce((n, i) => n + i.memory, 0);
  const op = { type: "async" as const, status_code: 202, operation: "/1.0/operations/op", metadata: {} };
  const sync = (metadata: unknown) => ({ type: "sync" as const, status_code: 200, metadata });
  const fake = {
    log,
    members,
    instances,
    /** Runs before a move is applied (tests change the world here). */
    beforeMove: undefined as undefined | ((i: FakeInstance, to: string) => void),
    /** A move of this instance fails. */
    failMove: new Set<string>(),
    async request<T>(method: string, path: string, body?: Record<string, unknown>): Promise<{ type: "sync" | "async"; status_code: number; operation?: string; metadata: T }> {
      const [p, q = ""] = path.split("?");
      const query = new URLSearchParams(q);
      const parts = p!.split("/").map(decodeURIComponent);
      const r = (x: unknown) => x as { type: "sync" | "async"; status_code: number; operation?: string; metadata: T };
      if (method === "GET" && p === "/1.0") return r(sync({ environment: { server_clustered: true, server_name: members[0]!.name } }));
      if (method === "GET" && p === "/1.0/instances" && query.get("recursion") === "2")
        return r(
          sync(
            instances.map((i) => ({
              name: i.name,
              project: i.project,
              type: i.type,
              status: i.status,
              location: i.location,
              description: "",
              architecture: "x86_64",
              created_at: "",
              expanded_config: i.config,
              state: { status: i.status, memory: { usage: i.memory, total: 0 }, cpu: { usage: 0 }, disk: {}, network: {} },
            })),
          ),
        );
      if (method === "GET" && (p === "/1.0/storage-pools" || p === "/1.0/networks")) return r(sync([]));
      if (method === "GET" && p === "/1.0/cluster/members") return r(sync(members.map((m) => ({ server_name: m.name, url: `https://${m.name}:8443`, status: m.status, roles: [], architecture: "x86_64" }))));
      if (method === "GET" && p === "/1.0/resources") {
        const m = members.find((x) => x.name === query.get("target"))!;
        return r(sync({ cpu: { total: m.cpus }, memory: { total: m.memoryTotal, used: used(m.name) } }));
      }
      if (parts[2] === "cluster" && parts[3] === "members" && parts[5] === "state") {
        const m = members.find((x) => x.name === parts[4]);
        if (!m) throw new ClusterError(404, "Cluster: Member not found");
        if (method === "GET") return r(sync({ sysinfo: { load_averages: [0.5] } }));
        const action = body!.action as string;
        log.push(`${action} ${m.name}${body!.mode ? ` ${body!.mode}` : ""}`);
        if (action === "evacuate") {
          const to = members.find((x) => x.name !== m.name && x.status === "Online");
          for (const i of instances.filter((x) => x.location === m.name)) {
            i.config["volatile.evacuate.origin"] = m.name;
            if (to) i.location = to.name;
            if (body!.mode === "stop") i.status = "Stopped";
          }
          m.status = "Evacuated";
        } else {
          for (const i of instances.filter((x) => x.config["volatile.evacuate.origin"] === m.name)) {
            i.location = m.name;
            delete i.config["volatile.evacuate.origin"];
          }
          m.status = "Online";
        }
        return r(op);
      }
      if (parts[2] === "operations") return r(sync({ status: "Success", err: "" }));
      if (parts[2] === "instances" && parts[3]) {
        const project = query.get("project") ?? "default";
        const i = find(project, parts[3]);
        if (!i) throw new ClusterError(404, "Cluster: Instance not found");
        if (method === "GET") return r(sync({ name: i.name, project: i.project, type: i.type, status: i.status, location: i.location, config: i.config, expanded_config: i.config }));
        if (method === "PUT" && parts[4] === "state") {
          log.push(`${body!.action} ${i.name}`);
          i.status = body!.action === "start" ? "Running" : "Stopped";
          return r(op);
        }
        if (method === "POST" && query.get("target")) {
          const to = query.get("target")!;
          fake.beforeMove?.(i, to);
          log.push(`move ${i.name} ${i.location}→${to}${body!.live ? " live" : ""}`);
          if (fake.failMove.has(i.name)) throw new ClusterError(500, `Cluster: moving ${i.name} failed`);
          if (i.status === "Running" && !(body!.live && i.type === "virtual-machine")) throw new ClusterError(400, "Cluster: Instance must be stopped to be moved");
          i.location = to;
          return r(op);
        }
      }
      throw new Error(`fake-members: unexpected ${method} ${path}`);
    },
    async wait() {
      return {};
    },
    async cancel() {},
  };
  return fake;
}
