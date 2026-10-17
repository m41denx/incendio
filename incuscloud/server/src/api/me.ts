import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { tenantMembers, tenants } from "../db/schema.ts";
import { authed, principalContext } from "../auth/principal.ts";
import type { Acl } from "../acl/acl.ts";

/** GET /api/v1/me: the caller, their platform role, privileges on / and tenants, and what the UI needs to build cluster URLs. */
export const meRoutes = ({ db, acl, clusterDomain, publicUrl }: { db: Db; acl: Acl; clusterDomain: string; publicUrl: string }) =>
  new Elysia({ name: "me" }).use(principalContext).get("/api/v1/me", async ({ principal }) => {
    const p = authed(principal);
    const memberships =
      p.kind === "user"
        ? await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name, role: tenantMembers.role }).from(tenantMembers).innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId)).where(eq(tenantMembers.userId, p.id)).orderBy(tenants.slug)
        : p.tenantId
          ? (await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants).where(eq(tenants.id, p.tenantId))).map((t) => ({ ...t, role: "member" }))
          : [];
    const rootPrivileges = [...(await acl.privileges(p, "/"))].sort();
    return { id: p.id, kind: p.kind, email: p.email, name: p.name, platformRole: p.platformRole ?? null, rootPrivileges, tenants: memberships, clusterDomain, publicUrl };
  });
