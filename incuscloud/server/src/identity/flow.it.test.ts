import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Server } from "node:https";
import { Elysia } from "elysia";
import { decodeJwt } from "jose";
import { testDb } from "../db/test-db.ts";
import { users } from "../db/schema.ts";
import { createFront } from "../front.ts";
import { errorHandling } from "../lib/errors.ts";
import { TestBrowser } from "../test/browser.ts";
import { HydraAdmin } from "./hydra-admin.ts";
import { hashPassword } from "./passwords.ts";
import { identityRoutes } from "./routes.ts";
import { CLI_CLIENT_ID, ensureClients, webClientSecret } from "./bootstrap.ts";
import { HydraTokens, sessionRoutes } from "../auth/session.ts";
import { principalPlugin } from "../auth/principal.ts";
import { createVerifier, remoteJwks } from "../auth/verify.ts";
import { meRoutes } from "../api/me.ts";

// Live: scripts/dev-hydra.sh, then IC_IT_HYDRA=1 (Hydra on :4444/:4445, pages on :7443).
const enabled = !!process.env.IC_IT_HYDRA;
const live = test.if(enabled);
const dev = new URL("../../../.dev/", import.meta.url);
const ca = enabled ? readFileSync(new URL("tls/ca.crt", dev), "utf8") : "";
const ISSUER = "https://127.0.0.1:4444";
let server: Server | undefined;
let userId = "";
let hydra: HydraAdmin;

beforeAll(async () => {
  if (!process.env.IC_IT_HYDRA) return;
  const db = await testDb();
  hydra = new HydraAdmin("https://127.0.0.1:4445", { ca });
  const secretKey = Buffer.alloc(32, 4);
  await ensureClients(hydra, { publicUrl: "https://127.0.0.1:7443", secretKey });
  const [u] = await db.insert(users).values({ email: "flow@example.com", name: "Flow", passwordHash: await hashPassword("pw-flow-123456") }).returning();
  userId = u!.id;
  const authDeps = {
    db,
    hydra,
    tokens: new HydraTokens({ hydraPublicUrl: ISSUER, clientSecret: webClientSecret(secretKey), ca }),
    verify: createVerifier({ issuer: ISSUER, audience: "incuscloud", jwks: remoteJwks(ISSUER, ca) }),
    secretKey,
    publicUrl: "https://127.0.0.1:7443",
    hydraPublicUrl: ISSUER,
    secureCookies: true,
  };
  const app = new Elysia()
    .use(errorHandling)
    .use(principalPlugin(authDeps))
    .use(identityRoutes({ db, hydra, secureCookies: true }))
    .use(sessionRoutes(authDeps))
    .use(meRoutes({ db }));
  server = createFront({ app, tls: { cert: readFileSync(new URL("tls/server.crt", dev)), key: readFileSync(new URL("tls/server.key", dev)) } });
  await new Promise<void>((r) => server!.listen(7443, "127.0.0.1", r));
});
afterAll(() => server?.close());

// biome-ignore lint: test JSON
const json = async (r: Promise<Response>): Promise<any> => (await r).json();
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o), tls: { ca } }) as RequestInit;

live("device flow, as the incus CLI does it, yields an incuscloud token for the user", async () => {
  const dev = await json(fetch(`${ISSUER}/oauth2/device/auth`, form({ client_id: CLI_CLIENT_ID, scope: "openid offline_access", audience: "incuscloud" })));
  expect(dev.user_code).toBeTruthy();

  const b = new TestBrowser(ca);
  const devicePage = await b.go(dev.verification_uri);
  expect(devicePage.url).toStartWith("https://127.0.0.1:7443/auth/device");
  const loginPage = await b.submit(devicePage, { user_code: dev.user_code });
  expect(loginPage.url).toStartWith("https://127.0.0.1:7443/auth/login");
  const done = await b.submit(loginPage, { email: "flow@example.com", password: "pw-flow-123456" });
  expect(done.url).toStartWith("https://127.0.0.1:7443/auth/device/done");
  expect(done.body).toContain("Device connected");

  const tok = await json(fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: dev.device_code, client_id: CLI_CLIENT_ID })));
  const claims = decodeJwt(tok.access_token);
  expect(claims.sub).toBe(userId);
  expect(claims.aud).toContain("incuscloud");
  expect(claims.iss).toBe(`${ISSUER}/`);
  expect(claims.email).toBe("flow@example.com");
  expect(tok.refresh_token).toBeTruthy();

  // Disabling a user revokes their grants: the CLI's refresh token stops working.
  await hydra.revokeSubject(userId);
  const refreshed = await json(fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: CLI_CLIENT_ID })));
  expect(refreshed.error).toBeTruthy();
  expect(refreshed.access_token).toBeUndefined();
});

live("a wrong password keeps the device flow pending", async () => {
  const dev = await json(fetch(`${ISSUER}/oauth2/device/auth`, form({ client_id: CLI_CLIENT_ID, scope: "openid", audience: "incuscloud" })));
  const b = new TestBrowser(ca);
  const loginPage = await b.submit(await b.go(dev.verification_uri), { user_code: dev.user_code });
  const again = await b.submit(loginPage, { email: "flow@example.com", password: "nope" });
  expect(again.res.status).toBe(401);
  expect(again.body).toContain("Wrong email or password");
  const tok = await json(fetch(`${ISSUER}/oauth2/token`, form({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: dev.device_code, client_id: CLI_CLIENT_ID })));
  expect(tok.error).toBe("authorization_pending");
});

live("client credentials (service accounts) get incuscloud tokens", async () => {
  const id = `sa-it-${crypto.randomUUID()}`;
  await hydra.createClient({ client_id: id, client_secret: "it-secret-0123456789abcdef", grant_types: ["client_credentials"], token_endpoint_auth_method: "client_secret_basic", audience: ["incuscloud"], access_token_strategy: "jwt", metadata: { first_party: true } });
  const res = await fetch(`${ISSUER}/oauth2/token`, { ...form({ grant_type: "client_credentials", audience: "incuscloud" }), headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${id}:it-secret-0123456789abcdef`)}` } } as RequestInit);
  const claims = decodeJwt((await json(Promise.resolve(res))).access_token);
  expect(claims.sub).toBe(id);
  expect(claims.aud).toContain("incuscloud");
  await hydra.deleteClient(id);
  expect(await hydra.getClient(id)).toBeNull();
});

live("browser sign-in creates a session that reaches the API", async () => {
  const b = new TestBrowser(ca);
  const loginPage = await b.go("https://127.0.0.1:7443/auth/start?return_to=/api/v1/me");
  expect(loginPage.url).toStartWith("https://127.0.0.1:7443/auth/login");
  const me = await b.submit(loginPage, { email: "flow@example.com", password: "pw-flow-123456" });
  expect(me.url).toBe("https://127.0.0.1:7443/api/v1/me");
  expect(JSON.parse(me.body)).toMatchObject({ id: userId, kind: "user", email: "flow@example.com" });

  const out = await b.go("https://127.0.0.1:7443/auth/logout");
  expect(out.url).toBe("https://127.0.0.1:7443/");
  const after = await b.go("https://127.0.0.1:7443/api/v1/me");
  expect(after.res.status).toBe(401);
});
