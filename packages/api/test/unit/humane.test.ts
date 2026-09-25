import { describe, expect, test } from "bun:test";
import {
  applyConfig,
  formatSize,
  imageSource,
  parseSize,
} from "../../src/utils/helpers";
import { async, mockClient, operation, sync } from "./mock";

const instance = (extra: Record<string, unknown> = {}) => ({
  name: "web",
  project: "default",
  type: "container",
  status: "Stopped",
  status_code: 102,
  architecture: "aarch64",
  config: { "limits.cpu": "1" },
  devices: {},
  profiles: ["default"],
  ephemeral: false,
  stateful: false,
  description: "",
  created_at: "2026-01-01T00:00:00Z",
  last_used_at: "0001-01-01T00:00:00Z",
  location: "none",
  ...extra,
});

const done = (id: string, extra: Record<string, unknown> = {}) =>
  sync(operation(id, { status: "Success", status_code: 200, ...extra }));

describe("helpers", () => {
  test("imageSource", () => {
    expect(imageSource("images:debian/12")).toEqual({
      type: "image",
      mode: "pull",
      server: "https://images.linuxcontainers.org",
      protocol: "simplestreams",
      alias: "debian/12",
    });
    expect(imageSource("2afeb169b21d")).toEqual({
      type: "image",
      fingerprint: "2afeb169b21d",
    });
    expect(imageSource("alpine")).toEqual({ type: "image", alias: "alpine" });
    expect(imageSource(null)).toEqual({ type: "none" });
    expect(() => imageSource("nope:x")).toThrow(/Unknown image remote/);
  });

  test("sizes", () => {
    expect(parseSize("10GiB")).toBe(10 * 1024 ** 3);
    expect(parseSize("1GB")).toBe(1e9);
    expect(parseSize("512")).toBe(512);
    expect(formatSize(10 * 1024 ** 3)).toBe("10GiB");
    expect(formatSize(1500)).toBe("1500B");
  });

  test("applyConfig sets and unsets", () => {
    expect(applyConfig({ a: "1", b: "2" }, { a: null, c: 3, d: true })).toEqual(
      {
        b: "2",
        c: "3",
        d: "true",
      },
    );
  });
});

describe("Instance", () => {
  test("createInstance resolves the image, waits and loads the instance", async () => {
    const { client, calls } = mockClient({
      "POST /1.0/instances": async("op1"),
      "GET /1.0/operations/op1/wait": done("op1"),
      "GET /1.0/instances/web": sync(
        instance({ status: "Running", state: null }),
      ),
    });
    const web = await client.launchInstance({
      name: "web",
      image: "images:alpine/edge",
      type: "vm",
    });
    expect(calls[0]!.data).toMatchObject({
      name: "web",
      type: "virtual-machine",
      start: true,
      source: {
        type: "image",
        alias: "alpine/edge",
        protocol: "simplestreams",
      },
    });
    expect(web.isRunning).toBe(true);
    expect(web.lastUsedAt).toBeNull();
  });

  test("start changes state and refreshes", async () => {
    let status = "Stopped";
    const { client, calls } = mockClient({
      "GET /1.0/instances/web": () => sync(instance({ status })),
      "PUT /1.0/instances/web/state": () => {
        status = "Running";
        return async("op2");
      },
      "GET /1.0/operations/op2/wait": done("op2"),
    });
    const web = await client.getInstance("web");
    await web.start();
    expect(web.isRunning).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /1.0/instances/web",
      "PUT /1.0/instances/web/state",
      "GET /1.0/operations/op2/wait",
      "GET /1.0/instances/web",
    ]);
  });

  test("setConfig does a conflict-safe GET+PUT with the ETag", async () => {
    const { client, calls } = mockClient({
      "GET /1.0/instances/web": sync(instance(), { ETag: "e1" }),
      "PUT /1.0/instances/web": async("op3"),
      "GET /1.0/operations/op3/wait": done("op3"),
    });
    const web = await client.getInstance("web");
    await web.setConfig({ "limits.cpu": null, "limits.memory": "1GiB" });
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.headers["If-Match"]).toBe("e1");
    expect((put.data as { config: unknown }).config).toEqual({
      "limits.memory": "1GiB",
    });
  });

  test("exec collects recorded output and cleans it up", async () => {
    const { client, calls } = mockClient({
      "GET /1.0/instances/web": sync(instance({ status: "Running" })),
      "POST /1.0/instances/web/exec": async("op4"),
      "GET /1.0/operations/op4/wait": done("op4", {
        metadata: {
          return: 3,
          output: {
            "1": "/1.0/instances/web/logs/exec-output/exec_op4.stdout",
            "2": "/1.0/instances/web/logs/exec-output/exec_op4.stderr",
          },
        },
      }),
      "GET /1.0/instances/web/logs/exec-output/exec_op4.stdout": {
        body: "out",
      },
      "GET /1.0/instances/web/logs/exec-output/exec_op4.stderr": {
        body: "err",
      },
      "DELETE /1.0/instances/web/logs/exec-output/exec_op4.stdout": sync({}),
      "DELETE /1.0/instances/web/logs/exec-output/exec_op4.stderr": sync({}),
    });
    const web = await client.getInstance("web");
    const result = await web.exec(["false"], { cwd: "/root" });
    expect(result).toEqual({ exitCode: 3, stdout: "out", stderr: "err" });
    expect(calls[1]!.data).toMatchObject({
      command: ["false"],
      cwd: "/root",
      "record-output": true,
      "wait-for-websocket": false,
    });
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });

  test("operations stay scoped to the instance project", async () => {
    const { client, calls } = mockClient(
      {
        "GET /1.0/instances/web": sync(instance({ project: "p2" })),
        "DELETE /1.0/instances/web": async("op5"),
        "GET /1.0/operations/op5/wait": done("op5"),
      },
      { project: "p2" },
    );
    const web = await client.getInstance("web");
    await web.delete();
    expect(calls.every((c) => c.params.project === "p2")).toBe(true);
  });
});
