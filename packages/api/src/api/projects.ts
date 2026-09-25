import {
  Collection,
  EntityCollection,
  RenamableCollection,
} from "./base/collection";
import type { RequestContext, ScopeOptions } from "./base/types";
import type {
  Access,
  Operation,
  Profile,
  ProfilePut,
  ProfilesPost,
  Project,
  ProjectPut,
  ProjectState,
  ProjectsPost,
  Warning,
  WarningPut,
} from "./types/generated";
import type { Input } from "../utils/types";

/** `/1.0/projects` */
export class Projects extends Collection<
  Project,
  Input<ProjectsPost, "name">,
  ProjectPut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["projects"]);
  }

  // Projects are addressed by name; never scope the request to a project.
  protected override scope(opts?: ScopeOptions) {
    return { target: opts?.target };
  }

  /** Renames a project (async: every entity in it is updated). */
  async rename(name: string, newName: string): Promise<Operation> {
    return this.op("POST", this.url(name), { data: { name: newName } });
  }

  /**
   * Deletes a project. With `force` (API extension: `project_delete_force`)
   * everything inside it is deleted too.
   */
  override async delete(
    name: string,
    opts?: ScopeOptions & { force?: boolean },
  ): Promise<void> {
    await this.request("DELETE", this.url(name), {
      params: { force: opts?.force ? 1 : undefined },
    });
  }

  /** Resource usage against the project's limits. */
  async state(name: string): Promise<ProjectState> {
    return this.sync<ProjectState>("GET", this.url(name, "state"));
  }

  /** Who can access the project (API extension: `project_access`). */
  async access(name: string): Promise<Access> {
    return this.sync<Access>("GET", this.url(name, "access"));
  }
}

/** `/1.0/profiles` */
export class Profiles extends RenamableCollection<
  Profile,
  Input<ProfilesPost, "name">,
  ProfilePut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["profiles"]);
  }
}

/** `/1.0/warnings`, keyed by UUID. */
export class Warnings extends EntityCollection<Warning, WarningPut> {
  constructor(ctx: RequestContext) {
    super(ctx, ["warnings"]);
  }

  /** Marks a warning as acknowledged (or `new` again). */
  async acknowledge(
    uuid: string,
    status: "acknowledged" | "new" = "acknowledged",
  ): Promise<void> {
    await this.update(uuid, { status });
  }
}
