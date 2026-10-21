import { afterEach, expect, test } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { me, mockApi, renderAt } from "../test/api";
import type { Cluster } from "../api/types";
import Profile from "./Profile";

const cluster = (over: Partial<Cluster>): Cluster => ({
  id: "c-1",
  name: "prod",
  url: "https://prod.clusters.test:8443",
  addresses: [],
  fingerprint: "",
  status: "ready",
  statusMessage: "",
  labels: {},
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  lastSeenAt: null,
  reconciledAt: null,
  reconcileRequestedAt: null,
  ...over,
});

test("the CLI command names each cluster under the cluster domain", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/clusters": [200, [cluster({ name: "prod" })]] });
  renderAt(<Profile />);
  expect(await screen.findByText("incus remote add prod https://prod.clusters.test --auth-type=oidc")).toBeInTheDocument();
  expect(screen.getByText(/opens a browser sign-in on first use/)).toBeInTheDocument();
});

test("the console link is a plain link to the cluster's UI path", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/clusters": [200, [cluster({ name: "prod" })]] });
  renderAt(<Profile />);
  const link = await screen.findByRole("link", { name: "Open prod console" });
  expect(link).toHaveAttribute("href", "/clusters/prod/ui/");
});

test("disabled clusters are skipped", async () => {
  mockApi({
    "GET /api/v1/me": [200, me()],
    "GET /api/v1/clusters": [200, [cluster({ name: "prod" }), cluster({ id: "c-2", name: "old", status: "disabled" })]],
  });
  renderAt(<Profile />);
  await screen.findByText("incus remote add prod https://prod.clusters.test --auth-type=oidc");
  expect(screen.queryByText(/incus remote add old /)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open old console" })).not.toBeInTheDocument();
});

test("the page is titled with the name and lists email, role and tenants", async () => {
  mockApi({
    "GET /api/v1/me": [200, me({ name: "Ada Lovelace", platformRole: null, tenants: [{ id: "t-1", slug: "acme", name: "Acme", role: "member" }] })],
    "GET /api/v1/clusters": [200, []],
  });
  renderAt(<Profile />);
  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(screen.getByText("ada@example.com", { selector: "td" })).toBeInTheDocument();
  expect(screen.getByText("None", { selector: "td" })).toBeInTheDocument();
  expect(screen.getByText("Acme (member)")).toBeInTheDocument();
});

afterEach(() => {
  localStorage.removeItem("theme");
  document.body.classList.remove("is-dark");
});

test("appearance: Incendio's theme switcher, applied at once and remembered", async () => {
  mockApi({ "GET /api/v1/me": [200, me()], "GET /api/v1/clusters": [200, []] });
  renderAt(<Profile />);
  await userEvent.click(await screen.findByRole("button", { name: /dark/i }));
  expect(document.body).toHaveClass("is-dark");
  expect(localStorage.getItem("theme")).toBe("dark");
  await userEvent.click(screen.getByRole("button", { name: /light/i }));
  expect(document.body).not.toHaveClass("is-dark");
});
