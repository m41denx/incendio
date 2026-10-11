import { expect, test } from "vitest";
import { bytes, cores, percent, rate } from "./format";

test("bytes in binary units; unknown is a dash", () => {
  expect(bytes(512)).toBe("512 B");
  expect(bytes(1536)).toBe("1.5 KiB");
  expect(bytes(2 * 1024 ** 3)).toBe("2.0 GiB");
  expect(bytes(null)).toBe("—");
  expect(bytes(undefined)).toBe("—");
});

test("rates, cores and shares", () => {
  expect(rate(2048)).toBe("2.0 KiB/s");
  expect(rate(null)).toBe("—");
  expect(cores(0.4567)).toBe("0.46");
  expect(cores(null)).toBe("—");
  expect(percent(25, 100)).toBe("25%");
  expect(percent(1, 0)).toBe("—");
  expect(percent(null, 100)).toBe("—");
});
