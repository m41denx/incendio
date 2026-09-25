import { describe, expect, test } from "bun:test";
import { IncusError, IncusOperationError } from "../../src/api/base/types";
import { tokenFromOperation } from "../../src/api/certificates";
import { async, error, mockClient, operation, sync } from "./mock";

describe("request scoping", () => {
  test("adds the default project and target", async () => {
    const { api, calls } = mockClient(
      { "GET /1.0/profiles/default": sync({ name: "default" }) },
      { project: "p1", target: "m1" },
    );
    await api.profiles.get("default");
    expect(calls[0]!.params).toEqual({ project: "p1", target: "m1" });
  });

  test("per-call scope overrides defaults; withProject re-scopes", async () => {
    const { api, calls } = mockClient(
      { "GET /1.0/profiles/x": sync({}) },
      { project: "p1" },
    );
    await api.profiles.get("x", { project: "p2" });
    await api.withProject("p3").profiles.get("x");
    expect(calls.map((c) => c.params.project)).toEqual(["p2", "p3"]);
  });

  test("list uses recursion=1, names parses URLs, all-projects drops project", async () => {
    const { api, calls } = mockClient(
      {
        "GET /1.0/instances": (call) =>
          call.params.recursion
            ? sync([{ name: "a" }])
            : sync(["/1.0/instances/a%2Fb?project=p1", "/1.0/instances/c"]),
      },
      { project: "p1" },
    );
    expect(await api.instances.list()).toEqual([{ name: "a" }] as never);
    expect(await api.instances.names()).toEqual(["a/b", "c"]);
    await api.instances.listFull({
      allProjects: true,
      type: "virtual-machine",
    });
    expect(calls[0]!.params.recursion).toBe(1);
    expect(calls[2]!.params).toEqual({
      recursion: 2,
      "all-projects": true,
      filter: "type eq virtual-machine",
    });
  });

  test("entity names are path-encoded", async () => {
    const { api, calls } = mockClient({
      "GET /1.0/images/aliases/debian%2F12": sync({ target: "abc" }),
    });
    await api.images.aliases.get("debian/12");
    expect(calls[0]!.url).toBe("/1.0/images/aliases/debian%2F12");
  });

  test("projects are never project-scoped", async () => {
    const { api, calls } = mockClient(
      { "GET /1.0/projects/foo": sync({ name: "foo" }) },
      { project: "p1" },
    );
    await api.projects.get("foo");
    expect(calls[0]!.params.project).toBeUndefined();
  });
});

describe("responses", () => {
  test("etag round trip", async () => {
    const { api, calls } = mockClient({
      "GET /1.0/networks/br0": sync({ name: "br0" }, { ETag: '"abc"' }),
      "PUT /1.0/networks/br0": sync({}),
    });
    const { data, etag } = await api.networks.getWithEtag("br0");
    expect(data.name).toBe("br0");
    expect(etag).toBe('"abc"');
    await api.networks.update("br0", { config: {}, description: "" }, { etag });
    expect(calls[1]!.headers["If-Match"]).toBe('"abc"');
  });

  test("async endpoints return the operation", async () => {
    const { api, calls } = mockClient({
      "PUT /1.0/instances/web/state": async("op1"),
    });
    const op = await api.instance("web").setState({ action: "start" });
    expect(op.id).toBe("op1");
    expect(calls[0]!.data).toEqual({ action: "start" });
  });

  test("maybe-async endpoints return null when sync", async () => {
    const { api } = mockClient({
      "POST /1.0/storage-pools/default/volumes/custom": sync(null),
    });
    const op = await api.storagePool("default").volumes.create({ name: "v" });
    expect(op).toBeNull();
  });

  test("errors become IncusError with status and message", async () => {
    const { api } = mockClient({
      "GET /1.0/instances/nope": error(404, "Instance not found"),
    });
    const err = await api
      .instance("nope")
      .get()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IncusError);
    expect((err as IncusError).message).toBe("Instance not found");
    expect((err as IncusError).isNotFound).toBe(true);
    expect(await api.profiles.exists("nope")).toBe(false);
  });
});

describe("operations", () => {
  test("wait long-polls until the operation is final", async () => {
    let polls = 0;
    const { api, calls } = mockClient({
      "GET /1.0/operations/op1/wait": () => {
        polls++;
        return sync(
          operation(
            "op1",
            polls < 3 ? {} : { status: "Success", status_code: 200 },
          ),
        );
      },
    });
    const op = await api.operations.wait("/1.0/operations/op1");
    expect(op.status).toBe("Success");
    expect(polls).toBe(3);
    expect(calls[0]!.params.timeout).toBe(30);
  });

  test("wait throws IncusOperationError on failure", async () => {
    const { api } = mockClient({
      "GET /1.0/operations/op1/wait": sync(
        operation("op1", { status: "Failure", status_code: 400, err: "boom" }),
      ),
    });
    const err = await api.operations.wait("op1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IncusOperationError);
    expect((err as Error).message).toBe("boom");
  });

  test("trust token encodes like the Go client", () => {
    const token = tokenFromOperation(
      operation("op1", {
        metadata: {
          request: { name: "laptop" },
          fingerprint: "fp",
          addresses: ["10.0.0.1:8443"],
          secret: "s3cr3t",
        },
      }) as never,
    );
    expect(JSON.parse(atob(token))).toEqual({
      client_name: "laptop",
      fingerprint: "fp",
      addresses: ["10.0.0.1:8443"],
      secret: "s3cr3t",
      expires_at: "0001-01-01T00:00:00Z",
    });
  });
});

describe("files", () => {
  test("directory listing and file content", async () => {
    const { api } = mockClient({
      "GET /1.0/instances/c1/files": (call) =>
        call.params.path === "/etc"
          ? {
              ...sync(["hostname", "hosts"]),
              headers: { "X-Incus-Type": "directory", "X-Incus-Mode": "0755" },
            }
          : {
              body: "c1\n",
              headers: {
                "X-Incus-Type": "file",
                "X-Incus-Uid": "0",
                "X-Incus-Gid": "0",
                "X-Incus-Mode": "0644",
              },
            },
    });
    const files = api.instance("c1").files;
    expect(await files.list("/etc")).toEqual(["hostname", "hosts"]);
    expect(await files.readText("/etc/hostname")).toBe("c1\n");
    const content = await files.get("/etc/hostname");
    expect(content.stat.mode).toBe(0o644);
  });

  test("write sends type, ownership and mode headers", async () => {
    const { api, calls } = mockClient({
      "POST /1.0/instances/c1/files": sync({}),
      "DELETE /1.0/instances/c1/files": sync({}),
    });
    await api
      .instance("c1")
      .files.write("/tmp/x", "hi", { mode: 0o600, uid: 1000 });
    await api.instance("c1").files.delete("/tmp/dir", { recursive: true });
    expect(calls[0]!.params.path).toBe("/tmp/x");
    expect(calls[0]!.headers).toMatchObject({
      "X-Incus-type": "file",
      "X-Incus-mode": "0600",
      "X-Incus-uid": "1000",
    });
    expect(calls[1]!.headers["X-Incus-force"]).toBe("true");
  });
});
