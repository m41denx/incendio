import { expect, test } from "bun:test";
import { LoginThrottle } from "./throttle.ts";

test("blocks a key after too many failures within the window, then forgets", () => {
  let now = 0;
  const t = new LoginThrottle({ limit: 3, windowMs: 1000, now: () => now });
  for (let i = 0; i < 3; i++) {
    expect(t.retryAfterS(["ip:a"])).toBe(0);
    t.fail(["ip:a"]);
  }
  expect(t.retryAfterS(["ip:a"])).toBe(1);
  expect(t.retryAfterS(["ip:b"])).toBe(0);
  now = 1001;
  expect(t.retryAfterS(["ip:a"])).toBe(0);
});

test("success clears a key", () => {
  const t = new LoginThrottle({ limit: 2, windowMs: 60_000 });
  t.fail(["email:x"]);
  t.fail(["email:x"]);
  expect(t.retryAfterS(["email:x"])).toBeGreaterThan(0);
  t.clear(["email:x"]);
  expect(t.retryAfterS(["email:x"])).toBe(0);
});

test("memory stays bounded", () => {
  const t = new LoginThrottle({ limit: 5, windowMs: 60_000, maxKeys: 100 });
  for (let i = 0; i < 1000; i++) t.fail([`ip:${i}`]);
  expect(t.size).toBeLessThanOrEqual(100);
});
