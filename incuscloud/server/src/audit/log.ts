import type { Db } from "../db/index.ts";
import { auditLog } from "../db/schema.ts";
import { log } from "../lib/log.ts";

export interface AuditEntry {
  actor: { type: "user" | "service" | "anonymous" | "system"; id: string };
  action: string;
  target?: { type: string; id: string };
  result: "success" | "denied" | "failure";
  detail?: Record<string, unknown>;
  ip?: string;
}

/** Records an audit row; failures are logged, never thrown at the caller. */
export async function audit(db: Db, e: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      actorType: e.actor.type,
      actorId: e.actor.id,
      action: e.action,
      targetType: e.target?.type ?? "",
      targetId: e.target?.id ?? "",
      result: e.result,
      detail: e.detail ?? {},
      ip: e.ip ?? "",
    });
  } catch (err) {
    log.error("audit write failed", { error: String(err), action: e.action });
  }
}
