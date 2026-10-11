import { beforeEach, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { testDb } from "../db/test-db.ts";
import { auditLog, users } from "../db/schema.ts";
import type { Db } from "../db/index.ts";
import { errorHandling } from "../lib/errors.ts";
import { hashPassword } from "./passwords.ts";
import { identityRoutes } from "./routes.ts";
import { FakeHydra, firstParty } from "./fake-hydra.ts";

let db: Db;
let hydra: FakeHydra;
let app: { handle(r: Request): Promise<Response> };
let userId: string;

beforeEach(async () => {
  db = await testDb();
  hydra = new FakeHydra();
  app = new Elysia().use(errorHandling).use(identityRoutes({ db, hydra, secureCookies: true }));
  const [u] = await db.insert(users).values({ email: "ada@example.com", name: "Ada", passwordHash: await hashPassword("pw-good-123456") }).returning();
  userId = u!.id;
  hydra.logins.set("L1", { challenge: "L1", skip: false, subject: "", client: firstParty, request_url: "" });
});

const url = (p: string) => `https://cloud.test${p}`;
const csrfFrom = async (r: Response) => {
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith("ic_csrf="))!;
  const token = (await r.text()).match(/name="csrf" value="([^"]+)"/)![1]!;
  return { cookie: cookie.split(";")[0]!, token, raw: cookie };
};
const post = (path: string, form: Record<string, string>, cookie: string) =>
  app.handle(new Request(url(path), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, "x-ic-client-ip": "203.0.113.9" }, body: new URLSearchParams(form) }));

test("login form renders with the challenge and a CSRF cookie", async () => {
  const r = await app.handle(new Request(url("/auth/login?login_challenge=L1")));
  expect(r.status).toBe(200);
  const { raw, token } = await csrfFrom(r);
  expect(raw).toContain("HttpOnly");
  expect(raw).toContain("Secure");
  expect(token.length).toBeGreaterThan(20);
});

test("good credentials accept the login with the user id as subject", async () => {
  const { cookie, token } = await csrfFrom(await app.handle(new Request(url("/auth/login?login_challenge=L1"))));
  const r = await post("/auth/login", { challenge: "L1", csrf: token, email: "ADA@example.com", password: "pw-good-123456" }, cookie);
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe("https://hydra.test/after-login?ch=L1");
  expect(hydra.accepted[0]!.body).toMatchObject({ subject: userId });
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  expect(u!.lastLoginAt).toBeInstanceOf(Date);
  const [a] = await db.select().from(auditLog);
  expect(a).toMatchObject({ action: "auth.login", result: "success", actorId: userId, ip: "203.0.113.9" });
});

