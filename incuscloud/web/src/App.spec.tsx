import { expect, test } from "vitest";
import { screen } from "@testing-library/react";
import { me, mockApi } from "./test/api";
import { incendioApi, renderInFrame } from "./test/incendio";
import { AppRoutes } from "./App";

test("unknown pages say so", async () => {
  mockApi({ ...incendioApi(), "GET /api/v1/me": [200, me()] });
  renderInFrame(<AppRoutes />, { path: "/no/such/page" });
  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
});
