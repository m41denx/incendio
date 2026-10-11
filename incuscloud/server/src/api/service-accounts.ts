import { Elysia, t } from "elysia";
import { eq, inArray, or } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { serviceAccounts, tenants } from "../db/schema.ts";
import type { Authz } from "../authz/platform.ts";
import { tuples } from "../authz/sync.ts";
import { forbidden, needVisible, notFound, platformCan, subject } from "../authz/guards.ts";
import { authed, principalContext, type Principal } from "../auth/principal.ts";
import type { HydraAdminApi, OAuth2Client } from "../identity/hydra-admin.ts";
import { AUDIENCE } from "../identity/routes.ts";
import { ApiError } from "../lib/errors.ts";
import { randomToken } from "../lib/secrets.ts";
import { audited, created, noContent, uuidParam } from "./common.ts";
import { requestReconcile } from "../reconcile/requests.ts";

/** Clusters whose grants name this account. */
const affected = (sa: { tenantId: string | null; platformRole: string | null }) => (sa.tenantId ? { tenant: sa.tenantId } : sa.platformRole ? ("all" as const) : null);

type SaRow = typeof serviceAccounts.$inferSelect;
const view = (s: SaRow) => ({ id: s.id, name: s.name, clientId: s.clientId, tenantId: s.tenantId, platformRole: s.platformRole, disabled: s.disabled, createdBy: s.createdBy, createdAt: s.createdAt });

const hydraClient = (s: Pick<SaRow, "clientId" | "name">, secret: string): OAuth2Client => ({
  client_id: s.clientId,
  client_name: `Service account ${s.name}`,
  client_secret: secret,
  grant_types: ["client_credentials"],
  response_types: [],
  token_endpoint_auth_method: "client_secret_basic",
  audience: [AUDIENCE],
  access_token_strategy: "jwt",
  scope: "",
  metadata: { first_party: true, service_account: true },
});

const satuples = (s: Pick<SaRow, "id" | "tenantId" | "platformRole">) => [
  ...(s.tenantId ? [tuples.member(s.tenantId, s.id, "member")] : []),
  ...(s.platformRole ? [tuples.platformRole(s.id, s.platformRole)] : []),
];

/** Service accounts: Hydra client_credentials clients whose tokens act as the account (spec D3). */
export function serviceAccountsRoutes({ db, authz, hydra, hydraPublicUrl }: { db: Db; authz: Authz; hydra: HydraAdminApi; hydraPublicUrl: string }) {
  const tokenUrl = `${hydraPublicUrl}/oauth2/token`;

  /** Who manages an account: tenant admins for tenant accounts, platform admins otherwise. */
  const load = async (p: Principal, id: string) => {
    const [sa] = await db.select().from(serviceAccounts).where(eq(serviceAccounts.id, uuidParam(id)));
    if (!sa) throw notFound();
    if (sa.tenantId) await needVisible(authz, p, "admin", "admin", `tenant:${sa.tenantId}`).catch(async (e) => {
      if (await platformCan(authz, p, "viewer")) throw forbidden();
      throw e;
    });
    else if (!(await platformCan(authz, p, "admin"))) throw (await platformCan(authz, p, "viewer")) ? forbidden() : notFound();
    return sa;
  };

  return new Elysia({ name: "service-accounts" })
    .use(principalContext)
    .get("/api/v1/service-accounts", async ({ principal }) => {
      const p = authed(principal);
      if (await platformCan(authz, p, "viewer")) return (await db.select().from(serviceAccounts).orderBy(serviceAccounts.name)).map(view);
      const adminOf = (await authz.listObjects(subject(p), "admin", "tenant")).map((o) => o.slice("tenant:".length));
      if (!adminOf.length) return [];
      return (await db.select().from(serviceAccounts).where(or(inArray(serviceAccounts.tenantId, adminOf))).orderBy(serviceAccounts.name)).map(view);
    })
    .post(
      "/api/v1/service-accounts",
      async ({ principal, request, body, set }) => {
        const p = authed(principal);
        const res = await audited(db, { principal: p, request }, "service_account.create", (r) => r && { type: "service_account", id: r.id }, async () => {
          if (body.tenantId) {
            if (body.platformRole) throw new ApiError(400, "invalid_request", "Tenant service accounts cannot have a platform role");
            await needVisible(authz, p, "viewer", "admin", `tenant:${uuidParam(body.tenantId)}`);
            if (!(await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, body.tenantId))).length) throw notFound();
          } else if (!(await platformCan(authz, p, "admin"))) {
            throw forbidden();
          }
          const id = crypto.randomUUID();
          const secret = randomToken(32);
          const res = await db.transaction(async (tx) => {
            const [sa] = await tx
              .insert(serviceAccounts)
              .values({ id, name: body.name, clientId: `sa-${id}`, tenantId: body.tenantId ?? null, platformRole: body.platformRole ?? null, createdBy: p.kind === "user" ? p.id : null })
              .returning();
            await hydra.createClient(hydraClient(sa!, secret));
            await authz.write(satuples(sa!));
            return { ...view(sa!), clientSecret: secret, tokenUrl };
          });
          const target = affected({ tenantId: body.tenantId ?? null, platformRole: body.platformRole ?? null });
          if (target) await requestReconcile(db, target);
          return res;
        }, (r) => ({ serviceAccountId: r.id, tenantId: r.tenantId }));
        return created(set, res);
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 100 }),
          tenantId: t.Optional(t.String()),
          platformRole: t.Optional(t.Union([t.Literal("admin"), t.Literal("operator"), t.Literal("viewer")])),
        }),
      },
    )
    .post("/api/v1/service-accounts/:id/rotate", async ({ principal, request, params }) => {
      const p = authed(principal);
      return audited(db, { principal: p, request }, "service_account.rotate", { type: "service_account", id: params.id }, async () => {
        const sa = await load(p, params.id);
        const secret = randomToken(32);
        await hydra.updateClient(hydraClient(sa, secret));
        return { ...view(sa), clientSecret: secret, tokenUrl };
      }, (r) => ({ tenantId: r.tenantId }));
    })
    .delete("/api/v1/service-accounts/:id", async ({ principal, request, params, set }) => {
      const p = authed(principal);
      await audited(db, { principal: p, request }, "service_account.delete", { type: "service_account", id: params.id }, async () => {
        const sa = await load(p, params.id);
        await db.transaction(async (tx) => {
          await tx.delete(serviceAccounts).where(eq(serviceAccounts.id, sa.id));
          await hydra.deleteClient(sa.clientId);
          await authz.write([], satuples(sa));
        });
        const target = affected(sa);
        if (target) await requestReconcile(db, target);
      });
      return noContent(set);
    });
}
