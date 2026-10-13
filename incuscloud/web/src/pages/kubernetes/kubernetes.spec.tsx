import { afterEach, expect, test, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { me, mockApi, renderAt } from "../../test/api";
import type { K8sCluster, K8sOptions, Me } from "../../api/types";
import { k8sSpec } from "./fixtures";
import KubernetesList from "./KubernetesList";
import CreateKubernetes from "./CreateKubernetes";
import KubernetesDetail from "./KubernetesDetail";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const options = (enabled = true): K8sOptions => ({
  enabled,
  versions: ["v1.34.0", "v1.35.5", "v1.36.4", "v1.37.0"],
  sizes: { small: { cpu: 2, memoryGiB: 2 }, medium: { cpu: 2, memoryGiB: 4 }, large: { cpu: 4, memoryGiB: 8 } },
});

const k8s = (over: Partial<K8sCluster> = {}): K8sCluster => ({
  id: "k-1",
  tenantId: "t-1",
  tenantSlug: "acme",
  clusterId: "c-1",
  clusterName: "lab",
  project: "acme",
  member: "",
  name: "web",
  version: "v1.36.4",
  controlPlanes: 1,
  workers: 2,
  size: "small",
  spec: k8sSpec(),
  endpoint: "https://10.0.0.5:16443",
  status: "ready",
  statusMessage: "",
  nodes: 3,
  nodesReady: 3,
  createdBy: "u-1",
  createdAt: "2026-10-12T10:00:00Z",
  syncedAt: "2026-10-12T10:05:00Z",
  ...over,
});

const memberOf = (role: "owner" | "admin" | "member" | "viewer"): Me => me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role }] });

/** Shows where the app navigated. */
const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

