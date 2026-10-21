import type { PlatformRole } from "../../api/types";

export const PLATFORM_ROLE_OPTIONS = [
  { value: "", label: "None" },
  { value: "viewer", label: "Viewer: sees everything" },
  { value: "operator", label: "Operator: runs clusters and tenants" },
  { value: "admin", label: "Admin: everything, including users" },
];

export const roleLabel = (r: PlatformRole | null) => (r ? r[0]!.toUpperCase() + r.slice(1) : "—");
export const toRole = (v: string): PlatformRole | null => (v ? (v as PlatformRole) : null);
