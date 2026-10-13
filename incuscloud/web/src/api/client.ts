/** An error answer from the IncusCloud API: `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Where the browser goes to sign in, coming back to the current page. */
export const signInUrl = () => `/auth/start?return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`;

/**
 * Calls the API with the session cookie. Without a session the browser is sent
 * to sign in (the promise never settles); other failures throw ApiError.
 */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.assign(signInUrl());
    return new Promise<T>(() => {});
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? (res.statusText || `Request failed (${res.status})`));
  }
  return json as T;
}

/** `path?k=v…`, leaving out empty values. */
export function withQuery(path: string, q: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * An Incus API read through the federation facade over every cluster the
 * caller may reach, whatever page asks (the console's inventory tree).
 * Returns the response's `metadata`.
 */
export const incusAll = <T>(path: string): Promise<T> => incusAt<T>("all", path);

/** Read one cluster through the facade; names and projects remain qualified. */
export async function incusAt<T>(cluster: string, path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json", "x-incuscloud-scope": cluster } });
  if (res.status === 401) {
    window.location.assign(signInUrl());
    return new Promise<T>(() => {});
  }
  const json = (await res.json().catch(() => undefined)) as { metadata?: T; error?: string } | undefined;
  if (!res.ok) throw new ApiError(res.status, "incus", json?.error || res.statusText || `Request failed (${res.status})`);
  return json?.metadata as T;
}
