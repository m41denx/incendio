import { ClusterError } from "../incus/admin-client.ts";

export type StubInstance = { status: string; type: string; config: Record<string, string> };

/** Backups on the stub: what `POST …/backups` does, and what an export streams. */
export interface StubBackups {
  extensions?: string[];
  /** The backup operation fails with this message. */
  backupFails?: string;
  /** A backup with an S3 `target` fails with this message; otherwise `onDirect` gets the target. */
  directFails?: string;
  onDirect?: (target: Record<string, string>) => Promise<void>;
  exportFails?: string;
  /** The export body; 3 × 100 kB by default. */
  exportStream?: (signal?: AbortSignal) => ReadableStream<Uint8Array>;
}

const fixedExport = () =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(100_000).fill(i + 1));
      c.close();
    },
  });

/**
 * A stub Incus for job handler tests: an instance table, and the calls the
 * handlers make on instances (read, start/stop, full update, delete), each
 * logged as "<label> <action> <name>".
 */
export function stubCluster(label: string, instances: Record<string, StubInstance>, log: string[], b: StubBackups = {}) {
  const asyncOp = { type: "async", status_code: 100, operation: "/1.0/operations/x", metadata: { id: "x", metadata: {} } };
  const ops = new Map<string, { status: string; err: string }>();
  const backups = new Set<string>();
  const newOp = (status: string, err = "") => {
    const id = `op${ops.size + 1}`;
    ops.set(id, { status, err });
    return { type: "async", status_code: 100, operation: `/1.0/operations/${id}`, metadata: { id } };
  };
  return {
    instances,
    backups,
    bodies: [] as unknown[],
    url: `https://${label}:8443`,
    reachable: true,
    async server() {
      return { api_extensions: b.extensions ?? [] };
    },
    async download(path: string, opts: { signal?: AbortSignal } = {}) {
      if (!this.reachable) throw new ClusterError(502, `Cluster: ${label} is unreachable`);
      log.push(`${label} export ${decodeURIComponent(path.split("?")[0]!.split("/")[3] ?? "")}`);
      if (b.exportFails) throw new ClusterError(500, `Cluster: ${b.exportFails}`);
      return (b.exportStream ?? fixedExport)(opts.signal);
    },
    async cancel(op: string) {
      log.push(`${label} cancel ${op}`);
    },
    async request(method: string, path: string, body?: { action?: string; config?: Record<string, string>; name?: string; target?: Record<string, string> }) {
      if (!this.reachable) throw new ClusterError(502, `Cluster: ${label} is unreachable`);
      const parts = path.split("?")[0]!.split("/");
      const name = decodeURIComponent(parts[3] ?? "");
      const inst = instances[name];
      if (parts[2] === "operations" && parts[4] === "wait") return { type: "sync", status_code: 200, metadata: ops.get(parts[3]!) ?? { status: "Success", err: "" } };
      if (parts[2] === "instances" && parts[4] === "backups") {
        if (method === "POST") {
          this.bodies.push(body);
          log.push(`${label} backup ${name}${body!.target ? " direct" : ""}`);
          if (b.backupFails) return newOp("Failure", b.backupFails);
          if (body!.target) {
            if (b.directFails) return newOp("Failure", b.directFails);
            await b.onDirect?.(body!.target);
            // Incus removes its local copy once uploaded.
            return newOp("Success");
          }
          backups.add(body!.name!);
          return newOp("Success");
        }
        if (method === "DELETE") {
          const bn = decodeURIComponent(parts[5] ?? "");
          if (!backups.delete(bn)) throw new ClusterError(404, "Cluster: Backup not found");
          log.push(`${label} delete-backup ${name}`);
          return newOp("Success");
        }
      }
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