test("the list shows each cluster with its status, version, nodes, endpoint, tenant and Incus cluster", async () => {
  mockApi({
    "GET /api/v1/me": [200, memberOf("member")],
    "GET /api/v1/kubernetes/versions": [200, options()],
    "GET /api/v1/kubernetes": [200, [k8s(), k8s({ id: "k-2", name: "api", status: "degraded", statusMessage: "1 of 2 nodes ready", nodesReady: 1, nodes: 2, workers: 1 })]],
  });
  renderAt(<KubernetesList />);
  const web = (await screen.findByRole("link", { name: "web" })).closest("tr")!;
  expect(within(web).getByRole("link", { name: "web" })).toHaveAttribute("href", "/ui/project/acme%40lab/kubernetes/web");
  expect(within(web).getByText("Ready")).toBeInTheDocument();
  expect(within(web).getByText("v1.36.4")).toBeInTheDocument();
  expect(within(web).getByText("3/3")).toBeInTheDocument();
  expect(within(web).getByText("10.0.0.5:16443")).toBeInTheDocument();
  expect(within(web).getByRole("link", { name: "acme" })).toHaveAttribute("href", "/tenants/t-1");
  expect(within(web).getByRole("link", { name: "lab" })).toHaveAttribute("href", "/inventory/lab");
  const api = screen.getByRole("link", { name: "api" }).closest("tr")!;
  expect(within(api).getByText("Degraded")).toBeInTheDocument();
  expect(within(api).getByText("1 of 2 nodes ready")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Create cluster" })).toHaveAttribute("href", "/kubernetes/new");
});

test("without a management cluster the list says so and offers no create", async () => {
  const api = mockApi({ "GET /api/v1/me": [200, memberOf("owner")], "GET /api/v1/kubernetes/versions": [200, options(false)] });
  renderAt(<KubernetesList />);
  expect(await screen.findByText("Kubernetes is not enabled")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Create cluster" })).toBeNull();
  expect(api.calls.some((c) => c.path === "/api/v1/kubernetes")).toBe(false);
});

test("viewers see the list without the create button; an empty list says how to start", async () => {
  mockApi({ "GET /api/v1/me": [200, memberOf("viewer")], "GET /api/v1/kubernetes/versions": [200, options()], "GET /api/v1/kubernetes": [200, []] });
  renderAt(<KubernetesList />);
  expect(await screen.findByText("No Kubernetes clusters")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Create cluster" })).toBeNull();
});

test("create: a ready placement, a name and a shape, with what it takes from the quota; then its page", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, memberOf("member")],
    "GET /api/v1/kubernetes/versions": [200, options()],
    "GET /api/v1/tenants/t-1/placements": [
      200,
      [
        { clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
        { clusterId: "c-2", clusterName: "edge", project: "acme", status: "pending", statusMessage: "", createdAt: "" },
      ],
    ],
    "POST /api/v1/kubernetes": [202, { cluster: k8s({ id: "k-9", status: "creating" }), job: { id: "j-1" } }],
    "GET /1.0/cluster/members": [200, { type: "sync", metadata: [{ server_name: "lab@lab", status: "Online" }] }],
  });
  renderAt(
    <Routes>
      <Route path="/kubernetes/new" element={<CreateKubernetes />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { path: "/kubernetes/new" },
  );
  const cluster = await screen.findByLabelText("Incus cluster");
  expect((await within(cluster).findAllByRole("option")).map((o) => o.textContent)).toEqual(["lab"]);
  expect(screen.getByLabelText("Kubernetes version")).toHaveValue("v1.37.0");
  // A single-member Incus cluster: nothing to choose.
  expect(screen.queryByLabelText("Member")).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "web");
  // The form's sections, as Incendio's: the shape of the nodes is the next one.
  await userEvent.click(within(screen.getByRole("navigation", { name: "Kubernetes form navigation" })).getByText("Nodes"));
  await userEvent.selectOptions(screen.getByLabelText("Control plane nodes"), "3");
  await userEvent.clear(screen.getByLabelText("Worker nodes"));
  await userEvent.type(screen.getByLabelText("Worker nodes"), "2");
  await userEvent.selectOptions(screen.getByLabelText("Node size"), "medium");
  // 5 nodes of 2 CPUs and 4 GiB, and a load balancer of 1 and 1.
  expect(screen.getByText("Uses 6 instances, 11 CPUs, 21 GiB of memory and 60 GiB of disk of the tenant's quota, with its load balancer.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/ui/project/acme%40lab/kubernetes/web"));
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ tenantId: "t-1", clusterId: "c-1", name: "web", version: "v1.37.0", controlPlanes: 3, workers: 2, size: "medium" });
});

test("create on a multi-member Incus cluster: its nodes run on one member, chosen or automatic", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, memberOf("member")],
    "GET /api/v1/kubernetes/versions": [200, options()],
    "GET /api/v1/tenants/t-1/placements": [200, [{ clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" }]],
    "GET /1.0/cluster/members": [
      200,
      {
        type: "sync",
        metadata: [
          { server_name: "m1@lab", status: "Online" },
          { server_name: "m2@lab", status: "Online" },
          { server_name: "m3@lab", status: "Offline" },
          { server_name: "x1@other", status: "Online" },
        ],
      },
    ],
    "POST /api/v1/kubernetes": [202, { cluster: k8s({ id: "k-9", status: "creating" }), job: { id: "j-1" } }],
  });
  renderAt(<CreateKubernetes />);
  const node = await screen.findByLabelText("Member");
  expect(within(node).getAllByRole("option").map((o) => [o.textContent, (o as HTMLOptionElement).disabled])).toEqual([
    ["Automatic (most memory free)", false],
    ["m1", false],
    ["m2", false],
    ["m3 (Offline)", true],
  ]);
  await userEvent.selectOptions(node, "m2");
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ clusterId: "c-1", member: "m2" }));
});

