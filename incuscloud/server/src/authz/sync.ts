import type { Db } from "../db/index.ts";
import { clusters, placements, platformRoles, serviceAccounts, tenantMembers, tenants } from "../db/schema.ts";
import { PLATFORM, type Authz, type Tuple } from "./platform.ts";

/**
 * The database is the source of truth; OpenFGA holds its projection.
 * These map database facts to tuples, for both live writes and resync.
 */
export const tuples = {
  platformRole: (subjectId: string, role: string): Tuple => ({ user: `user:${subjectId}`, relation: role, object: PLATFORM }),
  tenant: (tenantId: string): Tuple => ({ user: PLATFORM, relation: "platform", object: `tenant:${tenantId}` }),
  member: (tenantId: string, subjectId: string, role: string): Tuple => ({ user: `user:${subjectId}`, relation: role, object: `tenant:${tenantId}` }),
  cluster: (clusterId: string): Tuple => ({ user: PLATFORM, relation: "platform", object: `cluster:${clusterId}` }),
  placement: (tenantId: string, clusterId: string): Tuple => ({ user: `tenant:${tenantId}`, relation: "tenant", object: `cluster:${clusterId}` }),
};

/** Writes every tuple the database implies (additive; P3's reconciler also removes strays). */
export async function syncAll(db: Db, authz: Authz): Promise<number> {
  const all: Tuple[] = [
    ...(await db.select().from(platformRoles)).map((r) => tuples.platformRole(r.userId, r.role)),
    ...(await db.select().from(tenants)).map((t) => tuples.tenant(t.id)),
    ...(await db.select().from(tenantMembers)).map((m) => tuples.member(m.tenantId, m.userId, m.role)),
    ...(await db.select().from(serviceAccounts)).flatMap((s) => [
      ...(s.tenantId ? [tuples.member(s.tenantId, s.id, "member")] : []),
      ...(s.platformRole ? [tuples.platformRole(s.id, s.platformRole)] : []),
    ]),
    ...(await db.select().from(clusters)).map((c) => tuples.cluster(c.id)),
    ...(await db.select().from(placements)).map((p) => tuples.placement(p.tenantId, p.clusterId)),
  ];
  for (let i = 0; i < all.length; i += 50) await authz.write(all.slice(i, i + 50));
  return all.length;
}
