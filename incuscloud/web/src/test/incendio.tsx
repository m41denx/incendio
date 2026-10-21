import type { ReactNode } from "react";
import { afterEach } from "vitest";
import AppProviders, { queryClient } from "@incendio/ui/context/appProviders";
import { renderAt } from "./api";

// Pages in Incendio's frame share its query client: no retries, nothing kept between tests.
queryClient.setDefaultOptions({ queries: { retry: false } });
afterEach(() => queryClient.clear());

/** Incendio's view of a signed-in caller, through the federation facade: for pages in its frame. */
export const incendioApi = (): Record<string, [number, unknown?]> => ({
  "GET /1.0": [200, { type: "sync", metadata: { auth: "trusted", api_extensions: [], config: {}, environment: { server_version: "7.5.1", server_clustered: true } } }],
  "GET /1.0/projects": [200, { type: "sync", metadata: [{ name: "default", config: {}, used_by: [] }] }],
  "GET /os/1.0": [404, { type: "error", error_code: 404, error: "not found" }],
});

/** Renders `ui` inside Incendio's providers, as the console's frame does. */
export const renderInFrame = (ui: ReactNode, o: { path?: string; pattern?: string } = {}) => renderAt(ui, { ...o, wrap: (routes) => <AppProviders>{routes}</AppProviders> });
