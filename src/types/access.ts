// Incus exposes a read-only "who can access" list on instances and projects
// (API extensions `instance_access` / `project_access`), returned by
// GET /1.0/instances/{name}/access and GET /1.0/projects/{name}/access.
export interface LxdAccessEntry {
  // Certificate fingerprint (or other identity identifier).
  identifier: string;
  // Role associated with the identity, e.g. admin, view, operator.
  role: string;
  // Authorization method the identity uses, e.g. tls, openfga.
  provider: string;
}
