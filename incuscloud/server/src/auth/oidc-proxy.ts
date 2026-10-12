import { log } from "../lib/log.ts";
import { CLIENT_IP_HEADER } from "../front.ts";

export { isOidcPath } from "./oidc-paths.ts";

/** IncusCloud's own cookies stay with IncusCloud. */
const OWN_COOKIE = /^ic_[a-z_]+=/;
const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "content-encoding"]);

/**
 * Serves Hydra's public endpoints from IncusCloud's own origin, so the OIDC
 * issuer is the public URL: browsers and Incus clients never see Hydra's
 * own address. Redirects and cookies pass through untouched.
 */
export function oidcProxy(o: { upstream: string; ca?: string }) {
  const upstream = o.upstream.replace(/\/$/, "");
  return async (req: Request): Promise<Response> => {
    const u = new URL(req.url);
    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (k === "host" || k === CLIENT_IP_HEADER || HOP.has(k) || k === "accept-encoding") return;
      if (k === "cookie") {
        const kept = v
          .split(/;\s*/)
          .filter((c) => c && !OWN_COOKIE.test(c))
          .join("; ");
        if (kept) headers.set("cookie", kept);
        return;
      }
      headers.set(k, v);
    });
    headers.set("x-forwarded-host", req.headers.get("host") ?? u.host);
    headers.set("x-forwarded-proto", "https");
    const ip = req.headers.get(CLIENT_IP_HEADER);
    if (ip) headers.set("x-forwarded-for", ip);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    try {
      const r = await fetch(`${upstream}${u.pathname}${u.search}`, {
        method: req.method,
        headers,
        body: hasBody ? await req.arrayBuffer() : undefined,
        redirect: "manual",
        tls: o.ca ? { ca: o.ca } : undefined,
        signal: AbortSignal.timeout(30_000),
      } as RequestInit);
      const out = new Headers();
      r.headers.forEach((v, k) => {
        if (k !== "set-cookie" && !HOP.has(k)) out.set(k, v);
      });
      for (const c of r.headers.getSetCookie()) out.append("set-cookie", c);
      return new Response(r.body, { status: r.status, headers: out });
    } catch (e) {
      log.warn("OIDC proxy: Hydra unreachable", { error: (e as Error).message, path: u.pathname });
      return Response.json({ error: "temporarily_unavailable", error_description: "The identity service is unreachable" }, { status: 502 });
    }
  };
}
