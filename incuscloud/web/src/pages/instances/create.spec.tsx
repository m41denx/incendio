import { expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { me, mockApi } from "../../test/api";
import type { TenantPlacement, TenantUsage } from "../../api/types";
import CreateInstance from "./CreateInstance";

const GiB = 1024 ** 3;

const member = me({
  platformRole: null,
  tenants: [
    { id: "t-1", slug: "acme", name: "Acme", role: "owner" },
    { id: "t-2", slug: "beta", name: "Beta", role: "viewer" },
    { id: "t-3", slug: "gamma", name: "Gamma", role: "admin" },
    { id: "t-4", slug: "delta", name: "Delta", role: "member" },
  ],
});
const debian = { alias: "debian/12/cloud", label: "Debian 12", vm: false };
const ubuntu = { alias: "ubuntu/24.04/cloud", label: "Ubuntu 24.04", vm: true };
const placements: TenantPlacement[] = [
  { clusterId: "c-1", clusterName: "lab", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-2", clusterName: "edge", project: "acme", status: "ready", statusMessage: "", createdAt: "" },
  { clusterId: "c-3", clusterName: "far", project: "acme", status: "error", statusMessage: "down", createdAt: "" },
];
const usage: TenantUsage = {
  quota: { instances: 5, cpu: 4, memory: 8, disk: 50 },
  used: { instances: 3, cpu: 1, memory: 3 * GiB, disk: 10 * GiB },
  clusters: [],
};
const created = { id: "j-7", type: "create", state: "queued", progress: { stage: "queued" } };

/** Routes for a member of Acme (the first choice), with the images and Acme's data. */
function routes(over: Record<string, unknown> = {}) {
  return {
    "GET /api/v1/me": [200, member],
    "GET /api/v1/images": [200, [debian, ubuntu]],
    "GET /api/v1/tenants/t-1/usage": [200, usage],
    "GET /api/v1/tenants/t-1/placements": [200, placements],
    "POST /api/v1/tenants/t-1/instances": [202, created],
    ...over,
  } as Parameters<typeof mockApi>[0];
}

function show(path = "/instances/new") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/instances/new" element={<CreateInstance />} />
          <Route path="/jobs/:id" element={<p>job page</p>} />
          <Route path="/instances" element={<p>list page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const create = () => screen.getByRole("button", { name: "Create" });
const optionsOf = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

test("a member chooses among the tenants where they can create, not viewer ones", async () => {
  mockApi(routes());
  show();
  const tenant = await screen.findByLabelText("Tenant");
  expect(optionsOf(tenant)).toEqual(["Acme (acme)", "Gamma (gamma)", "Delta (delta)"]);
});

test("a caller in no tenant that can create sees a message and no form", async () => {
  mockApi(routes({ "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t-2", slug: "beta", name: "Beta", role: "viewer" }] })] }));
  show();
  expect(await screen.findByText("You are not a member of any tenant that can create instances.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
});

test("a platform operator sees every tenant", async () => {
  const api = mockApi(
    routes({
      "GET /api/v1/me": [200, me({ platformRole: "operator" })],
      "GET /api/v1/tenants": [
        200,
        [
          { id: "t-1", slug: "acme", name: "Acme", quotas: {}, createdAt: "" },
          { id: "t-2", slug: "beta", name: "Beta", quotas: {}, createdAt: "" },
        ],
      ],
    }),
  );
  show();
  expect(optionsOf(await screen.findByLabelText("Tenant"))).toEqual(["Acme (acme)", "Beta (beta)"]);
  expect(api.calls.some((c) => c.path === "/api/v1/tenants")).toBe(true);
});

test("?tenant= preselects that tenant when it is a choice", async () => {
  mockApi(
    routes({
      "GET /api/v1/tenants/t-3/usage": [200, usage],
      "GET /api/v1/tenants/t-3/placements": [200, placements],
    }),
  );
  show("/instances/new?tenant=t-3");
  expect(await screen.findByLabelText("Tenant")).toHaveValue("t-3");
});

test("without a usable ?tenant= the first choice is preselected", async () => {
  mockApi(routes());
  show("/instances/new?tenant=t-2");
  expect(await screen.findByLabelText("Tenant")).toHaveValue("t-1");
});

test("the left-in-quota line counts quota minus use", async () => {
  mockApi(routes());
  show();
  expect(await screen.findByText("Left in the tenant's quota: 2 instances, 3 CPUs, 5.0 GiB memory, 40.0 GiB disk")).toBeInTheDocument();
});

test("past the quota, nothing is left and the line says by how much it is over", async () => {
  mockApi(routes({ "GET /api/v1/tenants/t-1/usage": [200, { ...usage, quota: { cpu: 0, instances: 3 }, used: { ...usage.used, cpu: 1, instances: 1 } }] }));
  show();
  expect(await screen.findByText("Left in the tenant's quota: 2 instances, no CPUs (1 over)")).toBeInTheDocument();
});

test("a tenant without quota says so", async () => {
  mockApi(routes({ "GET /api/v1/tenants/t-1/usage": [200, { ...usage, quota: {} }] }));
  show();
  expect(await screen.findByText("The tenant has no quota.")).toBeInTheDocument();
});

