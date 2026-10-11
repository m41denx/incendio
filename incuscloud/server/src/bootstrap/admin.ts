import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { platformRoles, users } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { tuples } from "../authz/sync.ts";
import { hashPassword } from "../identity/passwords.ts";
import { log } from "../lib/log.ts";

/** Creates the first platform admin from IC_BOOTSTRAP_ADMIN_* when no admin exists. Idempotent. */
export async function ensureBootstrapAdmin(db: Db, authz: Authz, cfg: { email: string; password: string } | undefined): Promise<void> {
  if (!cfg) return;
  if ((await db.select().from(platformRoles).where(eq(platformRoles.role, "admin")).limit(1)).length) return;
  const passwordHash = await hashPassword(cfg.password);
  const [existing] = await db.select().from(users).where(eq(users.email, cfg.email));
  const user = existing ?? (await db.insert(users).values({ email: cfg.email, name: "Administrator", passwordHash }).returning())[0]!;
  await db.insert(platformRoles).values({ userId: user.id, role: "admin" }).onConflictDoUpdate({ target: platformRoles.userId, set: { role: "admin" } });
  await authz.write([tuples.platformRole(user.id, "admin")]);
  log.info("bootstrap admin ready", { email: cfg.email });
}
