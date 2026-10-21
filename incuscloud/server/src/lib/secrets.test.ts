import { expect, test } from "bun:test";
import { open, randomToken, seal } from "./secrets.ts";

const k = Buffer.alloc(32, 7);

test("round trip", () => {
  expect(open(k, seal(k, "s3cret ✓"))).toBe("s3cret ✓");
});

test("each seal uses a fresh IV", () => {
  expect(seal(k, "same")).not.toBe(seal(k, "same"));
});

test("tampering is detected", () => {
  const s = seal(k, "x");
  const flipped = s.slice(0, -2) + (s.endsWith("AA") ? "BB" : "AA");
  expect(() => open(k, flipped)).toThrow(/secret_corrupt|corrupt/);
});

test("a different key is detected", () => {
  expect(() => open(Buffer.alloc(32, 8), seal(k, "x"))).toThrow();
});

test("unknown format is rejected", () => {
  expect(() => open(k, "plain")).toThrow();
});

test("random tokens are url-safe and distinct", () => {
  const a = randomToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(randomToken()).not.toBe(a);
});
