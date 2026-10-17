import { beforeEach, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { testDb } from "../db/test-db.ts";
import { Acl } from "../acl/acl.ts";
import { ROLES } from "../acl/catalog.ts";
import { platformRoles, tenantMembers, tenants, users } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { errorHandling } from "../lib/errors.ts";
import { FakeHydra } from "../identity/fake-hydra.ts";
import { TEST_ISSUER, testKeys } from "../test/tokens.ts";
import { createVerifier } from "../auth/verify.ts";
import { FakeTokens } from "../auth/fake-tokens.ts";
import { principalPlugin } from "../auth/principal.ts";
import { meRoutes } from "./me.ts";

const { jwks, sign } = await testKeys();
let db: Db;
let app: { handle(r: Request): Promise<Response> };

beforeEach(async () => {
  db = await testDb();
  const deps = { db, hydra: new FakeHydra(), tokens: new FakeTokens((c) => sign(c)), verify: createVerifier({ issuer: TEST_ISSUER, audience: "incuscloud", jwks }), secretKey: Buffer.alloc(32, 6), publicUrl: "https://cloud.test", hydraPublicUrl: "https://id.test", secureCookies: true };
  app = new Elysia().use(errorHandling).use(principalPlugin(deps)).use(meRoutes({ db, acl: new Acl(db, { ttlMs: 0 }), clusterDomain: "clusters.test", publicUrl: "https://cloud.test" }));
});

test("401 without credentials", async () => {
  const r = await app.handle(new Request("https://cloud.test/api/v1/me"));
  expect(r.status).toBe(401);
  expect(await r.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in first" } });
});

test("me lists the user's role and tenants", async () => {
  const [u] = await db.insert(users).values({ email: "me@example.com", name: "Me" }).returning();
  const [t] = await db.insert(tenants).values({ slug: "acme", name: "Acme" }).returning();
  await db.insert(tenantMembers).values({ tenantId: t!.id, userId: u!.id, role: "admin" });
  await db.insert(platformRoles).values({ userId: u!.id, role: "viewer" });
  const r = await app.handle(new Request("https://cloud.test/api/v1/me", { headers: { authorization: `Bearer ${await sign({ sub: u!.id })}` } }));
  expect(await r.json()).toEqual({ id: u!.id, kind: "user", email: "me@example.com", name: "Me", platformRole: "viewer", rootPrivileges: [...ROLES.auditor.privileges].sort(), tenants: [{ id: t!.id, slug: "acme", name: "Acme", role: "admin" }], clusterDomain: "clusters.test", publicUrl: "https://cloud.test" });
});
