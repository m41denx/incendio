/** Just enough of an Incus server's API for the facade's tests, behind FakeIncus.respond. */
export interface IncusModel {
  clustered: boolean;
  extensions: string[];
  members: string[];
  projects: string[];
  pools: string[];
  instances: Array<{ name: string; project: string; location: string }>;
  /** Every request, bodies parsed. */
  seen: Array<{ method: string; url: string; body?: unknown }>;
  /** How `/1.0` answers instead: as to a caller it does not trust, or an error. */
  server?: "untrusted" | "error";
}

const sync = (metadata: unknown) => ({ body: { type: "sync", status: "Success", status_code: 200, metadata } });
const fail = (status: number, error: string) => ({ status, body: { type: "error", error_code: status, error } });

export function fakeIncusApi(m: IncusModel) {
  let ops = 0;
  return (r: { method: string; url: string; body: string; headers: Record<string, unknown> }) => {
    m.seen.push({ method: r.method, url: r.url, ...(r.body ? { body: JSON.parse(r.body) } : {}) });
    const u = new URL(r.url, "https://x");
    const path = u.pathname;
    const project = u.searchParams.get("project") ?? "default";
    const recursion = u.searchParams.get("recursion");
    if (r.method === "GET" && path === "/1.0") {
      if (m.server === "error") return fail(500, "down");
      if (m.server === "untrusted") return sync({ auth: "untrusted", api_extensions: [], config: {} });
      return sync({
        auth: r.headers.authorization ? "trusted" : "untrusted",
        api_extensions: m.extensions,
        config: { "core.https_address": ":8443" },
        environment: { server_clustered: m.clustered, server_name: m.clustered ? m.members[0] : "standalone", server_version: "7.5", kernel_architecture: "x86_64" },
      });
    }
    if (r.method === "GET" && path === "/1.0/projects") {
      return sync(recursion ? m.projects.map((name) => ({ name, config: { "features.images": "true" }, used_by: [] })) : m.projects.map((n) => `/1.0/projects/${n}`));
    }
    const p = path.match(/^\/1\.0\/projects\/([^/]+)$/);
    if (r.method === "GET" && p) return m.projects.includes(p[1]!) ? sync({ name: p[1], config: {}, used_by: [] }) : fail(404, "Project not found");
    if (r.method === "GET" && path === "/1.0/instances") {
      if (!m.projects.includes(project)) return fail(404, "Project not found");
      return sync(m.instances.filter((i) => i.project === project).map((i) => ({ ...i, status: "Running" })));
    }
    if (r.method === "GET" && path.endsWith("/files")) return { body: `${path.split("/")[3]}@c1 is not rewritten\n`, type: "application/octet-stream" };
    if (r.method === "GET" && path === "/1.0/warnings") return sync([{ uuid: `w-${m.members[0] ?? "standalone"}`, type: "test", project: "", location: m.members[0] ?? "" }]);
    if (r.method === "GET" && path === "/1.0/storage-pools") return sync(m.pools.map((name) => ({ name, driver: "dir", locations: m.clustered ? m.members : ["none"] })));
    if (r.method === "GET" && path === "/1.0/cluster/members") {
      if (!m.clustered) return fail(500, "Server isn't part of a cluster");
      return sync(m.members.map((server_name) => ({ server_name, status: "Online", roles: [], groups: ["default"] })));
    }
    const op = path.match(/^\/1\.0\/operations\/([^/]+)(\/wait)?$/);
    if (r.method === "GET" && op) return sync({ id: op[1], status_code: 200, resources: {} });
    if (r.method !== "GET") {
      const id = `op-${++ops}`;
      return { status: 202, body: { type: "async", status: "Operation created", status_code: 100, operation: `/1.0/operations/${id}`, metadata: { id, class: "task", status_code: 103, resources: {} } } };
    }
    return fail(404, "not found");
  };
}
