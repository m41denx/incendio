import type { JobHandler } from "./types.ts";

/** Every job type the worker runs. */
export function jobHandlers(): Record<string, JobHandler> {
  return {};
}
