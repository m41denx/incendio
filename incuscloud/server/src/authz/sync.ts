import { PLATFORM, type Tuple } from "./platform.ts";

/**
 * Role changes as tuples. Nothing stores them any more: writing them through
 * `Authz.write` tells the ACL to re-read the database.
 */
export const tuples = {
  platformRole: (subjectId: string, role: string): Tuple => ({ user: `user:${subjectId}`, relation: role, object: PLATFORM }),
  tenant: (tenantId: string): Tuple => ({ user: PLATFORM, relation: "platform", object: `tenant:${tenantId}` }),
  member: (tenantId: string, subjectId: string, role: string): Tuple => ({ user: `user:${subjectId}`, relation: role, object: `tenant:${tenantId}` }),
  cluster: (clusterId: string): Tuple => ({ user: PLATFORM, relation: "platform", object: `cluster:${clusterId}` }),
  placement: (tenantId: string, clusterId: string): Tuple => ({ user: `tenant:${tenantId}`, relation: "tenant", object: `cluster:${clusterId}` }),
};
