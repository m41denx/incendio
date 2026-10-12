import { ClusterError, type IncusAdminClient } from "../incus/admin-client.ts";

interface Forward {
  network: string;
  listen_address: string;
  description: string;
  config: Record<string, string>;
  ports: Array<{ description: string; protocol: string; listen_port: string; target_port: string; target_address: string }>;
  /** The member it was created on (`?target=`), "" when not given. */
  location: string;
}

/** An Incus cluster in memory for the Kubernetes tests: trust store, network forwards, instances, the default profile, members. */
export class FakeCluster {
  certificates = new Map<string, { name: string; type: string; restricted: boolean; projects: string[]; certificate: string }>();
  forwards = new Map<string, Forward>();
  instances: Array<{ name: string; project: string; location: string; config: Record<string, string>; state?: { network?: Record<string, { addresses: Array<{ family: string; address: string; scope: string }> }> } }> = [];
  members: Array<{ server_name: string; url: string; status: string }> = [{ server_name: "m1", url: "https://10.0.0.5:8443", status: "Online" }];
  profileNetwork = "incusbr0";
  calls: Array<{ method: string; path: string; body?: unknown }> = [];
  /** Fingerprint → computed by the test (the fake does not parse certificates). */
  fingerprintOf: (certificate: string) => string = (c) => `fp-${c.length}`;

  get client(): IncusAdminClient {
    return { request: (m: string, p: string, b?: unknown) => this.request(m, p, b) } as unknown as IncusAdminClient;
  }

  private ok(metadata: unknown) {
    return { type: "sync", status: "Success", status_code: 200, metadata };
  }

  async request(method: string, path: string, body?: unknown) {
    this.calls.push({ method, path, body });
    const u = new URL(path, "https://x");
    const project = u.searchParams.get("project") ?? "default";
    const p = u.pathname;
    if (p === "/1.0/certificates" && method === "POST") {
      const b = body as { name: string; type: string; restricted: boolean; projects: string[]; certificate: string };
      const fp = this.fingerprintOf(b.certificate);
      if (this.certificates.has(fp)) throw new ClusterError(409, "Certificate already in trust store");
      this.certificates.set(fp, b);
      return this.ok({});
    }
    const cert = /^\/1\.0\/certificates\/([^/]+)$/.exec(p);
    if (cert && method === "DELETE") {
      if (!this.certificates.delete(cert[1]!)) throw new ClusterError(404, "Certificate not found");
      return this.ok({});
    }
    if (p === "/1.0/cluster/members" && method === "GET") return this.ok(this.members);
    const prof = /^\/1\.0\/profiles\/default$/.exec(p);
    if (prof && method === "GET") return this.ok({ name: "default", devices: { eth0: { type: "nic", name: "eth0", network: this.profileNetwork }, root: { type: "disk", path: "/", pool: "local" } } });
    if (p === "/1.0/instances" && method === "GET") return this.ok(this.instances.filter((i) => i.project === project));
    const fwds = /^\/1\.0\/networks\/([^/]+)\/forwards$/.exec(p);
    if (fwds && method === "POST") {
      const b = body as Omit<Forward, "network" | "location">;
      const key = `${fwds[1]}|${b.listen_address}`;
      if (this.forwards.has(key)) throw new ClusterError(409, "A network forward for that listen address already exists");
      this.forwards.set(key, { network: fwds[1]!, location: u.searchParams.get("target") ?? "", description: b.description ?? "", config: b.config ?? {}, ports: b.ports ?? [], listen_address: b.listen_address });
      return this.ok({});
    }
    const fwd = /^\/1\.0\/networks\/([^/]+)\/forwards\/([^/]+)$/.exec(p);
    if (fwd) {
      const key = `${fwd[1]}|${decodeURIComponent(fwd[2]!)}`;
      const f = this.forwards.get(key);
      if (!f) throw new ClusterError(404, "Network forward not found");
      if (method === "GET") return this.ok(structuredClone(f));
      if (method === "PUT") {
        const b = body as Partial<Forward>;
        Object.assign(f, { description: b.description ?? "", config: b.config ?? {}, ports: b.ports ?? [] });
        return this.ok({});
      }
      if (method === "DELETE") {
        this.forwards.delete(key);
        return this.ok({});
      }
    }
    throw new ClusterError(404, `FakeCluster: no ${method} ${path}`);
  }
}
