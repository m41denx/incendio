import { expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { me, mockApi, renderAt } from "../test/api";
import Shell from "./Shell";

// Section labels, and "Profile" for the link to /profile (labelled with the user's name).
const labels = async () => {
  await screen.findByText("Clusters");
  return screen.getAllByRole("link").map((a) => (a.getAttribute("href") === "/profile" ? "Profile" : a.textContent?.trim())).filter(Boolean);
};

test("platform admins see every section", async () => {
  mockApi({ "GET /api/v1/me": [200, me({ platformRole: "admin" })] });
  renderAt(<Shell />);
  expect(await labels()).toEqual(expect.arrayContaining(["Dashboard", "Instances", "Clusters", "Tenants", "Jobs", "Replication", "Backups", "Balancing", "Backup targets", "Users", "Service accounts", "Audit log", "Gateway log", "Profile"]));
});

test("tenant members see their tenants and clusters, not platform administration", async () => {
  mockApi({ "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t1", slug: "acme", name: "Acme", role: "member" }] })] });
  renderAt(<Shell />);
  const l = await labels();
  expect(l).toEqual(expect.arrayContaining(["Dashboard", "Instances", "Clusters", "Tenants", "Jobs", "Replication", "Backups", "Balancing", "Profile"]));
  for (const hidden of ["Backup targets", "Users", "Service accounts", "Audit log", "Gateway log"]) expect(l).not.toContain(hidden);
});

test("tenant admins also manage their service accounts and see their logs", async () => {
  mockApi({ "GET /api/v1/me": [200, me({ platformRole: null, tenants: [{ id: "t1", slug: "acme", name: "Acme", role: "admin" }] })] });
  renderAt(<Shell />);
  const l = await labels();
  expect(l).toEqual(expect.arrayContaining(["Service accounts", "Audit log", "Gateway log"]));
  expect(l).not.toContain("Users");
});

test("sign out is a POST form to /auth/logout", async () => {
  mockApi({ "GET /api/v1/me": [200, me()] });
  renderAt(<Shell />);
  const button = await screen.findByRole("button", { name: "Sign out" });
  const form = button.closest("form")!;
  expect(form.getAttribute("method")).toBe("post");
  expect(form.getAttribute("action")).toBe("/auth/logout");
});
