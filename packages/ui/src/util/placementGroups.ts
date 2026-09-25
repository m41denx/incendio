// Placement groups on Incus. LXD has a placement-groups API; Incus instead
// lets one global Starlark scriptlet (instances.placement.scriptlet) choose
// where instances go. Incendio emulates LXD's groups with it:
//
// - a group is defined per project in project config:
//     user.placement-group.<name>.policy       spread | compact
//     user.placement-group.<name>.rigor        strict | permissive
//     user.placement-group.<name>.description
// - an instance (or a profile it uses) joins a group with user.placement.group
// - PLACEMENT_SCRIPTLET enforces the policy whenever Incus places an instance
//   automatically (create without a target, evacuation, relocation,
//   rebalance). It is generic: defining or changing groups never rewrites it.
import type { LxdInstance } from "types/instance";
import type { LxdProfile } from "types/profile";
import type { LxdPlacementGroup } from "types/placementGroup";

export const PLACEMENT_GROUP_KEY = "user.placement.group";
const DEF_PREFIX = "user.placement-group.";

export const PLACEMENT_SCRIPTLET_KEY = "instances.placement.scriptlet";
export const PLACEMENT_SCRIPTLET_VERSION = 1;
const MARKER = /^# incendio:placement-groups v(\d+)$/m;

// Dots would make the project config keys ambiguous.
export const PLACEMENT_GROUP_NAME = /^[A-Za-z0-9_-]+$/;

type Policy = LxdPlacementGroup["config"]["policy"];
type Rigor = LxdPlacementGroup["config"]["rigor"];

const defKey = (name: string, field: string) => `${DEF_PREFIX}${name}.${field}`;

/** Groups defined in a project's config, with what uses them. */
export const placementGroupsFromProject = (
  project: string,
  projectConfig: Record<string, string | undefined>,
  instances: Pick<LxdInstance, "name" | "config">[],
  profiles: Pick<LxdProfile, "name" | "config">[],
): LxdPlacementGroup[] => {
  const names = new Set<string>();
  for (const key of Object.keys(projectConfig)) {
    if (key.startsWith(DEF_PREFIX) && key.endsWith(".policy")) {
      names.add(key.slice(DEF_PREFIX.length, -".policy".length));
    }
  }
  const query = `?project=${encodeURIComponent(project)}`;
  return [...names].sort().map((name) => ({
    name,
    description: projectConfig[defKey(name, "description")] ?? "",
    config: {
      policy: (projectConfig[defKey(name, "policy")] ?? "spread") as Policy,
      rigor: (projectConfig[defKey(name, "rigor")] ?? "strict") as Rigor,
    },
    // Local config only: an instance inheriting the group from a profile is
    // accounted for through that profile (as LXD's used_by does).
    used_by: [
      ...instances
        .filter((i) => i.config[PLACEMENT_GROUP_KEY] === name)
        .map((i) => `/1.0/instances/${encodeURIComponent(i.name)}${query}`),
      ...profiles
        .filter((p) => p.config[PLACEMENT_GROUP_KEY] === name)
        .map((p) => `/1.0/profiles/${encodeURIComponent(p.name)}${query}`),
    ],
  }));
};

type Config = Record<string, string | undefined>;

/** Project config with `group` defined (or redefined). */
export const withPlacementGroup = (
  config: Config,
  group: Pick<LxdPlacementGroup, "name" | "description" | "config">,
): Config => ({
  ...withoutPlacementGroup(config, group.name),
  [defKey(group.name, "policy")]: group.config.policy,
  [defKey(group.name, "rigor")]: group.config.rigor,
  ...(group.description
    ? { [defKey(group.name, "description")]: group.description }
    : {}),
});

/** Project config without `name`'s definition. */
export const withoutPlacementGroup = (config: Config, name: string): Config =>
  Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !key.startsWith(`${DEF_PREFIX}${name}.`),
    ),
  );

export type ScriptletState = "none" | "current" | "outdated" | "custom";

/** Whether the installed scriptlet is ours, and up to date. */
export const placementScriptletState = (
  installed: string | undefined,
): ScriptletState => {
  if (!installed?.trim()) return "none";
  const match = MARKER.exec(installed);
  if (!match) return "custom";
  return Number(match[1]) >= PLACEMENT_SCRIPTLET_VERSION
    ? "current"
    : "outdated";
};

export const PLACEMENT_SCRIPTLET = `# incendio:placement-groups v${PLACEMENT_SCRIPTLET_VERSION}
#
# Managed by Incendio (Clustering > Placement). It enforces the placement
# groups defined in each project's config:
#   user.placement-group.<name>.policy   spread | compact
#   user.placement-group.<name>.rigor    strict | permissive
# for instances whose (profile-expanded) config sets user.placement.group.
# Edit the groups in Incendio rather than this scriptlet: it is replaced
# when Incendio updates it, and a custom scriptlet disables placement groups.

GROUP_KEY = "${PLACEMENT_GROUP_KEY}"
DEF_PREFIX = "${DEF_PREFIX}"

def _group_counts(project, group, name):
    # Members running instances of the group, other than the one being placed.
    counts = {}
    for inst in get_instances(project=project):
        if inst.name == name:
            continue
        config = inst.expanded_config or inst.config or {}
        if config.get(GROUP_KEY, "") == group:
            counts[inst.location] = counts.get(inst.location, 0) + 1
    return counts

def _least_loaded(members):
    return min(members, key=lambda m: get_instances_count(location=m, pending=True))

def instance_placement(request, candidate_members):
    config = request.config or {}
    group = config.get(GROUP_KEY, "")
    if not group or not candidate_members:
        return

    project = get_project(name=request.project)
    project_config = project.config or {}
    policy = project_config.get(DEF_PREFIX + group + ".policy", "")
    if policy not in ("spread", "compact"):
        log_warn("placement group ", group, " is not defined in project ", request.project, "; using the default placement")
        return
    strict = project_config.get(DEF_PREFIX + group + ".rigor", "strict") == "strict"

    # Never block an evacuation: moving off a member beats keeping the policy.
    # A rebalance, though, is optional: never let it break the policy.
    if request.reason == "evacuation":
        strict = False
    elif request.reason == "rebalance":
        strict = True

    counts = _group_counts(request.project, group, request.name)
    names = [m.server_name for m in candidate_members]

    if policy == "spread":
        fewest = min([counts.get(n, 0) for n in names])
        if fewest > 0 and strict:
            fail("placement group %s (spread, strict): every available cluster member already runs one of its instances" % group)
        set_target(_least_loaded([n for n in names if counts.get(n, 0) == fewest]))
        return

    # compact
    occupied = [n for n in names if counts.get(n, 0) > 0]
    if occupied:
        most = max([counts[n] for n in occupied])
        set_target(_least_loaded([n for n in occupied if counts[n] == most]))
        return
    if len(counts) == 0:
        # The group's first instance: Incus' default placement anchors it.
        return
    if strict:
        fail("placement group %s (compact, strict): the members running its instances are not available" % group)
`;
