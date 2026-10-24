import { expect, test } from "bun:test";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { logFields } from "./errors.ts";

test("an unexpected error is logged by name and message; a failed query by its statement and the database's answer", () => {
  expect(logFields(new TypeError("x is undefined"))).toEqual({ error: "TypeError", message: "x is undefined" });
  const query = new DrizzleQueryError("insert into service_accounts (secret) values ($1)", ["hunter2"], new Error('null value in column "created_at"'));
  const fields = logFields(query);
  expect(fields).toEqual({ error: "DrizzleQueryError", message: 'null value in column "created_at"', query: "insert into service_accounts (secret) values ($1)" });
  expect(JSON.stringify(fields)).not.toContain("hunter2");
  expect(logFields("plain")).toEqual({ error: "string", message: "plain" });
});