test("Virtual machine is disabled for an image without a VM, and a chosen VM goes back to Container", async () => {
  const api = mockApi(routes());
  show();
  const vm = await screen.findByLabelText("Virtual machine");
  expect(vm).toBeDisabled();
  await userEvent.selectOptions(screen.getByLabelText("Image"), "Ubuntu 24.04");
  expect(vm).toBeEnabled();
  await userEvent.click(vm);
  expect(vm).toBeChecked();
  await userEvent.selectOptions(screen.getByLabelText("Image"), "Debian 12");
  expect(vm).toBeDisabled();
  expect(screen.getByLabelText("Container")).toBeChecked();
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.click(create());
  await screen.findByText("job page");
  expect(api.calls.find((c) => c.method === "POST")!.body).not.toHaveProperty("type");
});

test("Other… shows the alias field and sends the alias as the image", async () => {
  const api = mockApi(routes());
  show();
  await userEvent.selectOptions(await screen.findByLabelText("Image"), "Other…");
  await userEvent.type(screen.getByLabelText("Image alias"), "debian/13/cloud");
  expect(screen.getByText("An alias on the image server, e.g. debian/12/cloud.")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.click(create());
  await screen.findByText("job page");
  expect(api.calls.find((c) => c.method === "POST")!.body).toMatchObject({ name: "web", image: "debian/13/cloud" });
});

test("On a cluster sends the chosen clusterId and offers only ready placements", async () => {
  const api = mockApi(routes());
  show();
  await userEvent.click(await screen.findByLabelText("On a cluster"));
  const cluster = screen.getByLabelText("Cluster");
  expect(optionsOf(cluster)).toEqual(["lab", "edge"]);
  await userEvent.selectOptions(cluster, "edge");
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.click(create());
  await screen.findByText("job page");
  const body = api.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
  expect(body.clusterId).toBe("c-2");
  expect(body).not.toHaveProperty("labels");
});

test("cluster labels are parsed as key=value pairs and sent", async () => {
  const api = mockApi(routes());
  show();
  await userEvent.type(await screen.findByLabelText("Only clusters labelled"), "region=eu, tier = gold, ,");
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.click(create());
  await screen.findByText("job page");
  const body = api.calls.find((c) => c.method === "POST")!.body as Record<string, unknown>;
  expect(body.labels).toEqual({ region: "eu", tier: "gold" });
  expect(body).not.toHaveProperty("clusterId");
});

test("an invalid name keeps Create disabled, and Enter does not submit it", async () => {
  const api = mockApi(routes());
  show();
  await screen.findByLabelText("Tenant");
  expect(create()).toHaveAttribute("aria-disabled", "true");
  await userEvent.type(screen.getByLabelText("Name"), "1web{Enter}");
  expect(screen.getByText("Letters, digits and dashes; starts with a letter.")).toBeInTheDocument();
  expect(create()).toHaveAttribute("aria-disabled", "true");
  expect(api.calls.some((c) => c.method === "POST")).toBe(false);
});

test("labels without an equals sign keep Create disabled", async () => {
  mockApi(routes());
  show();
  await userEvent.type(await screen.findByLabelText("Only clusters labelled"), "region");
  await userEvent.type(screen.getByLabelText("Name"), "web");
  expect(screen.getByText("Write key=value pairs separated by commas.")).toBeInTheDocument();
  expect(create()).toHaveAttribute("aria-disabled", "true");
});

test("a 409 from the API is shown as its message and the form stays", async () => {
  mockApi(routes({ "POST /api/v1/tenants/t-1/instances": [409, { error: { code: "quota", message: "Over the tenant's quota: memory: 9.0 of 8 GiB" } }] }));
  show();
  await userEvent.type(await screen.findByLabelText("Name"), "web");
  await userEvent.click(create());
  expect(await screen.findByText("Over the tenant's quota: memory: 9.0 of 8 GiB")).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toHaveValue("web");
});

test("success posts the defaults and goes to the job page", async () => {
  const api = mockApi(routes());
  show();
  await userEvent.type(await screen.findByLabelText("Name"), "web");
  await userEvent.click(create());
  expect(await screen.findByText("job page")).toBeInTheDocument();
  const post = api.calls.find((c) => c.method === "POST")!;
  expect(post.path).toBe("/api/v1/tenants/t-1/instances");
  expect(post.body).toEqual({ name: "web", image: "debian/12/cloud", cpu: 1, memoryGiB: 1, diskGiB: 10, start: true });
});

test("sizes, type and start are sent as entered", async () => {
  const api = mockApi(routes());
  show();
  await userEvent.selectOptions(await screen.findByLabelText("Image"), "Ubuntu 24.04");
  await userEvent.click(screen.getByLabelText("Virtual machine"));
  await userEvent.clear(screen.getByLabelText("CPUs"));
  await userEvent.type(screen.getByLabelText("CPUs"), "2");
  await userEvent.clear(screen.getByLabelText("Memory (GiB)"));
  await userEvent.type(screen.getByLabelText("Memory (GiB)"), "0.5");
  await userEvent.clear(screen.getByLabelText("Disk (GiB)"));
  await userEvent.type(screen.getByLabelText("Disk (GiB)"), "20");
  await userEvent.click(screen.getByLabelText("Start it once created"));
  await userEvent.type(screen.getByLabelText("Name"), "web");
  await userEvent.click(create());
  await screen.findByText("job page");
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "web", image: "ubuntu/24.04/cloud", type: "virtual-machine", cpu: 2, memoryGiB: 0.5, diskGiB: 20, start: false });
});

test("Cancel goes back to the instance list", async () => {
  mockApi(routes());
  show();
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(await screen.findByText("list page")).toBeInTheDocument();
});
