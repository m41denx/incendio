import { expect, test } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import { incendioApi, renderInFrame } from "../../test/incendio";
import Shell from "../../components/Shell";
import type { AclEntry, AclRole } from "../../api/types";
import PermissionsPage from "./PermissionsPage";

const ADMIN_PRIVS = [
  "acl.manage",
  "acl.view",
  "cluster.configure",
  "cluster.view",
  "platform.users",
];
const virtual: AclEntry = {
  id: "platform-role:u-1",
  path: "/",
  subject: { type: "user", id: "u-1", name: "ada@example.com" },
  role: "administrator",
  propagate: true,
  source: "platform-role",
  editable: false,
  editedOn: "users",
};
const explicit: AclEntry = {
  id: "e-1",
  path: "/clusters/lab",
  subject: { type: "user", id: "u-2", name: "bob@example.com" },
  role: "operator",
  propagate: true,
  source: "acl",
  editable: true,
};
const roles: AclRole[] = [
  {
    id: "operator",
    name: "Operator",
    privileges: ["cluster.configure", "cluster.view", "instance.view"],
  },
  { id: "auditor", name: "Auditor", privileges: ["cluster.view"] },
  { id: "no-access", name: "No access", privileges: [] },
];
const base = () => ({
  "GET /api/v1/me": [200, me({ rootPrivileges: ADMIN_PRIVS })] as [
    number,
    unknown,
  ],
  "GET /api/v1/acl/roles": [200, roles] as [number, unknown],
  "GET /api/v1/acl/entries": [200, [virtual, explicit]] as [number, unknown],
  "GET /api/v1/users": [
    200,
    [
      {
        id: "u-2",
        email: "bob@example.com",
        name: "Bob",
        disabled: false,
        platformRole: null,
        hasPassword: true,
        createdAt: "",
        lastLoginAt: null,
      },
    ],
  ] as [number, unknown],
  "GET /api/v1/service-accounts": [200, []] as [number, unknown],
  "GET /api/v1/clusters": [200, [{ id: "c-1", name: "lab" }]] as [
    number,
    unknown,
  ],
  "GET /api/v1/tenants": [200, [{ id: "t-1", slug: "acme", name: "Acme" }]] as [
    number,
    unknown,
  ],
});
const at = (tab = "") =>
  renderAt(<PermissionsPage />, {
    path: `/permissions${tab}`,
    pattern: "/permissions/:tab?",
  });

test("lists explicit and virtual entries; virtual ones offer no Remove", async () => {
  mockApi(base());
  at();
  const bob = (await screen.findByText("bob@example.com")).closest("tr")!;
  expect(within(bob).getByText("/clusters/lab")).toBeInTheDocument();
  expect(within(bob).getByText("Operator")).toBeInTheDocument();
  expect(
    within(bob).getByRole("button", { name: "Remove" }),
  ).toBeInTheDocument();
  const ada = screen.getByText("ada@example.com").closest("tr")!;
  expect(
    within(ada).queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
  expect(
    within(ada).getByRole("link", { name: "Edit on Users" }),
  ).toHaveAttribute("href", "/users/u-1");
});

test("Add entry posts {path:'/clusters/lab', subject:{type:'user',id}, role:'operator', propagate:true}", async () => {
  const api = mockApi({
    ...base(),
    "POST /api/v1/acl/entries": (b) => [
      201,
      { ...explicit, id: "e-2", ...(b as object) },
    ],
  });
  at();
  await userEvent.click(
    await screen.findByRole("button", { name: "Add entry" }),
  );
  const dialog = await screen.findByRole("dialog");
  await userEvent.selectOptions(
    within(dialog).getByLabelText("Applies to"),
    "cluster",
  );
  await userEvent.selectOptions(
    await within(dialog).findByLabelText("Cluster"),
    "lab",
  );
  await userEvent.selectOptions(
    await within(dialog).findByLabelText("Subject"),
    "user:u-2",
  );
  await userEvent.selectOptions(
    within(dialog).getByLabelText("Role"),
    "operator",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
  await waitFor(() =>
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({
      path: "/clusters/lab",
      subject: { type: "user", id: "u-2" },
      role: "operator",
      propagate: true,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

test("Remove deletes the entry after confirming", async () => {
  const api = mockApi({ ...base(), "DELETE /api/v1/acl/entries/e-1": [204] });
  at();
  const bob = (await screen.findByText("bob@example.com")).closest("tr")!;
  await userEvent.click(within(bob).getByRole("button", { name: "Remove" }));
  await userEvent.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Remove",
    }),
  );
  await waitFor(() =>
    expect(
      api.calls.some(
        (c) => c.method === "DELETE" && c.path === "/api/v1/acl/entries/e-1",
      ),
    ).toBe(true),
  );
});

test("Roles lists operator's privileges", async () => {
  mockApi(base());
  at("/roles");
  const row = (await screen.findByText("Operator")).closest("tr")!;
  expect(within(row).getByText(/cluster\.configure/)).toBeInTheDocument();
  expect(within(row).getByText(/instance\.view/)).toBeInTheDocument();
  expect(
    within(screen.getByText("No access").closest("tr")!).getByText("Nothing"),
  ).toBeInTheDocument();
});

test("Check shows privileges and the deciding entry", async () => {
  const api = mockApi({
    ...base(),
    "GET /api/v1/acl/check": [
      200,
      {
        privileges: ["cluster.configure", "cluster.view"],
        decidedBy: [explicit],
      },
    ],
  });
  at("/check");
  await screen.findByRole("option", { name: "bob@example.com" });
  await userEvent.selectOptions(screen.getByLabelText("Subject"), "user:u-2");
  await userEvent.clear(screen.getByLabelText("Path"));
  await userEvent.type(screen.getByLabelText("Path"), "/clusters/lab");
  await userEvent.click(screen.getByRole("button", { name: "Check" }));
  expect(await screen.findByText("cluster.configure")).toBeInTheDocument();
  expect(
    api.calls.find((c) => c.path.startsWith("/api/v1/acl/check"))!.path,
  ).toBe("/api/v1/acl/check?subject=user%3Au-2&path=%2Fclusters%2Flab");
  const decided = screen.getByRole("region", { name: "Deciding entries" });
  expect(within(decided).getByText("Operator")).toBeInTheDocument();
});

test("non-administrators get no Add or Remove", async () => {
  mockApi({
    ...base(),
    "GET /api/v1/me": [
      200,
      me({
        platformRole: "viewer",
        rootPrivileges: ["acl.view", "cluster.view"],
      }),
    ],
  });
  at();
  await screen.findByText("bob@example.com");
  expect(
    screen.queryByRole("button", { name: "Add entry" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
});

const links = async () => {
  await screen.findByRole("link", { name: "Tenants" });
  return [
    ...screen
      .getByRole("navigation", { name: "main navigation" })
      .querySelectorAll("a"),
  ].map((a) => a.textContent?.trim());
};

test("the sidebar shows Permissions with acl.view on /", async () => {
  mockApi({
    ...incendioApi(),
    "GET /api/v1/me": [
      200,
      me({ platformRole: null, rootPrivileges: ["acl.view"] }),
    ],
  });
  renderInFrame(<Shell />);
  expect(await links()).toContain("Permissions");
});

test("the sidebar has no Permissions without acl.view on /", async () => {
  mockApi({
    ...incendioApi(),
    "GET /api/v1/me": [200, me({ platformRole: null, rootPrivileges: [] })],
  });
  renderInFrame(<Shell />);
  expect(await links()).not.toContain("Permissions");
});
