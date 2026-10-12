import { readFileSync } from "node:fs";

/** A Kubernetes object as the API returns it. */
export interface KubeObject {
  apiVersion: string;
  kind: string;
  metadata: { name: string; namespace?: string; labels?: Record<string, string>; annotations?: Record<string, string>; [k: string]: unknown };
  [k: string]: unknown;
}

/** What IncusCloud does with the management cluster (P10); `FakeKube` in tests. */
export interface Kube {
  /** Server-side apply as field manager `incuscloud`, forced. */
  apply(obj: KubeObject): Promise<KubeObject>;
  get(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<KubeObject | null>;
  list(apiVersion: string, kind: string, namespace: string | undefined, labelSelector?: string): Promise<KubeObject[]>;
  /** False when it was already gone. */
  delete(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<boolean>;
}

export class KubeError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Kubernetes API: ${message}`);
  }
}

/** How to reach the management cluster: from a kubeconfig's current context. */
export interface KubeAccess {
  server: string;
  ca?: string;
  cert?: string;
  key?: string;
  token?: string;
}

type Named<T> = { name: string } & T;
interface Kubeconfig {
  "current-context"?: string;
  clusters?: Named<{ cluster: { server: string; "certificate-authority-data"?: string } }>[];
  contexts?: Named<{ context: { cluster: string; user: string } }>[];
  users?: Named<{ user: { "client-certificate-data"?: string; "client-key-data"?: string; token?: string } }>[];
}

const b64 = (s?: string) => (s ? Buffer.from(s, "base64").toString("utf8") : undefined);

/** The current context of a kubeconfig; only inline (`*-data`) credentials. */
export function parseKubeconfig(text: string): KubeAccess {
  const k = (Bun.YAML.parse(text) ?? {}) as Kubeconfig;
  const name = k["current-context"];
  const ctx = k.contexts?.find((c) => c.name === name)?.context;
  if (!ctx) throw new Error(`kubeconfig: context "${name}" not found`);
  const cluster = k.clusters?.find((c) => c.name === ctx.cluster)?.cluster;
  if (!cluster) throw new Error(`kubeconfig: cluster "${ctx.cluster}" not found`);
  const user = k.users?.find((u) => u.name === ctx.user)?.user ?? {};
  const access: KubeAccess = { server: cluster.server.replace(/\/$/, "") };
  const ca = b64(cluster["certificate-authority-data"]);
  const cert = b64(user["client-certificate-data"]);
  const key = b64(user["client-key-data"]);
  if (ca) access.ca = ca;
  if (cert) access.cert = cert;
  if (key) access.key = key;
  if (user.token) access.token = user.token;
  return access;
}

const CLUSTER_SCOPED = new Set(["Namespace"]);

/** The REST path of a kind (and object): core `/api/v1`, groups `/apis/<group>/<version>`. */
export function resourcePath(apiVersion: string, kind: string, namespace?: string, name?: string): string {
  const base = apiVersion.includes("/") ? `/apis/${apiVersion}` : `/api/${apiVersion}`;
  const lower = kind.toLowerCase();
  const plural = lower.endsWith("s") ? `${lower}es` : `${lower}s`;
  const ns = !CLUSTER_SCOPED.has(kind) && namespace ? `/namespaces/${encodeURIComponent(namespace)}` : "";
  return `${base}${ns}/${plural}${name ? `/${encodeURIComponent(name)}` : ""}`;
}

/** The management cluster's API over HTTPS, with the kubeconfig's CA and client certificate or token. */
export class KubeClient implements Kube {
  constructor(private readonly access: KubeAccess) {}

  static fromFile(path: string): KubeClient {
    return new KubeClient(parseKubeconfig(readFileSync(path, "utf8")));
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
    const { server, ca, cert, key, token } = this.access;
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/apply-patch+yaml";
    const r = await fetch(`${server}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      tls: ca || cert ? { ca, cert, key } : undefined,
      signal: AbortSignal.timeout(30_000),
    } as RequestInit);
    const text = await r.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    if (r.status >= 400 && r.status !== 404) throw new KubeError(r.status, (parsed as { message?: string })?.message ?? `HTTP ${r.status}`);
    return { status: r.status, body: parsed as T };
  }

  async apply(obj: KubeObject): Promise<KubeObject> {
    const path = `${resourcePath(obj.apiVersion, obj.kind, obj.metadata.namespace, obj.metadata.name)}?fieldManager=incuscloud&force=true`;
    const r = await this.call<KubeObject>("PATCH", path, obj);
    if (r.status === 404) throw new KubeError(404, `${obj.kind} ${obj.metadata.name}: not found (is the API installed?)`);
    return r.body;
  }

  async get(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<KubeObject | null> {
    const r = await this.call<KubeObject>("GET", resourcePath(apiVersion, kind, namespace, name));
    return r.status === 404 ? null : r.body;
  }

  async list(apiVersion: string, kind: string, namespace: string | undefined, labelSelector?: string): Promise<KubeObject[]> {
    const q = labelSelector ? `?labelSelector=${encodeURIComponent(labelSelector)}` : "";
    const r = await this.call<{ items: KubeObject[] }>("GET", `${resourcePath(apiVersion, kind, namespace)}${q}`);
    return r.status === 404 ? [] : r.body.items;
  }

  async delete(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<boolean> {
    const r = await this.call("DELETE", resourcePath(apiVersion, kind, namespace, name));
    return r.status !== 404;
  }
}
