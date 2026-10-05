import type { AuthorizationModel, TupleKey } from "@openfga/sdk";

/**
 * Reading the OpenFGA store Incus keeps. Incus writes the authorization model
 * and one tuple per object linking it to its parent (`project:p project
 * instance:p/web1`, `server:incus server project:p`). Admins add the grants:
 * tuples from `user:<name>` or `group:<name>#member` to a relation the model
 * lets them assign directly. Pure helpers; the client is in api/openfga.ts.
 */

export interface FgaTuple {
  user: string;
  relation: string;
  object: string;
}

export const SERVER_OBJECT = "server:incus";

// Roles before the can_* entitlements, strongest first.
const ROLE_ORDER = ["admin", "operator", "user", "viewer", "member"];

const sortRelations = (relations: string[]): string[] =>
  [...relations].sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a);
    const rb = ROLE_ORDER.indexOf(b);
    if (ra >= 0 || rb >= 0) {
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
    }
    return a.localeCompare(b);
  });

/**
 * Relations users and groups can be granted on each object type: those whose
 * directly related types include `user` (not the `user:*` wildcard) or
 * `group#member`. Structural relations (project, server, shared_with) and the
 * `authenticated` wildcard are left out by that rule.
 */
export const grantableRelations = (
  model: Pick<AuthorizationModel, "type_definitions">,
): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  for (const definition of model.type_definitions) {
    if (definition.type === "user") {
      continue;
    }
    const relations = Object.entries(definition.metadata?.relations ?? {})
      .filter(([, meta]) =>
        (meta.directly_related_user_types ?? []).some(
          (ref) =>
            (ref.type === "user" && !ref.relation && !ref.wildcard) ||
            (ref.type === "group" && ref.relation === "member"),
        ),
      )
      .map(([name]) => name);
    if (relations.length > 0) {
      result[definition.type] = sortRelations(relations);
    }
  }
  return result;
};

/** Every relation of each type, for checks (includes computed ones like can_edit). */
export const allRelations = (
  model: Pick<AuthorizationModel, "type_definitions">,
): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  for (const definition of model.type_definitions) {
    const relations = Object.keys(definition.relations ?? {});
    if (relations.length > 0) {
      result[definition.type] = sortRelations(relations);
    }
  }
  return result;
};

// Incus escapes "/" in object ids (authorization_objects.go), user names too.
const escape = (s: string) => s.replaceAll("/", "%2F");
const unescape = (s: string) => s.replaceAll("%2F", "/");

export const objectType = (object: string): string =>
  object.slice(0, Math.max(object.indexOf(":"), 0));

/** Readable name of an Incus object: `instance:prod/web%2F1` → `prod / web/1`. */
export const objectName = (object: string): string => {
  const id = object.slice(object.indexOf(":") + 1);
  return id.split("/").map(unescape).join(" / ");
};

export type SubjectKind = "user" | "group";

export interface Subject {
  kind: SubjectKind;
  name: string;
}

/** `user:alice` → user alice, `group:devs#member` → group devs; others null. */
export const parseSubject = (user: string): Subject | null => {
  if (user.startsWith("user:") && user !== "user:*") {
    return { kind: "user", name: unescape(user.slice("user:".length)) };
  }
  const group = /^group:(.+)#member$/.exec(user);
  if (group) {
    return { kind: "group", name: group[1] };
  }
  return null;
};

export const subjectUser = (subject: Subject): string =>
  subject.kind === "user"
    ? `user:${escape(subject.name)}`
    : `group:${subject.name}#member`;

export interface FgaState {
  /** User and group grants on Incus objects. */
  grants: FgaTuple[];
  /** `user:x member group:y` tuples. */
  memberships: FgaTuple[];
  /** Objects Incus synced, by type. */
  objects: Record<string, string[]>;
  /** Names seen in grants and memberships, for suggestions. */
  users: string[];
  groups: string[];
}

/** Sort the store's tuples into grants, group memberships and known objects. */
export const classifyTuples = (
  tuples: Pick<TupleKey, "user" | "relation" | "object">[],
  grantable: Record<string, string[]>,
): FgaState => {
  const grants: FgaTuple[] = [];
  const memberships: FgaTuple[] = [];
  const objects = new Map<string, Set<string>>([
    ["server", new Set([SERVER_OBJECT])],
  ]);
  const users = new Set<string>();
  const groups = new Set<string>();

  const addObject = (object: string) => {
    const type = objectType(object);
    if (!type || type === "group" || type === "user") {
      return;
    }
    if (!objects.has(type)) {
      objects.set(type, new Set());
    }
    objects.get(type)?.add(object);
  };

  for (const { user, relation, object } of tuples) {
    const type = objectType(object);
    const subject = parseSubject(user);
    if (type === "group" && relation === "member" && subject) {
      memberships.push({ user, relation, object });
      groups.add(objectName(object));
      if (subject.kind === "user") {
        users.add(subject.name);
      }
      continue;
    }
    if (subject && grantable[type]?.includes(relation)) {
      grants.push({ user, relation, object });
      (subject.kind === "user" ? users : groups).add(subject.name);
      addObject(object);
      continue;
    }
    // Structure Incus wrote: the object and its parent are both real.
    if (user.startsWith("server:") || user.startsWith("project:")) {
      addObject(object);
      addObject(user);
    }
  }

  const sortedObjects: Record<string, string[]> = {};
  for (const [type, set] of objects) {
    sortedObjects[type] = [...set].sort((a, b) =>
      objectName(a).localeCompare(objectName(b)),
    );
  }

  return {
    grants,
    memberships,
    objects: sortedObjects,
    users: [...users].sort(),
    groups: [...groups].sort(),
  };
};

