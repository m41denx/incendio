import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { IncusAPIClient } from "../../src/api/client";
import { IncusClient } from "../../src/humane/Client";

export interface Call {
  method: string;
  url: string;
  params: Record<string, unknown>;
  data: unknown;
  headers: Record<string, string>;
}

type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string | undefined>;
};

type Handler = (call: Call) => Reply | undefined;

export const sync = (
  metadata: unknown,
  headers?: Record<string, string>,
): Reply => ({
  body: {
    type: "sync",
    status: "Success",
    status_code: 200,
    operation: "",
    error_code: 0,
    error: "",
    metadata,
  },
  headers,
});

export const operation = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  class: "task",
  description: "test",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  status: "Running",
  status_code: 103,
  resources: {},
  metadata: {},
  may_cancel: false,
  err: "",
  location: "none",
  ...extra,
});

export const async = (id: string, extra?: Record<string, unknown>): Reply => ({
  status: 202,
  body: {
    type: "async",
    status: "Operation created",
    status_code: 100,
    operation: `/1.0/operations/${id}`,
    error_code: 0,
    error: "",
    metadata: operation(id, extra),
  },
});

export const error = (status: number, message: string): Reply => ({
  status,
  body: { type: "error", error: message, error_code: status },
});

/**
 * An API client whose transport records every request and answers from
 * `routes` (`"METHOD /path"` → reply or handler).
 */
export const mockClient = (
  routes: Record<string, Reply | Handler>,
  options: { project?: string; target?: string } = {},
) => {
  const calls: Call[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const call: Call = {
      method: (config.method ?? "get").toUpperCase(),
      url: config.url ?? "",
      params: (config.params ?? {}) as Record<string, unknown>,
      data:
        typeof config.data === "string" && config.data.startsWith("{")
          ? JSON.parse(config.data)
          : config.data,
      headers: Object.fromEntries(
        Object.entries(config.headers.toJSON()).map(([k, v]) => [k, String(v)]),
      ),
    };
    calls.push(call);
    const route = routes[`${call.method} ${call.url}`];
    const reply =
      typeof route === "function"
        ? route(call)
        : (route ?? error(404, "not found"));
    const status = reply?.status ?? 200;
    let data: unknown = reply?.body;
    if (config.responseType === "arraybuffer") {
      data =
        data instanceof ArrayBuffer
          ? data
          : new TextEncoder().encode(
              typeof data === "string" ? data : JSON.stringify(data),
            ).buffer;
    }
    const response: AxiosResponse = {
      data,
      status,
      statusText: String(status),
      headers: Object.fromEntries(
        Object.entries(reply?.headers ?? {})
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k.toLowerCase(), v]),
      ),
      config,
    };
    if (status >= 400) {
      throw new axios.AxiosError(
        `Request failed with status code ${status}`,
        String(status),
        config,
        undefined,
        response,
      );
    }
    return response;
  };

  const api = new IncusAPIClient({
    requester: axios.create({ adapter }),
    ...options,
  });
  return { api, client: new IncusClient(api), calls };
};
