import {
  baseName,
  fileHeader,
  joinPath,
  newEntryNameError,
  parseFileModified,
  pathAncestors,
} from "./fileExplorer";

describe("paths", () => {
  it("joins below root and below a directory", () => {
    expect(joinPath("/", "etc")).toBe("/etc");
    expect(joinPath("/etc", "hosts")).toBe("/etc/hosts");
  });

  it("names the last segment", () => {
    expect(baseName("/etc/hosts")).toBe("hosts");
    expect(baseName("/")).toBe("/");
  });

  it("lists ancestors for breadcrumbs", () => {
    expect(pathAncestors("/")).toEqual(["/"]);
    expect(pathAncestors("/var/log/")).toEqual(["/", "/var", "/var/log"]);
  });
});

describe("fileHeader", () => {
  it("reads Incus headers, falling back to LXD's", () => {
    expect(
      fileHeader(new Headers({ "X-Incus-Type": "directory" }), "type"),
    ).toBe("directory");
    expect(fileHeader(new Headers({ "X-LXD-type": "file" }), "type")).toBe(
      "file",
    );
    expect(fileHeader(new Headers(), "type")).toBeNull();
  });
});

describe("parseFileModified", () => {
  it("parses Go's time format as Incus sends it", () => {
    expect(
      parseFileModified("2026-09-24 16:50:04 +0000 UTC")?.toISOString(),
    ).toBe("2026-09-24T16:50:04.000Z");
    expect(
      parseFileModified(
        "2026-09-24 16:50:04.123456789 +0200 CEST",
      )?.toISOString(),
    ).toBe("2026-09-24T14:50:04.123Z");
  });

  it("accepts ISO and rejects garbage", () => {
    expect(parseFileModified("2026-09-24T16:50:04Z")?.toISOString()).toBe(
      "2026-09-24T16:50:04.000Z",
    );
    expect(parseFileModified("yesterday")).toBeNull();
    expect(parseFileModified(null)).toBeNull();
  });
});

describe("newEntryNameError", () => {
  it("accepts a fresh name", () => {
    expect(newEntryNameError("data", ["logs"])).toBeNull();
  });

  it("rejects empty, nested, dot and taken names", () => {
    expect(newEntryNameError("  ", [])).toMatch(/Enter a name/);
    expect(newEntryNameError("a/b", [])).toMatch(/cannot contain/);
    expect(newEntryNameError("..", [])).toMatch(/another name/);
    expect(newEntryNameError("logs", ["logs"])).toMatch(/already exists/);
  });
});
