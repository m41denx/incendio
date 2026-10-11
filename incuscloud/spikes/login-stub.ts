// Spike A: auto-accepting login, consent and device pages for Hydra.
// Throwaway: every login becomes SUBJECT, every consent grants all scopes
// with audience "incuscloud".
const ADMIN = "https://127.0.0.1:4445/admin/oauth2/auth/requests";
const SUBJECT = process.env.SUBJECT ?? "spike-user";
const tls = { ca: Bun.file(new URL("../.dev/tls/ca.crt", import.meta.url)) };

async function admin(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${ADMIN}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    tls,
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const redirect = (to: string) => Response.redirect(to, 302);

Bun.serve({
  port: 3000,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const q = url.searchParams;
    console.log(req.method, url.pathname, url.search);
    if (url.pathname === "/login") {
      const c = q.get("login_challenge")!;
      const r = await admin(`/login/accept?login_challenge=${c}`, "PUT", { subject: SUBJECT, remember: false });
      return redirect(r.redirect_to as string);
    }
    if (url.pathname === "/consent") {
      const c = q.get("consent_challenge")!;
      const info = await admin(`/consent?consent_challenge=${c}`);
      const r = await admin(`/consent/accept?consent_challenge=${c}`, "PUT", {
        grant_scope: info.requested_scope,
        grant_access_token_audience: ["incuscloud"],
        session: { access_token: { email: `${SUBJECT}@example.com` }, id_token: { email: `${SUBJECT}@example.com` } },
      });
      return redirect(r.redirect_to as string);
    }
    if (url.pathname === "/device") {
      const c = q.get("device_challenge")!;
      const code = q.get("user_code");
      if (!code) return new Response(`device_challenge=${c}: pass user_code`, { status: 400 });
      const r = await admin(`/device/accept?device_challenge=${c}`, "PUT", { user_code: code });
      return redirect(r.redirect_to as string);
    }
    if (url.pathname === "/device/done") return new Response("device login done\n");
    return new Response("not found\n", { status: 404 });
  },
});
console.log("login stub on :3000 as", SUBJECT);
