import { Elysia } from "elysia";

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
export const errorHandling = new Elysia({ name: "error-handling" }).onError({ as: "global" }, ({ code, error, set }) => {
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
      return errorBody("internal", "Internal error");
  }
});
