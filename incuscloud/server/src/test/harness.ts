import { testDb } from "../db/test-db.ts";
import { platformRoles, tenantMembers, tenants, users } from "../db/schema.ts";
import { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import { AclAuthz } from "../authz/acl-authz.ts";
import { FakeHydra } from "../identity/fake-hydra.ts";
import { FakeTokens } from "../auth/fake-tokens.ts";
import { createVerifier } from "../auth/verify.ts";
import { createApp, type AppDeps } from "../app.ts";
import { TEST_ISSUER, testKeys } from "./tokens.ts";

export interface Actor {
  id: string;
  token: string;
}

/** A full app over PGlite, the ACL (re-read on every check) and a fake Hydra. */
export async function harness(over: Partial<AppDeps> = {}) {
  const db = await testDb();
  // Tests change the database directly: no snapshot reuse.
  const acl = new Acl(db, { ttlMs: 0 });
  const authz = new AclAuthz(db, acl);
  const hydra = new FakeHydra();
  const { jwks, sign } = await testKeys();
  const deps: AppDeps = {
    db,
    acl,
    authz,
    hydra,
    tokens: new FakeTokens((c) => sign(c)),
    verify: createVerifier({ issuer: TEST_ISSUER, audience: "incuscloud", jwks }),
    secretKey: Buffer.alloc(32, 8),
    publicUrl: "https://cloud.test",
    hydraPublicUrl: "https://id.test",
    secureCookies: true,
    clusterDomain: "clusters.test",
    ...over,
  };
  const app = createApp(deps);

  const call = async (as: Actor | null, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (as) headers.authorization = `Bearer ${as.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await app.handle(new Request(`https://cloud.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await r.text();
    // biome-ignore lint/suspicious/noExplicitAny: test JSON
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, body: json };
  };

  /** Creates a user, optionally with a platform role and tenant roles. */
  const user = async (email: string, o: { platformRole?: "admin" | "operator" | "viewer"; tenants?: Record<string, string> } = {}): Promise<Actor> => {
    const [u] = await db.insert(users).values({ email, name: email.split("@")[0]! }).returning();
    if (o.platformRole) await db.insert(platformRoles).values({ userId: u!.id, role: o.platformRole });
    for (const [tenantId, role] of Object.entries(o.tenants ?? {})) await db.insert(tenantMembers).values({ tenantId, userId: u!.id, role });
    return { id: u!.id, token: await sign({ sub: u!.id }) };
  };

  const tenant = async (slug: string) => {
    const [t] = await db.insert(tenants).values({ slug, name: slug.toUpperCase() }).returning();
    return t!;
  };

  /** Whether a user or service account (by id) holds a privilege on a path. */
  const can = async (id: string, privilege: Privilege, path: string) => acl.can({ kind: (await acl.lookup()).serviceAccounts.has(id) ? "service" : "user", id }, privilege, path);
  /** Whether a user owns a tenant (the membership). */
  const owns = async (userId: string, tenantId: string) => (await acl.lookup()).owners.has(`${tenantId}:${userId}`);

  return { db, acl, authz, hydra, deps, app, call, user, tenant, sign, can, owns };
}
