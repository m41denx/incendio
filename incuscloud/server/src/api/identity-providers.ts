import { Elysia, t } from "elysia";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { groupMappings, groups, identityProviders, userIdentities } from "../db/schema.ts";
import type { Acl } from "../acl/acl.ts";
import { forbidden, notFound } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import { ApiError } from "../lib/errors.ts";
import { seal } from "../lib/secrets.ts";
import { requestReconcile } from "../reconcile/requests.ts";
import { discover, resyncProvider, type IdentityProvider } from "../identity/federation.ts";
import { audited, created, noContent, uuidParam } from "./common.ts";

const SLUG = "^[a-z0-9][a-z0-9-]{0,30}$";

/**
 * Platform › Identity providers (permissions phase 5): upstream OpenID
 * Connect providers to sign in with, and their "claim value → group"
 * mappings. Managed with `platform.settings`, read with `platform.view`.
 * The client secret is never returned.
 */
export function identityProvidersRoutes({ db, acl, secretKey, publicUrl }: { db: Db; acl: Acl; secretKey: Buffer; publicUrl: string }) {
  const callbackUrl = `${publicUrl.replace(/\/$/, "")}/auth/federation/callback`;
  const need = async (p: Principal, privilege: "platform.settings" | "platform.view") => {
    if (!(await acl.can(p, privilege, "/"))) throw forbidden();
  };
  const load = async (id: string) => {
    const [row] = await db.select().from(identityProviders).where(eq(identityProviders.id, uuidParam(id, "Identity provider not found")));
    if (!row) throw notFound("Identity provider not found");
    return row;
  };
  const view = async (row: IdentityProvider) => {
    const { clientSecretEnc: _, ...rest } = row;
    const mappings = await db
      .select({ id: groupMappings.id, claim: groupMappings.claim, groupId: groupMappings.groupId, group: groups.name })
      .from(groupMappings)
      .innerJoin(groups, eq(groups.id, groupMappings.groupId))
      .where(eq(groupMappings.providerId, row.id))
      .orderBy(groupMappings.claim, groups.name);
    const [{ users }] = (await db.select({ users: sql<number>`count(*)::int` }).from(userIdentities).where(eq(userIdentities.providerId, row.id))) as [{ users: number }];
    return { ...rest, callbackUrl, mappings, users };
  };
  // Group membership decides who resolves to what, in IncusCloud and in Incus.
  const changed = async () => {
    acl.invalidate();
    await requestReconcile(db, "all");
  };
  const checkIssuer = async (issuer: string) => {
    if (!/^https:\/\//.test(issuer) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(issuer)) throw new ApiError(400, "invalid_request", "The issuer must be an https URL");
    await discover(issuer);
  };

  const fields = {
    name: t.String({ minLength: 1, maxLength: 80 }),
    issuer: t.String({ minLength: 1, maxLength: 500 }),
    clientId: t.String({ minLength: 1, maxLength: 500 }),
    scopes: t.Optional(t.String({ minLength: 6, maxLength: 500 })),
    groupsClaim: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
    createUsers: t.Optional(t.Boolean()),
    enabled: t.Optional(t.Boolean()),
  };

  return new Elysia({ name: "identity-providers" })
    .use(principalContext)
    .get("/api/v1/identity-providers", async ({ principal }) => {
      await need(authed(principal), "platform.view");
      const rows = await db.select().from(identityProviders).orderBy(identityProviders.name);
      return { callbackUrl, providers: await Promise.all(rows.map(view)) };
    })
    .post(
      "/api/v1/identity-providers",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const row = await audited(db, { principal: p, request }, "identity_provider.create", (r) => r && { type: "identity_provider", id: r.id }, async () => {
          await need(p, "platform.settings");
          if ((await db.select({ id: identityProviders.id }).from(identityProviders).where(eq(identityProviders.slug, body.slug))).length) {
            throw new ApiError(409, "conflict", `An identity provider "${body.slug}" already exists`);
          }
          if (body.scopes !== undefined && !body.scopes.split(/\s+/).includes("openid")) throw new ApiError(400, "invalid_request", "The scopes must include openid");
          await checkIssuer(body.issuer);
          const { clientSecret, ...rest } = body;
          const [r] = await db.insert(identityProviders).values({ ...rest, clientSecretEnc: seal(secretKey, clientSecret) }).returning();
          return r!;
        });
        return created(set, await view(row));
      },
      { body: t.Object({ slug: t.String({ pattern: SLUG }), clientSecret: t.String({ minLength: 1, maxLength: 2000 }), ...fields }) },
    )
    .patch(
      "/api/v1/identity-providers/:id",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        const row = await audited(db, { principal: p, request }, "identity_provider.update", { type: "identity_provider", id: params.id }, async () => {
          await need(p, "platform.settings");
          const before = await load(params.id);
          if (body.scopes !== undefined && !body.scopes.split(/\s+/).includes("openid")) throw new ApiError(400, "invalid_request", "The scopes must include openid");
          if (body.issuer !== undefined && body.issuer !== before.issuer) await checkIssuer(body.issuer);
          const { clientSecret, ...rest } = body;
          const [r] = await db
            .update(identityProviders)
            .set({ ...rest, ...(clientSecret ? { clientSecretEnc: seal(secretKey, clientSecret) } : {}) })
            .where(eq(identityProviders.id, before.id))
            .returning();
          return r!;
        });
        return view(row);
      },
      {
        body: t.Object({
          clientSecret: t.Optional(t.String({ maxLength: 2000 })),
          name: t.Optional(fields.name),
          issuer: t.Optional(fields.issuer),
          clientId: t.Optional(fields.clientId),
          scopes: fields.scopes,
          groupsClaim: fields.groupsClaim,
          createUsers: fields.createUsers,
          enabled: fields.enabled,
        }),
      },
    )
    .delete("/api/v1/identity-providers/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "identity_provider.delete", { type: "identity_provider", id: params.id }, async () => {
        await need(p, "platform.settings");
        await load(params.id);
        // Its links, mappings and the memberships they made go with it; the users stay.
        await db.delete(identityProviders).where(eq(identityProviders.id, params.id));
        await changed();
      });
      return noContent(set);
    })
    // The whole set of mappings at once; everyone the provider signed in is re-mapped from the groups they last brought.
    .put(
      "/api/v1/identity-providers/:id/mappings",
      async ({ principal, request, params, body }) => {
        const p = authed(principal);
        const row = await audited(db, { principal: p, request }, "identity_provider.mappings", { type: "identity_provider", id: params.id }, async () => {
          await need(p, "platform.settings");
          const provider = await load(params.id);
          const ids = [...new Set(body.mappings.map((m) => m.groupId))];
          for (const id of ids) uuidParam(id, "No such group");
          const known = ids.length ? await db.select({ id: groups.id }).from(groups).where(inArray(groups.id, ids)) : [];
          if (known.length !== ids.length) throw notFound("No such group");
          const rows = [...new Map(body.mappings.map((m) => [`${m.claim}\n${m.groupId}`, { providerId: provider.id, claim: m.claim, groupId: m.groupId }])).values()];
          await db.transaction(async (tx) => {
            await tx.delete(groupMappings).where(eq(groupMappings.providerId, provider.id));
            if (rows.length) await tx.insert(groupMappings).values(rows);
          });
          if (await resyncProvider(db, provider.id)) await changed();
          return provider;
        });
        return view(row);
      },
      { body: t.Object({ mappings: t.Array(t.Object({ claim: t.String({ minLength: 1, maxLength: 300 }), groupId: t.String() }), { maxItems: 500 }) }) },
    );
}