test("wrong password, unknown email and disabled user get the same answer", async () => {
  await db.insert(users).values({ email: "off@example.com", name: "Off", passwordHash: await hashPassword("pw-good-123456"), disabled: true });
  const bodies: string[] = [];
  for (const [email, password] of [["ada@example.com", "wrong"], ["ghost@example.com", "pw-good-123456"], ["off@example.com", "pw-good-123456"]]) {
    const { cookie, token } = await csrfFrom(await app.handle(new Request(url("/auth/login?login_challenge=L1"))));
    const r = await post("/auth/login", { challenge: "L1", csrf: token, email: email!, password: password! }, cookie);
    expect(r.status).toBe(401);
    bodies.push((await r.text()).replace(/value="[^"]*"/g, ""));
  }
  expect(bodies[0]).toContain("Wrong email or password");
  expect(new Set(bodies.map((b) => b.replace(/(ada|ghost|off)@example\.com/g, ""))).size).toBe(1);
  expect(hydra.accepted).toEqual([]);
  const rows = await db.select().from(auditLog);
  expect(rows.map((r) => r.result)).toEqual(["denied", "denied", "denied"]);
});

test("a missing or mismatched CSRF token is refused", async () => {
  const { cookie } = await csrfFrom(await app.handle(new Request(url("/auth/login?login_challenge=L1"))));
  const r = await post("/auth/login", { challenge: "L1", csrf: "forged", email: "ada@example.com", password: "pw-good-123456" }, cookie);
  expect(r.status).toBe(403);
  expect(hydra.accepted).toEqual([]);
});

test("skip re-accepts a remembered user, but not one disabled since", async () => {
  hydra.logins.set("L2", { challenge: "L2", skip: true, subject: userId, client: firstParty, request_url: "" });
  const r = await app.handle(new Request(url("/auth/login?login_challenge=L2")));
  expect(r.status).toBe(302);
  expect(hydra.accepted.at(-1)).toMatchObject({ kind: "login", body: { subject: userId } });

  await db.update(users).set({ disabled: true }).where(eq(users.id, userId));
  hydra.logins.set("L3", { challenge: "L3", skip: true, subject: userId, client: firstParty, request_url: "" });
  const r2 = await app.handle(new Request(url("/auth/login?login_challenge=L3")));
  expect(r2.status).toBe(302);
  expect(r2.headers.get("location")).toContain("rejected-login");
});

test("expired challenges show an error page", async () => {
  const r = await app.handle(new Request(url("/auth/login?login_challenge=gone")));
  expect(r.status).toBe(404);
  expect(await r.text()).toContain("expired");
});

test("consent is granted to first-party clients with the incuscloud audience and profile claims", async () => {
  hydra.consents.set("C1", { challenge: "C1", skip: false, subject: userId, requested_scope: ["openid", "offline_access"], requested_access_token_audience: [], client: firstParty });
  const r = await app.handle(new Request(url("/auth/consent?consent_challenge=C1")));
  expect(r.status).toBe(302);
  expect(hydra.accepted.at(-1)!.body).toMatchObject({
    grant_scope: ["openid", "offline_access"],
    grant_access_token_audience: ["incuscloud"],
    session: { id_token: { email: "ada@example.com", name: "Ada" } },
  });
});

test("consent for unknown third-party clients is rejected", async () => {
  hydra.consents.set("C2", { challenge: "C2", skip: false, subject: userId, requested_scope: ["openid"], requested_access_token_audience: [], client: { client_id: "evil" } });
  const r = await app.handle(new Request(url("/auth/consent?consent_challenge=C2")));
  expect(r.headers.get("location")).toContain("rejected-consent");
});

test("device codes are accepted through the form", async () => {
  hydra.devices.add("D1");
  const g = await app.handle(new Request(url("/auth/device?device_challenge=D1&user_code=ABCD-EFGH")));
  expect(g.status).toBe(200);
  const html = await g.clone().text();
  expect(html).toContain('value="ABCD-EFGH"');
  const { cookie, token } = await csrfFrom(g);
  const r = await post("/auth/device", { challenge: "D1", csrf: token, user_code: " aBcD-eFgH " }, cookie);
  expect(r.status).toBe(302);
  // Hydra user codes are case-sensitive: only whitespace is trimmed.
  expect(hydra.accepted.at(-1)).toMatchObject({ kind: "device", body: { user_code: "aBcD-eFgH" } });
});

test("a wrong device code shows the form again with an error", async () => {
  hydra.devices.add("D3");
  hydra.validCodes = new Set(["RIGHT"]);
  const { cookie, token } = await csrfFrom(await app.handle(new Request(url("/auth/device?device_challenge=D3"))));
  const r = await post("/auth/device", { challenge: "D3", csrf: token, user_code: "WRONG" }, cookie);
  expect(r.status).toBe(400);
  const body = await r.text();
  expect(body).toContain("not valid or has expired");
  expect(body).toContain('name="challenge" value="D3"');
});

test("pages escape reflected input", async () => {
  hydra.devices.add("D2");
  const r = await app.handle(new Request(url(`/auth/device?device_challenge=D2&user_code=${encodeURIComponent('"><script>x</script>')}`)));
  expect(await r.text()).not.toContain("<script>x");
});

test("repeated failures are throttled, even with the right password afterwards", async () => {
  const attempt = async (password: string, ip = "203.0.113.9") => {
    const { cookie, token } = await csrfFrom(await app.handle(new Request(url("/auth/login?login_challenge=L1"))));
    return app.handle(new Request(url("/auth/login"), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie, "x-ic-client-ip": ip }, body: new URLSearchParams({ challenge: "L1", csrf: token, email: "ada@example.com", password }) }));
  };
  for (let i = 0; i < 10; i++) expect((await attempt("wrong")).status).toBe(401);
  const blocked = await attempt("pw-good-123456");
  expect(blocked.status).toBe(429);
  expect(blocked.headers.get("retry-after")).toBeTruthy();
  expect(await blocked.text()).toContain("Too many attempts");
  expect(hydra.accepted).toEqual([]);
});
