import { expect, test } from "bun:test";
import { ApiError } from "../lib/errors.ts";
import { memoryStore, objectKey } from "./store.ts";

const chunks = (n: number, size = 1000) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < n; i++) c.enqueue(new Uint8Array(size).fill(i % 256));
      c.close();
    },
  });
const readAll = async (s: ReadableStream<Uint8Array>) => {
  const parts: Uint8Array[] = [];
  for await (const p of s) parts.push(p);
  return Buffer.concat(parts);
};

test("memory store: put, stat, get, delete", async () => {
  const s = memoryStore();
  const seen: number[] = [];
  expect(await s.put("a/b.tar.gz", chunks(5), { onBytes: (n) => seen.push(n) })).toEqual({ size: 5000 });
  expect(seen.at(-1)).toBe(5000);
  expect(await s.stat("a/b.tar.gz")).toEqual({ size: 5000 });
  const back = await readAll(await s.get("a/b.tar.gz"));
  expect(back.length).toBe(5000);
  expect(back[4999]).toBe(4);
  await s.delete("a/b.tar.gz");
  await s.delete("a/b.tar.gz");
  expect(await s.stat("a/b.tar.gz")).toBeUndefined();
});

test("memory store: a missing object is a 404", async () => {
  const e = await memoryStore()
    .get("nope")
    .catch((x) => x);
  expect(e).toBeInstanceOf(ApiError);
  expect(e.status).toBe(404);
});

test("memory store: an aborted put leaves nothing", async () => {
  const s = memoryStore();
  const ac = new AbortController();
  const slow = new ReadableStream<Uint8Array>({
    async pull(c) {
      await Bun.sleep(5);
      c.enqueue(new Uint8Array(10));
    },
  });
  setTimeout(() => ac.abort(new Error("cancelled")), 30);
  expect(await s.put("x", slow, { signal: ac.signal }).catch((e) => (e as Error).message)).toBe("cancelled");
  expect(await s.stat("x")).toBeUndefined();
});

test("memory store: check writes, reads and removes a probe", async () => {
  const s = memoryStore();
  await s.check();
  expect(s.keys()).toEqual([]);
});

test("object keys: project/instance/time-id under the prefix", () => {
  const at = new Date("2026-10-11T09:08:07.123Z");
  expect(objectKey({ prefix: "", project: "acme", instanceName: "web", at, id: "0123456789abcdef" })).toBe("acme/web/20261011T090807Z-01234567.tar.gz");
  expect(objectKey({ prefix: "backups", project: "acme", instanceName: "web", at, id: "0123456789abcdef" })).toBe("backups/acme/web/20261011T090807Z-01234567.tar.gz");
  expect(objectKey({ prefix: "/b/", project: "p", instanceName: "i", at, id: "abcdefgh" })).toBe("b/p/i/20261011T090807Z-abcdefgh.tar.gz");
});
