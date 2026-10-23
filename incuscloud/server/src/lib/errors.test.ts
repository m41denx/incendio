import { expect, test } from "bun:test";
import { describe } from "./errors.ts";

test("an unexpected error is logged by name and message; a failed query only by the database's answer", () => {
  expect(describe(new TypeError("x is undefined"))).toEqual({ error: "TypeError", message: "x is undefined" });
  const query = Object.assign(new Error("Failed query: insert ...\\nparams: hunter2"), { name: "DrizzleQueryError", cause: { message: 'null value in column "created_at"' } });
  expect(describe(query)).toEqual({ error: "DrizzleQueryError", message: 'null value in column "created_at"' });
  expect(describe("plain")).toEqual({ error: "string", message: "plain" });
});
