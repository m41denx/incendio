import { Elysia } from "elysia";
import { log } from "./log.ts";

/** An error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const errorBody = (code: string, message: string) => ({ error: { code, message } });

/** Maps every error to `{ error: { code, message } }` with its status. */
export const errorHandling = new Elysia({ name: "error-handling" }).onError({ as: "global" }, ({ code, error, set, request }) => {
  if (error instanceof ApiError) {
    set.status = error.status;
    return errorBody(error.code, error.message);
  }
  switch (code) {
    case "NOT_FOUND":
      set.status = 404;
      return errorBody("not_found", "Not found");
    case "VALIDATION":
      set.status = 400;
      return errorBody("invalid_request", error.message);
    case "PARSE":
      set.status = 400;
      return errorBody("invalid_request", "Malformed request body");
    default:
      set.status = 500;
      log.error("unhandled error", { method: request.method, path: new URL(request.url).pathname, ...describe(error) });
      return errorBody("internal", "Internal error");
  }
});

/**
 * An unexpected error for the log. A failed query's own message carries its parameters (secrets,
 * possibly), so only the database's answer is kept.
 */
export function describe(error: unknown): { error: string; message: string } {
  const e = error as { name?: string; message?: string; cause?: { message?: string } } | undefined;
  const name = e?.name ?? typeof error;
  if (name === "DrizzleQueryError") return { error: name, message: e?.cause?.message ?? "query failed" };
  return { error: name, message: e?.message ?? String(error) };
}