test("create as an operator: every ready Incus cluster, and one the tenant is not on places it", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: "operator", tenants: [] })],
    "GET /api/v1/kubernetes/versions": [200, options()],
    "GET /api/v1/tenants": [200, [{ id: "t-1", slug: "acme", name: "Acme" }]],
    "GET /api/v1/tenants/t-1/placements": [200, [{ clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" }]],
    "GET /api/v1/clusters": [
      200,
      [
        { id: "c-1", name: "lab", status: "ready" },
        { id: "c-2", name: "edge", status: "ready" },
        { id: "c-3", name: "down", status: "error" },
      ],
    ],
    "GET /1.0/cluster/members": [200, { type: "sync", metadata: [] }],
    "POST /api/v1/kubernetes": [202, { cluster: k8s({ id: "k-9", status: "creating" }), job: { id: "j-1" } }],
  });
  renderAt(<CreateKubernetes />);
  const cluster = await screen.findByLabelText("Incus cluster");
  await waitFor(() => expect(within(cluster).getAllByRole("option").map((o) => o.textContent)).toEqual(["edge (places the tenant)", "lab"]));
  await userEvent.selectOptions(cluster, "c-2");
  expect(screen.getByText(/Acme is placed on edge first/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ tenantId: "t-1", clusterId: "c-2" }));
});

test("create refuses names CAPI cannot use", async () => {
  mockApi({
    "GET /api/v1/me": [200, memberOf("member")],
    "GET /api/v1/kubernetes/versions": [200, options()],
    "GET /api/v1/tenants/t-1/placements": [200, [{ clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" }]],
  });
  renderAt(<CreateKubernetes />);
  await userEvent.type(await screen.findByLabelText("Name"), "Web_1");
  expect(screen.getByText("Lowercase letters, digits and dashes; starts with a letter; up to 32.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create" })).toHaveAttribute("aria-disabled", "true");
});

const detail = (who: Me, cluster: K8sCluster, extra: Parameters<typeof mockApi>[0] = {}, tab = "") => {
  const api = mockApi({
    "GET /api/v1/me": [200, who],
    "GET /api/v1/kubernetes/versions": [200, options()],
    "GET /api/v1/kubernetes": [200, [cluster, k8s({ id: "k-2", name: "web", project: "other", clusterName: "lab" })]],
    "GET /api/v1/kubernetes/k-1": [200, cluster],
    ...extra,
  });
  renderAt(
    <Routes>
      <Route path="/ui/project/:project/kubernetes/:name/:tab?" element={<KubernetesDetail />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { path: `/ui/project/acme%40lab/kubernetes/web${tab ? `/${tab}` : ""}` },
  );
  return api;
};

test("detail: its facts, and a failed one says why", async () => {
  detail(memberOf("member"), k8s({ status: "error", statusMessage: "The control plane of web did not become available in time" }));
  expect(await screen.findByText("This cluster did not come up")).toBeInTheDocument();
  expect(screen.getByText("The control plane of web did not become available in time")).toBeInTheDocument();
  const general = screen.getByRole("region", { name: "General" });
  expect(within(general).getByText("https://10.0.0.5:16443")).toBeInTheDocument();
  expect(within(general).getByText("Small (2 CPUs, 2 GiB)")).toBeInTheDocument();
  expect(within(general).getByText("3 of 3")).toBeInTheDocument();
});

test("detail: scale and upgrade send a PATCH; upgrade offers the next minor version only", async () => {
  const api = detail(memberOf("member"), k8s(), { "PATCH /api/v1/kubernetes/k-1": [200, k8s({ workers: 4 })] });
  await userEvent.click(await screen.findByRole("button", { name: "Scale" }));
  await userEvent.clear(screen.getByLabelText("Worker nodes"));
  await userEvent.type(screen.getByLabelText("Worker nodes"), "4");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.calls.find((c) => c.method === "PATCH")?.body).toEqual({ controlPlanes: 1, workers: 4 }));
  await userEvent.click(screen.getByRole("button", { name: "Upgrade" }));
  expect(within(screen.getByLabelText("Version")).getAllByRole("option").map((o) => o.textContent)).toEqual(["v1.37.0"]);
  await userEvent.click(screen.getByRole("button", { name: "Upgrade to v1.37.0" }));
  await waitFor(() => expect(api.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ version: "v1.37.0" }));
});

