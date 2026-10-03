import type { AuthorizationModel } from "@openfga/sdk";
import {
  allRelations,
  classifyTuples,
  CLIENT_ROUTES,
  effectiveRoute,
  grantableRelations,
  objectName,
  objectType,
  parseSubject,
  subjectUser,
} from "./openfga";

const direct = [{ type: "user" }, { type: "group", relation: "member" }];

// Trimmed from Incus's driver_openfga_model.openfga.
const model: Pick<AuthorizationModel, "type_definitions"> = {
  type_definitions: [
    { type: "user" },
    {
      type: "group",
      relations: { member: { this: {} } },
      metadata: {
        relations: {
          member: { directly_related_user_types: [{ type: "user" }] },
        },
      },
    },
    {
      type: "server",
      relations: {
        admin: { this: {} },
        viewer: { this: {} },
        authenticated: { this: {} },
        can_create_projects: { this: {} },
        can_edit: { computedUserset: { relation: "admin" } },
      },
      metadata: {
        relations: {
          admin: { directly_related_user_types: direct },
          viewer: { directly_related_user_types: direct },
          authenticated: {
            directly_related_user_types: [{ type: "user", wildcard: {} }],
          },
          can_create_projects: { directly_related_user_types: direct },
          can_edit: {},
        },
      },
    },
    {
      type: "instance",
      relations: {
        project: { this: {} },
        can_exec: { this: {} },
        operator: { this: {} },
        admin: { this: {} },
        can_edit: { computedUserset: { relation: "operator" } },
      },
      metadata: {
        relations: {
          project: { directly_related_user_types: [{ type: "project" }] },
          can_exec: { directly_related_user_types: direct },
          operator: { directly_related_user_types: direct },
          admin: { directly_related_user_types: direct },
          can_edit: {},
        },
      },
    },
  ],
};

describe("grantableRelations", () => {
  it("lists relations users and groups can be given, roles first", () => {
    expect(grantableRelations(model)).toEqual({
      group: ["member"],
      server: ["admin", "viewer", "can_create_projects"],
      instance: ["admin", "operator", "can_exec"],
    });
  });

  it("lists every relation for checks", () => {
    expect(allRelations(model).instance).toEqual([
      "admin",
      "operator",
      "can_edit",
      "can_exec",
      "project",
    ]);
  });
});

describe("objects and subjects", () => {
  it("reads Incus object ids", () => {
    expect(objectType("instance:prod/web1")).toBe("instance");
    expect(objectName("instance:prod/web1")).toBe("prod / web1");
    expect(objectName("storage_volume:p/pool/custom/a%2Fb")).toBe(
      "p / pool / custom / a/b",
    );
    expect(objectName("project:default")).toBe("default");
  });

  it("parses users and groups", () => {
    expect(parseSubject("user:alice@example.com")).toEqual({
      kind: "user",
      name: "alice@example.com",
    });
    expect(parseSubject("group:devs#member")).toEqual({
      kind: "group",
      name: "devs",
    });
    expect(parseSubject("user:*")).toBeNull();
    expect(parseSubject("project:default")).toBeNull();
    expect(subjectUser({ kind: "group", name: "devs" })).toBe(
      "group:devs#member",
    );
  });
});

describe("classifyTuples", () => {
  it("splits grants, memberships and the objects Incus synced", () => {
    const state = classifyTuples(
      [
        { user: "user:*", relation: "authenticated", object: "server:incus" },
        { user: "server:incus", relation: "server", object: "project:prod" },
        {
          user: "project:prod",
          relation: "project",
          object: "instance:prod/web1",
        },
        { user: "user:bob", relation: "member", object: "group:devs" },
        { user: "user:alice", relation: "admin", object: "server:incus" },
        {
          user: "group:devs#member",
          relation: "can_exec",
          object: "instance:prod/web1",
        },
      ],
      grantableRelations(model),
    );
    expect(state.grants).toEqual([
      { user: "user:alice", relation: "admin", object: "server:incus" },
      {
        user: "group:devs#member",
        relation: "can_exec",
        object: "instance:prod/web1",
      },
    ]);
    expect(state.memberships).toEqual([
      { user: "user:bob", relation: "member", object: "group:devs" },
    ]);
    expect(state.objects).toEqual({
      server: ["server:incus"],
      project: ["project:prod"],
      instance: ["instance:prod/web1"],
    });
    expect(state.users).toEqual(["alice", "bob"]);
    expect(state.groups).toEqual(["devs"]);
  });
});

describe("effectiveRoute", () => {
  const route = (key: string) => {
    const found = CLIENT_ROUTES.find((r) => r.key === key);
    if (!found) throw new Error(key);
    return found;
  };

  it("follows Incus's routing order", () => {
    expect(effectiveRoute(route("oidc"), {})).toBe("allow");
    expect(effectiveRoute(route("tls-restricted"), {})).toBe("tls");
    expect(
      effectiveRoute(route("oidc"), { "authorization.client.default": "deny" }),
    ).toBe("deny");
    expect(
      effectiveRoute(route("oidc"), {
        "authorization.client.default": "deny",
        "authorization.client.oidc": "openfga",
      }),
    ).toBe("openfga");
    expect(effectiveRoute(route("default"), {})).toBe("deny");
  });
});
