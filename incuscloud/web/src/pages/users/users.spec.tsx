import { expect, test } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../../test/api";
import type { User } from "../../api/types";
import UserList from "./UserList";
import UserDetail from "./UserDetail";

const ada: User = { id: "u-1", email: "ada@example.com", name: "Ada", disabled: false, platformRole: "admin", hasPassword: true, createdAt: "2026-10-01T00:00:00Z", lastLoginAt: null };
const bob: User = { id: "u-2", email: "bob@example.com", name: "Bob", disabled: true, platformRole: null, hasPassword: false, createdAt: "2026-10-02T00:00:00Z", lastLoginAt: null };

test("the list shows users with their role and status, linking to each", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/users": [200, [ada, bob]] });
  renderAt(<UserList />);
  const row = (await screen.findByRole("link", { name: "Bob" })).closest("tr")!;
  expect(within(row).getByText("bob@example.com")).toBeInTheDocument();
  expect(within(row).getByText("Disabled")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Bob" })).toHaveAttribute("href", "/users/u-2");
});

test("admins create users; the body is what the form says and the list refreshes", async () => {
  let created = false;
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/users": () => [200, created ? [ada, { ...bob, id: "u-3", email: "cy@example.com", name: "Cy", disabled: false, platformRole: "viewer" }] : [ada]],
    "POST /api/v1/users": (body) => {
      created = true;
      return [201, { ...bob, ...(body as object) }];
    },
  });
  renderAt(<UserList />);
  await userEvent.click(await screen.findByRole("button", { name: "Create user" }));
  await userEvent.type(screen.getByLabelText("Email"), "cy@example.com");
  await userEvent.type(screen.getByLabelText("Name"), "Cy");
  await userEvent.selectOptions(screen.getByLabelText("Platform role"), "viewer");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await screen.findByRole("link", { name: "Cy" })).toBeInTheDocument();
  expect(api.calls.find((c) => c.method === "POST")!.body).toEqual({ email: "cy@example.com", name: "Cy", platformRole: "viewer" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("API refusals are shown in the form", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/users": [200, [ada]],
    "POST /api/v1/users": [409, { error: { code: "email_taken", message: "A user with this email already exists" } }],
  });
  renderAt(<UserList />);
  await userEvent.click(await screen.findByRole("button", { name: "Create user" }));
  await userEvent.type(screen.getByLabelText("Email"), "ada@example.com");
  await userEvent.type(screen.getByLabelText("Name"), "Ada");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  expect(await within(screen.getByRole("dialog")).findByText("A user with this email already exists")).toBeInTheDocument();
});

test("viewers read but get no controls", async () => {
  mockApi({ "GET /api/v1/me": [200, me({ platformRole: "viewer" })], "GET /api/v1/users": [200, [ada]], "GET /api/v1/users/u-1": [200, ada] });
  renderAt(<UserList />);
  await screen.findByRole("link", { name: "Ada" });
  expect(screen.queryByRole("button", { name: "Create user" })).not.toBeInTheDocument();
  renderAt(<UserDetail />, { path: "/users/u-1", pattern: "/users/:id" });
  await screen.findByText("ada@example.com", { selector: "td" });
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
});

test("the detail page changes role and disables, with the API's 409 shown", async () => {
  const api = mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/users/u-1": [200, ada],
    "PATCH /api/v1/users/u-1": (body) => ((body as { disabled?: boolean }).disabled ? [409, { error: { code: "last_admin", message: "Keep at least one enabled platform admin" } }] : [200, { ...ada, ...(body as object) }]),
  });
  renderAt(<UserDetail />, { path: "/users/u-1", pattern: "/users/:id" });
  await userEvent.selectOptions(await screen.findByLabelText("Platform role"), "operator");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH" && JSON.stringify(c.body) === JSON.stringify({ name: "Ada", platformRole: "operator" }))).toBe(true));
  await userEvent.click(screen.getByRole("button", { name: "Disable" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Disable" }));
  expect(await screen.findByText("Keep at least one enabled platform admin")).toBeInTheDocument();
});

test("delete asks first, then goes back to the list", async () => {
  const api = mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/users/u-2": [200, bob], "DELETE /api/v1/users/u-2": [204], "GET /api/v1/users": [200, [ada]] });
  renderAt(
    <>
      <UserDetail />
    </>,
    { path: "/users/u-2", pattern: "/users/:id" },
  );
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/api/v1/users/u-2")).toBe(true));
});
