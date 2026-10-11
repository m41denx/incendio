import { expect, test } from "bun:test";
import { decodeTrustToken } from "./trust-token.ts";

const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");
const good = { client_name: "incuscloud", fingerprint: "AB".repeat(32), addresses: ["10.0.0.1:8443", "[fd00::1]:8443"], secret: "s3", expires_at: "2099-01-01T00:00:00Z" };

test("decodes a token", () => {
  const t = decodeTrustToken(enc(good));
  expect(t.addresses).toEqual(["10.0.0.1:8443", "[fd00::1]:8443"]);
  expect(t.fingerprint).toBe("ab".repeat(32));
  expect(t.secret).toBe("s3");
});

test("tokens without expiry are accepted", () => {
  expect(decodeTrustToken(enc({ ...good, expires_at: "0001-01-01T00:00:00Z" })).secret).toBe("s3");
});

test("surrounding whitespace is ignored", () => {
  expect(decodeTrustToken(`  ${enc(good)}\n`).secret).toBe("s3");
});

test("expired tokens are rejected", () => {
  expect(() => decodeTrustToken(enc({ ...good, expires_at: "2000-01-01T00:00:00Z" }))).toThrow(/expired/);
});

test("garbage and incomplete tokens are rejected", () => {
  expect(() => decodeTrustToken("%%%")).toThrow(/not a valid trust token/);
  expect(() => decodeTrustToken(enc({ ...good, addresses: [] }))).toThrow(/not a valid trust token/);
  expect(() => decodeTrustToken(enc({ ...good, secret: "" }))).toThrow(/not a valid trust token/);
});
