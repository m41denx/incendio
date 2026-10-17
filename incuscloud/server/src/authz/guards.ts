import type { Principal } from "../auth/principal.ts";
import type { Acl } from "../acl/acl.ts";
import type { Privilege } from "../acl/catalog.ts";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.ts";
import { tenants } from "../db/schema.ts";
import { ApiError } from "../lib/errors.ts";
import { isUuid } from "../api/common.ts";

export const subject = (p: Principal) => `user:${p.id}`;

export const forbidden = () => new ApiError(403, "forbidden", "You do not have permission to do this");
export const notFound = (what = "Not found") => new ApiError(404, "not_found", what);

/** 404 unless the principal may see `path`, then 403 unless it holds the privilege there. */
export async function needPriv(acl: Acl, p: Principal, privilege: Privilege, path: string, what = "Not found"): Promise<void> {
  if (!(await acl.sees(p, path))) throw notFound(what);
  if (!(await acl.can(p, privilege, path))) throw forbidden();
}


/** A tenant's permission path: 404 unless the principal may see the tenant, then 403 unless it holds `privilege` there. */
export async function needTenant(db: Db, acl: Acl, p: Principal, tenantId: string, privilege: Privilege = "tenant.view"): Promise<string> {
  const [row] = isUuid(tenantId) ? await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId)) : [];
  const path = row && `/tenants/${row.slug}`;
  if (!path || !(await acl.can(p, "tenant.view", path))) throw notFound();
  if (!(await acl.can(p, privilege, path))) throw forbidden();
  return path;
}
