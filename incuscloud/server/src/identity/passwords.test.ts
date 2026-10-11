import { expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import { users } from "../db/schema.ts";
import { checkCredentials, hashPassword, verifyPassword } from "./passwords.ts";

test("hash and verify", async () => {
  const h = await hashPassword("correct horse battery");
  expect(h).toStartWith("$argon2id$");
  expect(await verifyPassword("correct horse battery", h)).toBe(true);
  expect(await verifyPassword("wrong", h)).toBe(false);
});

test("checkCredentials: good, wrong, unknown, disabled, passwordless", async () => {
  const db = await testDb();
  const passwordHash = await hashPassword("pw-good-123456");
  await db.insert(users).values([
    { email: "ok@example.com", name: "Ok", passwordHash },
    { email: "off@example.com", name: "Off", passwordHash, disabled: true },
    { email: "sso@example.com", name: "Sso" },
  ]);
  expect((await checkCredentials(db, "OK@example.com", "pw-good-123456"))?.name).toBe("Ok");
  expect(await checkCredentials(db, "ok@example.com", "nope")).toBeNull();
  expect(await checkCredentials(db, "ghost@example.com", "pw-good-123456")).toBeNull();
  expect(await checkCredentials(db, "off@example.com", "pw-good-123456")).toBeNull();
  expect(await checkCredentials(db, "sso@example.com", "")).toBeNull();
});

test("unknown emails cost about as much as wrong passwords", async () => {
  const db = await testDb();
  await db.insert(users).values({ email: "t@example.com", name: "T", passwordHash: await hashPassword("pw-good-123456") });
  await checkCredentials(db, "ghost@example.com", "x"); // warm the dummy hash
  const time = async (email: string) => {
    const t0 = performance.now();
    for (let i = 0; i < 3; i++) await checkCredentials(db, email, "wrong");
    return performance.now() - t0;
  };
  const known = await time("t@example.com");
  const unknown = await time("ghost@example.com");
  expect(unknown).toBeGreaterThan(known * 0.5);
});
