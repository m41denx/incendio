import { expect, test } from "bun:test";
import { exceeds, quotaBytes, splitLimits, sumUsage } from "./quota.ts";

const GiB = 1024 ** 3;

test("the quota in Incus's units: memory and disk from GiB to bytes", () => {
  expect(quotaBytes({ instances: 5, cpu: 4, memory: 8, disk: 50 })).toEqual({ instances: 5, cpu: 4, memory: 8 * GiB, disk: 50 * GiB });
  expect(quotaBytes({})).toEqual({});
});

test("no quota: no limits", () => {
  expect(splitLimits({}, [{ instances: 2, cpu: 2, memory: GiB, disk: GiB }])).toEqual([{}]);
});

test("each placement may take all the free headroom on top of its own usage", () => {
  const limits = splitLimits({ instances: 5, memory: 8 }, [
    { instances: 1, cpu: 1, memory: 2 * GiB, disk: 0 },
    { instances: 2, cpu: 2, memory: 1 * GiB, disk: 0 },
  ]);
  // Free: 2 instances, 5 GiB.
  expect(limits).toEqual([
    { instances: 3, memory: 7 * GiB },
    { instances: 4, memory: 6 * GiB },
  ]);
});

test("at or over quota: limits equal usage, never below it", () => {
  const limits = splitLimits({ cpu: 2 }, [
    { instances: 0, cpu: 2, memory: 0, disk: 0 },
    { instances: 0, cpu: 1, memory: 0, disk: 0 },
  ]);
  expect(limits).toEqual([{ cpu: 2 }, { cpu: 1 }]);
});

test("placements without a known usage count as using nothing", () => {
  expect(splitLimits({ instances: 3 }, [null, { instances: 1, cpu: 0, memory: 0, disk: 0 }])).toEqual([{ instances: 2 }, { instances: 3 }]);
});

test("sum and the check for a request: which keys would be exceeded, by how much", () => {
  const used = sumUsage([{ instances: 1, cpu: 2, memory: 2 * GiB, disk: 10 * GiB }, null, { instances: 1, cpu: 1, memory: GiB, disk: 5 * GiB }]);
  expect(used).toEqual({ instances: 2, cpu: 3, memory: 3 * GiB, disk: 15 * GiB });
  const q = { instances: 3, cpu: 4, memory: 4 };
  expect(exceeds(q, used, { instances: 1, cpu: 1, memory: GiB, disk: 100 * GiB })).toEqual([]);
  expect(exceeds(q, used, { instances: 1, cpu: 2, memory: 2 * GiB, disk: 0 })).toEqual(["cpu: 5 of 4", "memory: 5.0 of 4 GiB"]);
});
