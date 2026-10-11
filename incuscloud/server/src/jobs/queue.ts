import type { Db } from "../db/index.ts";
import { jobs } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import type { JobRow } from "./types.ts";

export interface NewJob {
  type: string;
  payload: Record<string, unknown>;
  actor: { type: string; id: string };
  tenantId?: string | null;
  clusterIds?: string[];
  /** `<clusterId>/<project>/<name>`: refused while another job for the instance is queued or running. */
  instanceKey?: string;
}

const uniqueViolation = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x.code === "23505" || x.cause?.code === "23505";
};

/** Queues a job for the worker. */
export async function enqueueJob(db: Db, j: NewJob): Promise<JobRow> {
  try {
    const [row] = await db
      .insert(jobs)
      .values({ type: j.type, payload: j.payload, actorType: j.actor.type, actorId: j.actor.id, tenantId: j.tenantId ?? null, clusterIds: j.clusterIds ?? [], instanceKey: j.instanceKey ?? null })
      .returning();
    return row!;
  } catch (e) {
    if (uniqueViolation(e)) throw new ApiError(409, "busy", "Another job is already working on this instance");
    throw e;
  }
}
