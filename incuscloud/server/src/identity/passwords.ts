import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { users } from "../db/schema.ts";

export type User = typeof users.$inferSelect;

export const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "argon2id" });

export const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash).catch(() => false);

// Verified against when the email is unknown, so both paths cost one argon2id run.
let dummyHash: Promise<string> | undefined;
const dummy = () => (dummyHash ??= hashPassword(crypto.randomUUID()));

/** The enabled user with this email and password, or null. Timing does not reveal which check failed. */
export async function checkCredentials(db: Db, email: string, password: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email.trim()));
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummy()));
  return ok && user && user.passwordHash && !user.disabled ? user : null;
}
