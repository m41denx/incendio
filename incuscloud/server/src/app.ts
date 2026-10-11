import { Elysia } from "elysia";
import { errorHandling } from "./lib/errors.ts";

/** Everything the HTTP app needs; grows as features land. */
export interface AppDeps {}

/** The platform's HTTP app (API, identity pages, health). */
export function createApp(_deps: AppDeps) {
  return new Elysia().use(errorHandling).get("/healthz", () => ({ status: "ok" }));
}
