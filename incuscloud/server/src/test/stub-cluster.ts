import { ClusterError } from "../incus/admin-client.ts";

export type StubInstance = { status: string; type: string; config: Record<string, string> };

/**
 * A stub Incus for job handler tests: an instance table, and the calls the
 * handlers make on instances (read, start/stop, full update, delete), each
 * logged as "<label> <action> <name>".
 */
export function stubCluster(label: string, instances: Record<string, StubInstance>, log: string[]) {
  const asyncOp = { type: "async", status_code: 100, operation: "/1.0/operations/x", metadata: { id: "x", metadata: {} } };
  return {
    instances,
    url: `https://${label}:8443`,
    reachable: true,
    async request(method: string, path: string, body?: { action?: string; config?: Record<string, string> }) {
      if (!this.reachable) throw new ClusterError(502, `Cluster: ${label} is unreachable`);
      const name = decodeURIComponent(path.split("?")[0]!.split("/")[3] ?? "");
      const inst = instances[name];
      if (method === "GET" && path.startsWith("/1.0/instances/")) {
        if (!inst) throw new ClusterError(404, "Cluster: Instance not found");
        return { type: "sync", status_code: 200, metadata: { name, ...inst } };
      }
      if (method === "PUT" && path.includes("/state")) {
        log.push(`${label} ${body!.action} ${name}`);
        inst!.status = body!.action === "start" ? "Running" : "Stopped";
        return asyncOp;
      }
      if (method === "PUT") {
        log.push(`${label} update ${name}`);
        inst!.config = body!.config ?? {};
        return asyncOp;
      }
      if (method === "DELETE") {
        log.push(`${label} delete ${name}`);
        delete instances[name];
        return asyncOp;
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
    async wait() {
      return {};
    },
  };
}
