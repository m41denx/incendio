import type { ReactNode } from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Me } from "../api/types";

type Handler = (body: unknown, url: URL) => [number, unknown?];
export interface MockedApi {
  calls: Array<{ method: string; path: string; body: unknown }>;
}

/**
 * Stubs fetch with routes keyed "METHOD /path" (query string ignored; use the
 * handler's url for it). Unmatched calls answer 404 and fail the test loudly.
 */
export function mockApi(routes: Record<string, Handler | [number, unknown?]>): MockedApi {
  const api: MockedApi = { calls: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://cloud.test");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      api.calls.push({ method, path: url.pathname + url.search, body });
      const route = routes[`${method} ${url.pathname}`];
      if (!route) {
        console.error(`unmocked ${method} ${url.pathname}`);
        return new Response(JSON.stringify({ error: { code: "not_found", message: `unmocked ${method} ${url.pathname}` } }), { status: 404 });
      }
      const [status, json] = typeof route === "function" ? route(body, url) : route;
      return new Response(status === 204 || json === undefined ? null : JSON.stringify(json), { status });
    }),
  );
  return api;
}

export const me = (over: Partial<Me> = {}): Me => ({
  id: "u-1",
  kind: "user",
  email: "ada@example.com",
  name: "Ada",
  platformRole: "admin",
  tenants: [],
  clusterDomain: "clusters.test",
  publicUrl: "https://cloud.test",
  ...over,
});

/** Renders `ui` at `path` (matched by `pattern`) with a fresh query client. */
export function renderAt(ui: ReactNode, { path = "/", pattern = "*" }: { path?: string; pattern?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
