import type { Kube, KubeObject } from "./kube.ts";

const keyOf = (apiVersion: string, kind: string, namespace: string | undefined, name: string) => `${apiVersion}|${kind}|${namespace ?? ""}|${name}`;

/** An in-memory management cluster for tests: apply replaces everything but `status`; tests set status themselves. */
export class FakeKube implements Kube {
  readonly objects = new Map<string, KubeObject>();
  readonly applied: KubeObject[] = [];
  readonly deleted: string[] = [];
  /** Throw on every call (an unreachable management cluster). */
  down = false;

  private check() {
    if (this.down) throw new Error("connect ECONNREFUSED (fake management cluster down)");
  }

  async apply(obj: KubeObject): Promise<KubeObject> {
    this.check();
    const k = keyOf(obj.apiVersion, obj.kind, obj.metadata.namespace, obj.metadata.name);
    const prev = this.objects.get(k);
    const next = structuredClone(obj);
    if (prev?.status !== undefined) next.status = prev.status;
    this.objects.set(k, next);
    this.applied.push(structuredClone(obj));
    return structuredClone(next);
  }

  async get(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<KubeObject | null> {
    this.check();
    const o = this.objects.get(keyOf(apiVersion, kind, namespace, name));
    return o ? structuredClone(o) : null;
  }

  async list(apiVersion: string, kind: string, namespace: string | undefined, labelSelector?: string): Promise<KubeObject[]> {
    this.check();
    const want = (labelSelector ?? "")
      .split(",")
      .filter(Boolean)
      .map((p) => p.split("=") as [string, string]);
    return [...this.objects.values()]
      .filter((o) => o.apiVersion === apiVersion && o.kind === kind && (namespace === undefined || o.metadata.namespace === namespace))
      .filter((o) => want.every(([k, v]) => o.metadata.labels?.[k] === v))
      .map((o) => structuredClone(o));
  }

  async delete(apiVersion: string, kind: string, namespace: string | undefined, name: string): Promise<boolean> {
    this.check();
    const k = keyOf(apiVersion, kind, namespace, name);
    this.deleted.push(k);
    return this.objects.delete(k);
  }

  /** Sets an object's status, as a controller would. */
  setStatus(apiVersion: string, kind: string, namespace: string, name: string, status: unknown): void {
    const o = this.objects.get(keyOf(apiVersion, kind, namespace, name));
    if (!o) throw new Error(`FakeKube: no ${kind} ${namespace}/${name}`);
    o.status = status;
  }

  /** Adds an object as a controller would (Machines). */
  put(obj: KubeObject): void {
    this.objects.set(keyOf(obj.apiVersion, obj.kind, obj.metadata.namespace, obj.metadata.name), structuredClone(obj));
  }
}
