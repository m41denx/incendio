import { afterEach, expect, test, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { me, mockApi, renderAt } from "../../test/api";
import type { K8sCluster, K8sOptions, Me } from "../../api/types";
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
  name: "web",
  version: "v1.36.4",
  controlPlanes: 1,
  workers: 2,
  size: "small",
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
  expect(within(web).getByRole("link", { name: "web" })).toHaveAttribute("href", "/kubernetes/k-1");
  expect(within(web).getByText("Ready")).toBeInTheDocument();
  expect(within(web).getByText("v1.36.4")).toBeInTheDocument();
  expect(within(web).getByText("3/3")).toBeInTheDocument();
  expect(within(web).getByText("10.0.0.5:16443")).toBeInTheDocument();
  expect(within(web).getByRole("link", { name: "acme" })).toHaveAttribute("href", "/tenants/t-1");
  expect(within(web).getByRole("link", { name: "lab" })).toHaveAttribute("href", "/clusters/c-1");
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
  expect(screen.queryByLabelText("Node")).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.selectOptions(screen.getByLabelText("Control plane nodes"), "3");
  await userEvent.clear(screen.getByLabelText("Worker nodes"));
  await userEvent.type(screen.getByLabelText("Worker nodes"), "2");
  await userEvent.selectOptions(screen.getByLabelText("Node size"), "medium");
  // 5 nodes of 2 CPUs and 4 GiB, and a load balancer of 1 and 1.
  expect(screen.getByText("Uses 6 instances, 11 CPUs, 21 GiB of memory and 60 GiB of disk of the tenant's quota, with its load balancer.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/kubernetes/k-9"));
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
  const node = await screen.findByLabelText("Node");
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

const detail = (who: Me, cluster: K8sCluster, extra: Parameters<typeof mockApi>[0] = {}) => {
  const api = mockApi({ "GET /api/v1/me": [200, who], "GET /api/v1/kubernetes/versions": [200, options()], "GET /api/v1/kubernetes/k-1": [200, cluster], ...extra });
  renderAt(
    <Routes>
      <Route path="/kubernetes/:id" element={<KubernetesDetail />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { path: "/kubernetes/k-1" },
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
