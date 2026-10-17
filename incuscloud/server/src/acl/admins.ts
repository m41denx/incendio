import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { aclEntries, platformRoles, users } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";

/** What makes an enabled user an administrator: the platform role, or an Administrator entry on `/`. */
export type AdminHold = { userId: string; via: "role" } | { userId: string; via: "entry"; entryId: string };

export async function administrators(db: Db): Promise<AdminHold[]> {
  const [roles, entries, fenced] = await Promise.all([
    db.select({ userId: platformRoles.userId }).from(platformRoles).innerJoin(users, eq(users.id, platformRoles.userId)).where(and(eq(platformRoles.role, "admin"), eq(users.disabled, false))),
    db.select({ userId: aclEntries.userId, entryId: aclEntries.id }).from(aclEntries).innerJoin(users, eq(users.id, aclEntries.userId)).where(and(eq(aclEntries.path, "/"), eq(aclEntries.role, "administrator"), eq(users.disabled, false))),
    // No access on / beside a role there means nothing (resolution): such holders do not count.
    db.select({ userId: aclEntries.userId }).from(aclEntries).where(and(eq(aclEntries.path, "/"), eq(aclEntries.role, "no-access"))),
  ]);
  const out = new Set(fenced.map((f) => f.userId));
  return [...roles.map((r) => ({ userId: r.userId, via: "role" as const })), ...entries.map((e) => ({ userId: e.userId!, via: "entry" as const, entryId: e.entryId }))].filter((h) => !out.has(h.userId));
}

/** Refuses a change that drops the `lost` holds when they are the last ones: someone must stay an administrator. */
export async function keepAnAdministrator(db: Db, lost: (h: AdminHold) => boolean): Promise<void> {
  const all = await administrators(db);
  const left = new Set(all.filter((h) => !lost(h)).map((h) => h.userId));
  if (all.some(lost) && !left.size) throw new ApiError(409, "last_admin", "This is the last platform administrator");
}
