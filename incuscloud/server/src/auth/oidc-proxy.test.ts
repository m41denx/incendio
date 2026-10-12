import { afterAll, expect, test } from "bun:test";
import { isOidcPath, oidcProxy } from "./oidc-proxy.ts";

const seen: Array<{ method: string; path: string; cookie: string | null; host: string | null; fwdHost: string | null; body: string }> = [];
const upstream = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    seen.push({ method: req.method, path: u.pathname + u.search, cookie: req.headers.get("cookie"), host: req.headers.get("host"), fwdHost: req.headers.get("x-forwarded-host"), body: await req.text() });
    if (u.pathname === "/oauth2/auth") {
      const h = new Headers({ location: "https://cloud.example/auth/login?login_challenge=c1" });
      h.append("set-cookie", "ory_hydra_login_csrf=a; Path=/; HttpOnly");
      h.append("set-cookie", "ory_hydra_session=b; Path=/; HttpOnly");
      return new Response(null, { status: 302, headers: h });
    }
    if (u.pathname === "/oauth2/token") return Response.json({ access_token: "t" });
    return Response.json({ issuer: "https://cloud.example/" });
  },
});
afterAll(() => upstream.stop(true));
const proxy = oidcProxy({ upstream: upstream.url.origin });

test("Hydra's public endpoints are proxied; IncusCloud's own paths are not", () => {
  for (const p of ["/oauth2/auth", "/oauth2/token", "/oauth2/device/auth", "/oauth2/sessions/logout", "/oauth2/revoke", "/.well-known/openid-configuration", "/.well-known/jwks.json", "/userinfo"]) expect(isOidcPath(p)).toBe(true);
  for (const p of ["/", "/auth/login", "/api/v1/me", "/clusters/x/1.0", "/.well-known/other", "/oauth2x", "/userinfo/x"]) expect(isOidcPath(p)).toBe(false);
});

test("a redirect passes through untouched, with every cookie Hydra sets", async () => {
  const r = await proxy(new Request("https://cloud.example/oauth2/auth?client_id=web&state=s", { headers: { host: "cloud.example" } }));
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toBe("https://cloud.example/auth/login?login_challenge=c1");
  expect(r.headers.getSetCookie()).toEqual(["ory_hydra_login_csrf=a; Path=/; HttpOnly", "ory_hydra_session=b; Path=/; HttpOnly"]);
  expect(seen.at(-1)).toMatchObject({ method: "GET", path: "/oauth2/auth?client_id=web&state=s", fwdHost: "cloud.example" });
});

test("bodies are forwarded; IncusCloud's own cookies are not sent to Hydra", async () => {
  const r = await proxy(
    new Request("https://cloud.example/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: "ic_session=secret; ory_hydra_session=b; ic_oauth=x" },
      body: "grant_type=authorization_code&code=c",
    }),
  );
  expect(await r.json()).toEqual({ access_token: "t" });
  expect(seen.at(-1)).toMatchObject({ method: "POST", body: "grant_type=authorization_code&code=c", cookie: "ory_hydra_session=b" });
});

test("an unreachable Hydra is a 502, not a crash", async () => {
  const r = await oidcProxy({ upstream: "http://127.0.0.1:1" })(new Request("https://cloud.example/.well-known/jwks.json"));
  expect(r.status).toBe(502);
});
