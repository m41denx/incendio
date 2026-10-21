import { afterEach, expect, test, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import CreateKubernetes from "./KubernetesCreate";
import { k8sCluster, k8sOptions, k8sSpec } from "./fixtures";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup() {
  const api = mockApi({
    "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }] })],
    "GET /api/v1/kubernetes/versions": [200, k8sOptions()],
    "GET /api/v1/tenants/t-1/placements": [200, [{ clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready" }]],
    "GET /1.0/profiles": [200, { metadata: [{ name: "default" }] }],
    "GET /1.0/cluster/members": [200, { metadata: [{ server_name: "m1@lab", status: "Online" }] }],
    "GET /1.0/cluster/groups": [200, { metadata: [{ name: "general@lab" }] }],
    "POST /api/v1/kubernetes": [202, { cluster: k8sCluster(), job: { id: "j-1" } }],
  });
  renderAt(<CreateKubernetes />, { path: "/kubernetes/new?cluster=lab&tenant=t-1" });
  return api;
}
test("Incendio's Cluster and Machines sections, no credentials or artifacts, VIP and interface", async () => {
  setup();
  await screen.findByLabelText("Incus cluster");
  expect(screen.getByText("Machines")).toBeInTheDocument();
  expect(screen.queryByText("Infrastructure credentials")).toBeNull();
  expect(screen.queryByText("Generated artifacts")).toBeNull();
  fireEvent.change(screen.getByLabelText("Load balancer"), { target: { value: "kube-vip" } });
  expect(screen.getByLabelText("Virtual IP address")).toBeInTheDocument();
  expect(screen.getByLabelText("Interface")).toBeInTheDocument();
});
test("custom resources, counts, scoped targets and the submitted spec", async () => {
  const api = setup();
  await screen.findByLabelText("Cluster name");
  fireEvent.change(screen.getByLabelText("Cluster name"), { target: { value: "parity" } });
  await userEvent.click(screen.getByText("Machines"));
  const cp = screen.getByRole("region", { name: "Control plane" });
  const workers = screen.getByRole("region", { name: "Workers" });
  fireEvent.change(within(cp).getByLabelText("Count"), { target: { value: "3" } });
  fireEvent.change(within(cp).getByLabelText("CPU cores"), { target: { value: "4" } });
  fireEvent.change(within(cp).getByLabelText("Memory"), { target: { value: "8" } });
  fireEvent.change(within(workers).getByLabelText("Count"), { target: { value: "2" } });
  await waitFor(() => expect(within(cp).getByLabelText("Target")).toHaveTextContent("m1"));
  expect(within(cp).getByLabelText("Target")).toHaveTextContent("@general");
  fireEvent.change(within(cp).getByLabelText("Target"), { target: { value: "m1" } });
  expect(screen.getByText(/Uses 6 instances, 17 CPUs, 33 GiB/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Create cluster" }));
  await waitFor(() => expect(api.calls.find(c => c.method === "POST")?.body).toEqual({
    tenantId: "t-1", clusterId: "c-1", name: "parity", version: "v1.37.0", controlPlanes: 3, workers: 2,
    spec: k8sSpec({ controlPlane: { type: "container", flavor: "c4-m8", profiles: ["default"], target: "m1" } }),
  }));
  const scoped = vi.mocked(fetch).mock.calls.filter(([url]) => /\/1\.0\/(cluster|profiles)/.test(String(url)));
  expect(scoped.some(([url]) => String(url).includes("/1.0/profiles"))).toBe(true);
  expect(scoped.length).toBeGreaterThan(0);
  for (const [, init] of scoped) expect((init?.headers as Record<string,string>)["x-incuscloud-scope"]).toBe("lab");
});
test("kubeadm minimum and malformed flavors disable Create", async () => {
  setup(); await screen.findByLabelText("Cluster name");
  await userEvent.click(screen.getByText("Machines"));
  const cp = screen.getByRole("region", { name: "Control plane" });
  fireEvent.change(within(cp).getByLabelText("CPU cores"), { target: { value: "1" } });
  expect(screen.getAllByText(/Control plane nodes need at least 2 CPUs/).length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Create cluster" })).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(within(cp).getByLabelText("Custom flavor"));
  fireEvent.change(within(cp).getByLabelText("Flavor"), { target: { value: "t3.medium" } });
  expect(screen.getByRole("button", { name: "Create cluster" })).toHaveAttribute("aria-disabled", "true");
});

test("the load balancer's target is a member, never a group; no privileged containers; MetalLB ranges split on commas or spaces", async () => {
  const api = setup();
  await screen.findByLabelText("Cluster name");
  fireEvent.change(screen.getByLabelText("Cluster name"), { target: { value: "parity" } });
  await waitFor(() => expect(screen.getByLabelText("Load balancer target")).toHaveTextContent("m1"));
  expect(screen.getByLabelText("Load balancer target")).not.toHaveTextContent("@general");
  expect(screen.queryByLabelText("Privileged containers")).toBeNull();
  await userEvent.click(screen.getByLabelText("Install MetalLB"));
  fireEvent.change(document.querySelector("#metallbAddresses")!, { target: { value: "10.0.0.200-10.0.0.210 10.0.1.0/29" } });
  await userEvent.click(screen.getByRole("button", { name: "Create cluster" }));
  await waitFor(() => expect(api.calls.find(c => c.method === "POST")?.body).toMatchObject({ spec: { metallb: { addresses: ["10.0.0.200-10.0.0.210", "10.0.1.0/29"] } } }));
});

test("the image name is a text field, styled as the others", async () => {
  setup();
  expect(await screen.findByLabelText("Image name")).toHaveAttribute("type", "text");
});
