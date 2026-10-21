import { afterAll, expect, test } from "bun:test";
import { KubeClient, KubeError, parseKubeconfig, resourcePath } from "./kube.ts";

const kubeconfig = (server: string) => `apiVersion: v1
kind: Config
current-context: mgmt
clusters:
- name: other
  cluster: {server: https://wrong.example:6443}
- name: k3s
  cluster:
    server: ${server}
    certificate-authority-data: ${btoa("CA PEM")}
contexts:
- name: mgmt
  context: {cluster: k3s, user: admin}
users:
- name: admin
  user:
    client-certificate-data: ${btoa("CERT PEM")}
    client-key-data: ${btoa("KEY PEM")}
`;

test("parseKubeconfig takes the current context's cluster and user, decoding inline data", () => {
  expect(parseKubeconfig(kubeconfig("https://10.0.0.1:6443"))).toEqual({ server: "https://10.0.0.1:6443", ca: "CA PEM", cert: "CERT PEM", key: "KEY PEM" });
  const token = parseKubeconfig(`current-context: c
clusters: [{name: x, cluster: {server: "https://k:6443/"}}]
contexts: [{name: c, context: {cluster: x, user: u}}]
users: [{name: u, user: {token: abc}}]`);
  expect(token).toEqual({ server: "https://k:6443", token: "abc" });
  expect(() => parseKubeconfig("current-context: nope\ncontexts: []")).toThrow(/context "nope"/);
});

test("resource paths: core and group APIs, plurals, cluster-scoped namespaces", () => {
  expect(resourcePath("v1", "Secret", "ic-acme", "s1")).toBe("/api/v1/namespaces/ic-acme/secrets/s1");
  expect(resourcePath("v1", "Namespace", undefined, "ic-acme")).toBe("/api/v1/namespaces/ic-acme");
  expect(resourcePath("cluster.x-k8s.io/v1beta2", "Cluster", "ic-acme")).toBe("/apis/cluster.x-k8s.io/v1beta2/namespaces/ic-acme/clusters");
  expect(resourcePath("cluster.x-k8s.io/v1beta2", "ClusterClass", "incuscloud-system", "incuscloud-v1")).toBe(
    "/apis/cluster.x-k8s.io/v1beta2/namespaces/incuscloud-system/clusterclasses/incuscloud-v1",
  );
  expect(resourcePath("infrastructure.cluster.x-k8s.io/v1alpha2", "LXCMachineTemplate", "n", "t")).toBe(
    "/apis/infrastructure.cluster.x-k8s.io/v1alpha2/namespaces/n/lxcmachinetemplates/t",
  );
});

// A fake API server: records requests, answers from a table.
const seen: Array<{ method: string; path: string; type: string | null; auth: string | null; body: string }> = [];
const answers = new Map<string, [number, unknown]>();
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    seen.push({ method: req.method, path: u.pathname + u.search, type: req.headers.get("content-type"), auth: req.headers.get("authorization"), body: await req.text() });
    const [status, body] = answers.get(`${req.method} ${u.pathname}`) ?? [404, { kind: "Status", status: "Failure", reason: "NotFound", message: "not found" }];
    return Response.json(body, { status });
  },
});
afterAll(() => server.stop(true));
const client = () => new KubeClient({ server: server.url.origin, token: "t0k" });

test("apply is a forced server-side apply as incuscloud, with the object as the body", async () => {
  seen.length = 0;
  const obj = { apiVersion: "v1", kind: "Namespace", metadata: { name: "ic-acme" } };
  answers.set("PATCH /api/v1/namespaces/ic-acme", [200, { ...obj, status: { phase: "Active" } }]);
  expect(await client().apply(obj)).toMatchObject({ status: { phase: "Active" } });
  expect(seen[0]).toMatchObject({ method: "PATCH", path: "/api/v1/namespaces/ic-acme?fieldManager=incuscloud&force=true", type: "application/apply-patch+yaml" });
  expect(JSON.parse(seen[0]!.body)).toEqual(obj);
});

test("get returns the object or null on 404; list returns items, with a label selector", async () => {
  answers.set("GET /api/v1/namespaces/n/secrets/s", [200, { kind: "Secret", metadata: { name: "s" } }]);
  expect(await client().get("v1", "Secret", "n", "s")).toMatchObject({ metadata: { name: "s" } });
  expect(await client().get("v1", "Secret", "n", "missing")).toBeNull();
  seen.length = 0;
  answers.set("GET /apis/cluster.x-k8s.io/v1beta2/namespaces/n/machines", [200, { items: [{ metadata: { name: "m1" } }] }]);
  expect(await client().list("cluster.x-k8s.io/v1beta2", "Machine", "n", "cluster.x-k8s.io/cluster-name=k1")).toEqual([{ metadata: { name: "m1" } }] as never);
  expect(seen[0]!.path).toBe("/apis/cluster.x-k8s.io/v1beta2/namespaces/n/machines?labelSelector=cluster.x-k8s.io%2Fcluster-name%3Dk1");
});

test("delete is true when deleted, false when already gone", async () => {
  answers.set("DELETE /api/v1/namespaces/n/secrets/s", [200, { kind: "Status", status: "Success" }]);
  expect(await client().delete("v1", "Secret", "n", "s")).toBe(true);
  expect(await client().delete("v1", "Secret", "n", "gone")).toBe(false);
});

test("errors carry the API's status and message; the bearer token is sent", async () => {
  seen.length = 0;
  answers.set("PATCH /api/v1/namespaces/bad", [422, { kind: "Status", status: "Failure", reason: "Invalid", message: "metadata.name: Invalid value" }]);
  const e = await client().apply({ apiVersion: "v1", kind: "Namespace", metadata: { name: "bad" } }).catch((x) => x);
  expect(e).toBeInstanceOf(KubeError);
  expect(e.status).toBe(422);
  expect(e.message).toBe("Kubernetes API: metadata.name: Invalid value");
  expect(seen[0]!.auth).toBe("Bearer t0k");
});
