import { incusClient } from "./incus.ts";
import type { Role } from "../constants.ts";

// Incus project metadata is the source of truth for "is this ours?" — never the
// project name (see docs/k8s/deploy-model.md §5). `user.*` keys are untouched by
// Incus, so we stamp our own namespaced keys and detect on them.
export const PROJECT_KEYS = {
  managed: "user.incendio.managed",
  role: "user.incendio.role",
  cluster: "user.incendio.cluster",
  k8sVersion: "user.incendio.k8s-version",
  operator: "user.incendio.operator",
} as const;

export interface ProjectMetadata {
  role: Role;
  /** Cluster this project hosts (for `management` projects, the mgmt cluster). */
  cluster: string;
  /** Pinned Kubernetes version, e.g. "v1.37.0". */
  k8sVersion?: string;
  /** Name of the operator VM that manages this project. */
  operator?: string;
}

/** Shape of an Incus project as returned by GET /1.0/projects?recursion=1. */
export interface IncusProject {
  name: string;
  description?: string;
  config?: Record<string, string>;
}

/** Build the `config` map for an incendio-managed project. */
export function buildProjectConfig(
  meta: ProjectMetadata,
): Record<string, string> {
  const config: Record<string, string> = {
    [PROJECT_KEYS.managed]: "true",
    [PROJECT_KEYS.role]: meta.role,
    [PROJECT_KEYS.cluster]: meta.cluster,
  };
  if (meta.k8sVersion) config[PROJECT_KEYS.k8sVersion] = meta.k8sVersion;
  if (meta.operator) config[PROJECT_KEYS.operator] = meta.operator;
  return config;
}

/** The detector: a project is ours iff `user.incendio.managed == "true"`. */
export function isManaged(project: IncusProject): boolean {
  return project.config?.[PROJECT_KEYS.managed] === "true";
}

/** Read incendio metadata off a project, or null if it is not ours/valid. */
export function readMetadata(project: IncusProject): ProjectMetadata | null {
  if (!isManaged(project)) return null;
  const config = project.config ?? {};
  const role = config[PROJECT_KEYS.role];
  if (role !== "management" && role !== "workload") return null;
  return {
    role,
    cluster: config[PROJECT_KEYS.cluster] ?? "",
    k8sVersion: config[PROJECT_KEYS.k8sVersion],
    operator: config[PROJECT_KEYS.operator],
  };
}

/** Cosmetic, human-friendly project name. Logic must never depend on this. */
export function suggestProjectName(role: Role, cluster: string): string {
  return role === "management" ? "incendio-mgmt" : `k8s-${cluster}`;
}

/**
 * List incendio-managed projects, optionally filtered by role. Detection is
 * purely metadata-based; names are ignored.
 */
export async function listManagedProjects(
  role?: Role,
): Promise<IncusProject[]> {
  const client = incusClient();
  const { data } = await client.get("/1.0/projects?recursion=1");
  const projects: IncusProject[] = data?.metadata ?? [];
  return projects.filter((p) => {
    if (!isManaged(p)) return false;
    if (role && p.config?.[PROJECT_KEYS.role] !== role) return false;
    return true;
  });
}

/** Fetch a single project by name, or null if it does not exist. */
export async function getProject(name: string): Promise<IncusProject | null> {
  const client = incusClient();
  try {
    const { data } = await client.get(
      `/1.0/projects/${encodeURIComponent(name)}`,
    );
    return (data?.metadata ?? null) as IncusProject | null;
  } catch (error: unknown) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Create an incendio-managed project (one per workload cluster, plus one for
 * the management plane). Deleting the project is our one-shot teardown: its
 * instances/networks/profiles go with it. Idempotent: returns silently if a
 * project with the same name already exists.
 */
export async function createProject(
  name: string,
  meta: ProjectMetadata,
): Promise<void> {
  if (await getProject(name)) return;
  const client = incusClient();
  await client.post("/1.0/projects", {
    name,
    description:
      `Incendio-managed ${meta.role} project` +
      (meta.cluster ? ` for cluster ${meta.cluster}` : ""),
    config: buildProjectConfig(meta),
  });
}

/** Delete a project (one-shot teardown). No-op if it does not exist. */
export async function deleteProject(name: string): Promise<void> {
  const client = incusClient();
  try {
    await client.delete(`/1.0/projects/${encodeURIComponent(name)}`);
  } catch (error: unknown) {
    if (isNotFound(error)) return;
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    (error as { response?: { status?: number } }).response?.status === 404
  );
}
