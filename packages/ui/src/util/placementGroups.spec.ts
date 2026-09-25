import {
  PLACEMENT_SCRIPTLET,
  placementGroupsFromProject,
  placementScriptletState,
  withoutPlacementGroup,
  withPlacementGroup,
} from "./placementGroups";

const projectConfig = {
  "features.images": "true",
  "user.placement-group.web.policy": "spread",
  "user.placement-group.web.rigor": "strict",
  "user.placement-group.web.description": "front ends",
  "user.placement-group.db.policy": "compact",
  "user.placement-group.db.rigor": "permissive",
};

describe("placementGroupsFromProject", () => {
  it("reads the groups defined in project config, with what uses them", () => {
    const groups = placementGroupsFromProject(
      "prod",
      projectConfig,
      [
        { name: "web1", config: { "user.placement.group": "web" } },
        { name: "db1", config: {} },
      ],
      [{ name: "db-profile", config: { "user.placement.group": "db" } }],
    );
    expect(groups.map((g) => g.name)).toEqual(["db", "web"]);
    expect(groups[1]).toEqual({
      name: "web",
      description: "front ends",
      config: { policy: "spread", rigor: "strict" },
      used_by: ["/1.0/instances/web1?project=prod"],
    });
    expect(groups[0].used_by).toEqual([
      "/1.0/profiles/db-profile?project=prod",
    ]);
  });
});

describe("project config edits", () => {
  it("defines a group and drops an emptied description", () => {
    const config = withPlacementGroup(projectConfig, {
      name: "web",
      description: "",
      config: { policy: "compact", rigor: "permissive" },
    });
    expect(config["user.placement-group.web.policy"]).toBe("compact");
    expect(config["user.placement-group.web.rigor"]).toBe("permissive");
    expect(config).not.toHaveProperty("user.placement-group.web.description");
  });

  it("removes only the named group's keys", () => {
    const config = withoutPlacementGroup(projectConfig, "web");
    expect(Object.keys(config).sort()).toEqual([
      "features.images",
      "user.placement-group.db.policy",
      "user.placement-group.db.rigor",
    ]);
  });
});

describe("placementScriptletState", () => {
  it("tells ours from a custom scriptlet and from none", () => {
    expect(placementScriptletState(undefined)).toBe("none");
    expect(placementScriptletState("  \n")).toBe("none");
    expect(placementScriptletState(PLACEMENT_SCRIPTLET)).toBe("current");
    expect(
      placementScriptletState("def instance_placement(r, c):\n    return\n"),
    ).toBe("custom");
    expect(
      placementScriptletState("# incendio:placement-groups v0\ndef x(): pass"),
    ).toBe("outdated");
  });

  it("ships a scriptlet Incus can call", () => {
    expect(PLACEMENT_SCRIPTLET).toContain(
      "def instance_placement(request, candidate_members):",
    );
    expect(PLACEMENT_SCRIPTLET).toContain('GROUP_KEY = "user.placement.group"');
  });
});
