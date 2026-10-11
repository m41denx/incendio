import { testDb } from "../db/test-db.ts";
import { platformRoles, tenantMembers, tenants, users } from "../db/schema.ts";
import { FakeAuthz } from "../authz/fake.ts";
import { syncAll } from "../authz/sync.ts";
import { FakeHydra } from "../identity/fake-hydra.ts";
import { FakeTokens } from "../auth/fake-tokens.ts";
import { createVerifier } from "../auth/verify.ts";
import { createApp, type AppDeps } from "../app.ts";
import { TEST_ISSUER, testKeys } from "./tokens.ts";

export interface Actor {
  id: string;
  token: string;
}

/** A full app over PGlite, the fake authorizer and a fake Hydra. */
export async function harness() {
  const db = await testDb();
  const authz = new FakeAuthz();
  const hydra = new FakeHydra();
  const { jwks, sign } = await testKeys();
  const deps: AppDeps = {
    db,
    authz,
    hydra,
    tokens: new FakeTokens((c) => sign(c)),
    verify: createVerifier({ issuer: TEST_ISSUER, audience: "incuscloud", jwks }),
    secretKey: Buffer.alloc(32, 8),
    publicUrl: "https://cloud.test",
    hydraPublicUrl: "https://id.test",
    secureCookies: true,
    clusterDomain: "clusters.test",
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

  /** Creates a user, optionally with a platform role and tenant roles, and syncs authz. */
  const user = async (email: string, o: { platformRole?: "admin" | "operator" | "viewer"; tenants?: Record<string, string> } = {}): Promise<Actor> => {
    const [u] = await db.insert(users).values({ email, name: email.split("@")[0]! }).returning();
    if (o.platformRole) await db.insert(platformRoles).values({ userId: u!.id, role: o.platformRole });
    for (const [tenantId, role] of Object.entries(o.tenants ?? {})) await db.insert(tenantMembers).values({ tenantId, userId: u!.id, role });
    await syncAll(db, authz);
    return { id: u!.id, token: await sign({ sub: u!.id }) };
  };

  const tenant = async (slug: string) => {
    const [t] = await db.insert(tenants).values({ slug, name: slug.toUpperCase() }).returning();
    await syncAll(db, authz);
    return t!;
  };

  return { db, authz, hydra, deps, app, call, user, tenant, sign };
}
