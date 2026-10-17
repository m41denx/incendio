/**
 * The privileges and built-in roles of IncusCloud's permissions (spec:
 * docs/superpowers/specs/2026-10-12-incuscloud-acl-design.md). Privileges are
 * `<object>.<action>`; roles are fixed sets of them, assigned on a path.
 */
export const PRIVILEGES = [
  "instance.view", "instance.console", "instance.exec", "instance.files", "instance.power", "instance.configure",
  "instance.snapshot", "instance.create", "instance.delete", "instance.migrate", "instance.relocate",
  "placement.choose",
  "storage.view", "storage.allocate", "storage.pools",
  "network.view", "network.use", "network.manage",
  "image.view", "image.manage",
  "project.view", "project.configure",
  "backup.view", "backup.create", "backup.restore", "backup.delete", "backup.schedule",
  "replication.view", "replication.manage",
  "k8s.view", "k8s.kubeconfig", "k8s.provision", "k8s.delete",
  "node.view", "node.maintain", "node.provision",
  "cluster.view", "cluster.configure",
  "tenant.view", "tenant.manage", "tenant.members", "tenant.quota",
  "acl.view", "acl.manage",
  "platform.view", "platform.users", "platform.settings", "platform.audit",
] as const;

export type Privilege = (typeof PRIVILEGES)[number];

export const ROLE_IDS = ["administrator", "operator", "cluster-owner", "group-owner", "unrestricted-user", "user", "tenant-admin", "auditor", "no-access"] as const;
export type RoleId = (typeof ROLE_IDS)[number];

export interface Role {
  name: string;
  privileges: ReadonlySet<Privilege>;
  /** Held only on what the subject owns (phase 2). */
  ownedOnly?: ReadonlySet<Privilege>;
}

const of = (prefix: string) => PRIVILEGES.filter((p) => p.startsWith(`${prefix}.`));
const all = (...groups: Array<readonly Privilege[] | Privilege>) => new Set<Privilege>(groups.flat());

const VIEWS = PRIVILEGES.filter((p) => p.endsWith(".view"));
/** What runs in projects: instances and what they use, backups, replication, Kubernetes. */
const WORKLOAD: Privilege[] = [
  ...of("instance"), "placement.choose", "storage.view", "storage.allocate", ...of("network"), ...of("image"),
  ...of("project"), ...of("backup"), ...of("replication"), ...of("k8s"),
];

export const ROLES: Record<RoleId, Role> = {
  administrator: { name: "Administrator", privileges: all(PRIVILEGES) },
  operator: { name: "Operator", privileges: all(PRIVILEGES.filter((p) => !["acl.manage", "platform.users", "platform.settings"].includes(p))) },
  "cluster-owner": { name: "Cluster owner", privileges: all(WORKLOAD, "storage.pools", of("node"), of("cluster"), of("acl")) },
  "group-owner": { name: "Group owner", privileges: all(WORKLOAD, "node.view", "node.maintain", "cluster.view", of("acl")) },
  "unrestricted-user": { name: "Unrestricted user", privileges: all(WORKLOAD, "cluster.view") },
  user: {
    name: "User",
    privileges: all("instance.create", "storage.view", "storage.allocate", "network.view", "network.use", "image.view", "project.view", "backup.create", "k8s.provision", "cluster.view", "tenant.view"),
    ownedOnly: all(of("instance"), of("backup"), of("k8s")),
  },
  "tenant-admin": { name: "Tenant admin", privileges: all(WORKLOAD, of("tenant"), of("acl"), "cluster.view") },
  auditor: { name: "Auditor", privileges: all(VIEWS, "platform.audit") },
  "no-access": { name: "No access", privileges: all() },
};

export const isRoleId = (s: string): s is RoleId => (ROLE_IDS as readonly string[]).includes(s);
