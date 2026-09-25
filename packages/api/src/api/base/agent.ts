import axios, { type AxiosError, type AxiosInstance } from "axios";
import {
  IncusError,
  type IncusClientOptions,
  type RequestContext,
  type WebSocketConnector,
  type WebSocketLike,
} from "./types";

const decodeBody = (data: unknown): unknown => {
  if (data instanceof ArrayBuffer) {
    data = new TextDecoder().decode(data);
  }
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
};

const toIncusError = async (error: AxiosError): Promise<IncusError> => {
  const response = error.response;
  if (!response) {
    return new IncusError(error.message, 0, 0, error);
  }
  let data: unknown = response.data;
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    data = await data.text();
  }
  data = decodeBody(data);
  if (data && typeof data === "object" && "error" in data) {
    const body = data as { error?: string; error_code?: number };
    return new IncusError(
      body.error || response.statusText,
      response.status,
      body.error_code,
      data,
    );
  }
  const message =
    typeof data === "string" && data.length > 0 ? data : response.statusText;
  return new IncusError(
    message || `HTTP ${response.status}`,
    response.status,
    response.status,
    data,
  );
};

/** Creates the axios instance used for all REST calls. */
export const createRequester = (options: IncusClientOptions): AxiosInstance => {
  const requester =
    options.requester ??
    axios.create({
      baseURL: (options.url ?? "").replace(/\/+$/, ""),
      timeout: options.timeout ?? 0,
      ...options.axios,
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        ...(options.axios?.headers as Record<string, string> | undefined),
      },
    });

  requester.interceptors.response.use(undefined, async (error: unknown) => {
    if (axios.isAxiosError(error)) {
      throw await toIncusError(error);
    }
    throw error;
  });

  return requester;
};

const resolveWebSocketUrl = (baseURL: string, path: string): string => {
  if (/^https?:\/\//.test(baseURL)) {
    return baseURL.replace(/^http/, "ws") + path;
  }
  const location = (globalThis as { location?: Location }).location;
  if (!location) {
    throw new IncusError(
      "Cannot build a WebSocket URL without `url`; pass `url` or a `websocket` connector",
      0,
    );
  }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${baseURL}${path}`;
};

/** Default connector: the global `WebSocket`, pointed at the requester's base URL. */
export const defaultWebSocketConnector =
  (requester: AxiosInstance): WebSocketConnector =>
  (path) => {
    const WS = (globalThis as { WebSocket?: new (url: string) => unknown })
      .WebSocket;
    if (!WS) {
      throw new IncusError(
        "No global WebSocket available; pass a `websocket` connector (see @incendio/api/node)",
        0,
      );
    }
    const socket = new WS(
      resolveWebSocketUrl(requester.defaults.baseURL ?? "", path),
    ) as WebSocketLike;
    socket.binaryType = "arraybuffer";
    return socket;
  };

export const createContext = (options: IncusClientOptions): RequestContext => {
  const r = createRequester(options);
  return {
    r,
    project: options.project,
    target: options.target,
    connect: options.websocket ?? defaultWebSocketConnector(r),
  };
};
