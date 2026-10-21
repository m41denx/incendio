import { expect, test } from "bun:test";
import { TEST_ISSUER, testKeys } from "../test/tokens.ts";
import { createVerifier } from "./verify.ts";

const { jwks, sign } = await testKeys();
const verify = createVerifier({ issuer: TEST_ISSUER, audience: "incuscloud", jwks });

test("accepts a valid token", async () => {
  expect((await verify(await sign({ sub: "u1" }))).sub).toBe("u1");
});

test("issuer with or without trailing slash", async () => {
  const v = createVerifier({ issuer: "https://id.test", audience: "incuscloud", jwks });
  expect((await v(await sign({ sub: "u1" }))).sub).toBe("u1");
});

test("rejects another audience, an expired token, another issuer and garbage", async () => {
  await expect(verify(await sign({ sub: "u1" }, { audience: ["other"] }))).rejects.toMatchObject({ status: 401 });
  await expect(verify(await sign({ sub: "u1" }, { expiresIn: Math.floor(Date.now() / 1000) - 120 }))).rejects.toMatchObject({ status: 401 });
  await expect(verify(await sign({ sub: "u1" }, { issuer: "https://evil.test/" }))).rejects.toMatchObject({ status: 401 });
  await expect(verify("not.a.jwt")).rejects.toMatchObject({ status: 401 });
});

test("rejects tokens without a subject", async () => {
  await expect(verify(await sign({}))).rejects.toMatchObject({ status: 401 });
});

test("the issuer is taken verbatim from the discovery document", async () => {
  const { discoverIssuer } = await import("./verify.ts");
  const server = Bun.serve({ port: 0, fetch: (r) => (new URL(r.url).pathname === "/.well-known/openid-configuration" ? Response.json({ issuer: "https://id.example/" }) : new Response("", { status: 404 })) });
  try {
    expect(await discoverIssuer(`http://127.0.0.1:${server.port}`)).toBe("https://id.example/");
  } finally {
    server.stop();
  }
});