export const tupleKey = (t: FgaTuple): string =>
  `${t.user}|${t.relation}|${t.object}`;

// ---- server configuration -------------------------------------------------

export const AUTHORIZATION_DRIVERS = [
  "allow",
  "deny",
  "tls",
  "openfga",
  "scriptlet",
] as const;

export interface ClientRoute {
  /** Suffix of the authorization.client.* key. */
  key: "unix" | "tls" | "tls-restricted" | "oidc" | "default";
  label: string;
  /** Incus's built-in route when neither this key nor default is set. */
  builtin: string;
  drivers: readonly string[];
}

export const CLIENT_ROUTES: ClientRoute[] = [
  {
    key: "oidc",
    label: "OIDC (SSO) users",
    builtin: "allow",
    drivers: ["allow", "deny", "openfga", "scriptlet"],
  },
  {
    key: "tls",
    label: "Trusted TLS certificates",
    builtin: "allow",
    drivers: ["allow", "deny", "openfga", "scriptlet"],
  },
  {
    key: "tls-restricted",
    label: "Project-restricted TLS certificates",
    builtin: "tls",
    drivers: ["allow", "deny", "tls", "openfga", "scriptlet"],
  },
  {
    key: "unix",
    label: "Local unix socket (non-root)",
    builtin: "allow",
    drivers: ["allow", "deny", "openfga", "scriptlet"],
  },
  {
    key: "default",
    label: "Default for unset rows and other clients",
    builtin: "deny",
    drivers: ["allow", "deny", "openfga", "scriptlet"],
  },
];

/**
 * The driver a client class ends up with, as Incus resolves it
 * (internal/server/auth/router.go): its own key, else
 * authorization.client.default, else the built-in route.
 */
export const effectiveRoute = (
  route: ClientRoute,
  config: Record<string, string | undefined>,
): string => {
  const own = config[`authorization.client.${route.key}`];
  if (own) {
    return own;
  }
  if (route.key === "default") {
    return route.builtin;
  }
  return config["authorization.client.default"] || route.builtin;
};

/** `storage_volume` → `Storage volume`. */
export const typeLabel = (type: string): string => {
  const words = type.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

// What the four roles give (driver_openfga_model.openfga). Roles on the
// server and on a project also apply to everything inside them.
export const ROLE_HELP: Record<string, string> = {
  admin: "Full control, including deleting and project or server settings.",
  operator: "Create and change resources, start and stop, snapshots, backups.",
  user: "Use resources: console, exec, files and file transfer.",
  viewer: "Read-only access.",
  member: "Member of the group.",
};

// Starting points for authorization.scriptlet. Incus calls
// authorize(details, object, entitlement) for every check; object is like
// "project:default" or "instance:default/c1", entitlement like "can_view".
// details has Username (the certificate fingerprint for TLS clients),
// Protocol, ProjectName, IsAllProjectsRequest, Certificate, Chain and, from
// Incus 7.5 (authorization_scriptlet_claims), Claims: the validated OIDC
// token claims, empty for other clients.
export const SCRIPTLET_EXAMPLE_CLAIMS = `# OIDC users decided by their token's "groups" claim.
def authorize(details, object, entitlement):
    groups = details.Claims.get("groups", [])
    if "incus-admins" in groups:
        return True

    # Members of incus-dev get everything in the dev project, and may read
    # the server itself (the UI needs that to load).
    if "incus-dev" in groups:
        if object == "server:incus":
            return entitlement == "can_view"

        # Project objects look like "instance:dev/c1" or "profile:dev/default".
        return object == "project:dev" or object.partition(":")[2].startswith("dev/")

    return False
`;

export const SCRIPTLET_EXAMPLE_USERNAME = `# Clients decided by name: TLS clients by certificate name, OIDC users by
# their user name (the claim set in oidc.claim, else email).
ADMINS = ["alice@example.com", "my-laptop"]

def authorize(details, object, entitlement):
    # For TLS clients, details.Username is the certificate fingerprint.
    if details.Certificate:
        return details.Certificate.name in ADMINS

    return details.Username in ADMINS
`;
