import { ROLES, type Privilege, type RoleId } from "./catalog.ts";

/** One ACL entry: a role for a subject on a path. Virtual entries come from today's role tables. */
export interface Entry {
  id: string;
  path: string;
  /** `user:<id>`, `service:<id>` (later `group:<id>`). */
  subject: string;
  role: RoleId;
  propagate: boolean;
  source: "acl" | "platform-role" | "tenant-membership" | "service-account";
}

/**
 * Proxmox's resolution: walking the chain from the most specific path, the
 * first level holding an entry for one of the subject's keys decides; its
 * roles are combined. At that level the subject's own entries (its first
 * key) beat its groups', and No access among them means nothing. Entries
 * on ancestors count only when they propagate.
 */
export function resolve(subjects: string[], entriesByPath: Map<string, Entry[]>, chain: string[]): { privileges: Set<Privilege>; decidedBy: Entry[] } {
  const keys = new Set(subjects);
  for (const [i, path] of chain.entries()) {
    let here = (entriesByPath.get(path) ?? []).filter((e) => keys.has(e.subject) && (i === 0 || e.propagate));
    if (!here.length) continue;
    const own = here.filter((e) => e.subject === subjects[0]);
    if (own.length) here = own;
    const privileges = new Set<Privilege>();
    // No access there means nothing (spec "Resolution" 2).
    if (!here.some((e) => e.role === "no-access")) for (const e of here) for (const p of ROLES[e.role].privileges) privileges.add(p);
    return { privileges, decidedBy: here };
  }
  return { privileges: new Set(), decidedBy: [] };
}