test("detail: no upgrade from the newest version; nothing to change while a job owns it", async () => {
  detail(memberOf("member"), k8s({ version: "v1.37.0", status: "provisioning" }));
  await screen.findByRole("region", { name: "General" });
  expect(screen.queryByRole("button", { name: "Upgrade" })).toBeNull();
  expect(screen.getByRole("button", { name: "Scale" })).toHaveAttribute("aria-disabled", "true");
});

test("detail: tenant admins delete it after confirming; members do not see Delete", async () => {
  detail(memberOf("member"), k8s());
  await screen.findByRole("region", { name: "General" });
  expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
});

test("detail: delete goes to its job", async () => {
  const api = detail(memberOf("admin"), k8s(), { "DELETE /api/v1/kubernetes/k-1": [202, { id: "j-7" }] });
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/jobs/j-7"));
  expect(api.calls.some((c) => c.method === "DELETE")).toBe(true);
});

test("detail: the kubeconfig downloads as a file", async () => {
  const created = vi.fn(() => "blob:k");
  const saved = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
  const api = detail(memberOf("member"), k8s(), { "GET /api/v1/kubernetes/k-1/kubeconfig": [200, "apiVersion: v1"] });
  await userEvent.click(await screen.findByRole("button", { name: "Download kubeconfig" }));
  await waitFor(() => expect(created).toHaveBeenCalled());
  expect(saved.mock.instances[0]).toHaveProperty("download", "web.kubeconfig");
  expect(api.calls.some((c) => c.path === "/api/v1/kubernetes/k-1/kubeconfig")).toBe(true);
});

test("detail: its nodes, control plane first, each linked to its Incus instance on its member", async () => {
  detail(memberOf("viewer"), k8s(), {
    "GET /api/v1/kubernetes/k-1/nodes": [
      200,
      [
        { name: "web-cp-x", role: "control-plane", instance: "web-cp-x", phase: "Running", version: "v1.36.4", ready: true },
        { name: "web-md-a", role: "worker", instance: "web-md-a", phase: "Provisioning", version: "v1.36.4", ready: false },
      ],
    ],
    "GET /1.0/instances": [200, { type: "sync", metadata: [{ name: "web-cp-x", project: "acme@lab", location: "m2@lab", status: "Running", type: "container" }] }],
  }, "nodes");
  const cp = (await screen.findByRole("link", { name: "web-cp-x" })).closest("tr")!;
  expect(within(cp).getByRole("link", { name: "web-cp-x" })).toHaveAttribute("href", "/ui/project/acme%40lab/instance/web-cp-x");
  expect(within(cp).getByText("Control plane")).toBeInTheDocument();
  expect(await within(cp).findByText("m2")).toBeInTheDocument();
  const worker = screen.getByRole("link", { name: "web-md-a" }).closest("tr")!;
  expect(within(worker).getByText("Provisioning")).toBeInTheDocument();
  expect(within(worker).getByText("Not ready")).toBeInTheDocument();
});

test("detail: its activity is its jobs, newest first", async () => {
  const job = (id: string, type: string, k8sId: string, createdAt: string) => ({ id, type, state: "succeeded", progress: { stage: "done" }, payload: { k8sId }, result: null, error: "", tenantId: "t-1", clusterIds: [], instanceKey: null, actorType: "user", actorId: "u-1", cancelRequested: false, createdAt, startedAt: createdAt, finishedAt: createdAt });
  detail(memberOf("member"), k8s(), {
    "GET /api/v1/jobs": [200, [job("j-1", "k8s-create", "k-1", "2026-10-12T10:00:00Z"), job("j-2", "k8s-create", "k-9", "2026-10-12T11:00:00Z")]],
  }, "activity");
  const row = (await screen.findByRole("link", { name: "k8s-create" })).closest("tr")!;
  expect(within(row).getByRole("link", { name: "k8s-create" })).toHaveAttribute("href", "/jobs/j-1");
  expect(screen.getAllByRole("link", { name: "k8s-create" })).toHaveLength(1);
});
