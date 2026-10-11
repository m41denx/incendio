import { expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { me, mockApi, renderAt } from "./test/api";
import { AppRoutes } from "./App";

test("unknown pages say so", async () => {
  mockApi({ "GET /api/v1/me": [200, me()] });
  renderAt(<AppRoutes />, { path: "/no/such/page" });
  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
});
