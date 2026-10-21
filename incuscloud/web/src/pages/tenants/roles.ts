import type { TenantRole } from "../../api/types";

export const roleName = (r: TenantRole) => r[0]!.toUpperCase() + r.slice(1);

export const TENANT_ROLE_HELP: Record<TenantRole, string> = {
  owner: "Owner: everything, including owners and deleting the tenant",
  admin: "Admin: members, service accounts and logs",
  member: "Member: uses the tenant's projects",
  viewer: "Viewer: sees the tenant's projects",
};

/** Roles the caller may hand out: owners only by owners (and platform admins). */
export const assignableRoles = (ownerPower: boolean): TenantRole[] => (ownerPower ? ["owner", "admin", "member", "viewer"] : ["admin", "member", "viewer"]);
