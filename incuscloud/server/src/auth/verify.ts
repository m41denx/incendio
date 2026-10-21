import { jwtVerify, createRemoteJWKSet, customFetch, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { ApiError } from "../lib/errors.ts";

export type VerifyToken = (token: string) => Promise<JWTPayload & { sub: string }>;

/** Verifies Hydra JWT access tokens: signature (JWKS), issuer, audience, expiry, subject. */
export function createVerifier(o: { issuer: string; audience: string; jwks: JWTVerifyGetKey }): VerifyToken {
  const bare = o.issuer.replace(/\/$/, "");
  const issuers = [bare, `${bare}/`];
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, o.jwks, { issuer: issuers, audience: o.audience, clockTolerance: 30 });
      if (!payload.sub) throw new Error("no subject");
      return payload as JWTPayload & { sub: string };
    } catch {
      throw new ApiError(401, "invalid_token", "The access token is invalid or has expired");
    }
  };
}

/** Hydra's published keys, fetched (and cached) over TLS with an optional private CA. */
export function remoteJwks(hydraPublicUrl: string, ca?: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(`${hydraPublicUrl.replace(/\/$/, "")}/.well-known/jwks.json`), {
    [customFetch]: (url: string, init: RequestInit) => fetch(url, { ...init, tls: ca ? { ca } : undefined } as RequestInit),
  });
}

/** The issuer exactly as Hydra spells it (Incus clients compare it byte for byte). */
export async function discoverIssuer(hydraPublicUrl: string, ca?: string): Promise<string> {
  const res = await fetch(`${hydraPublicUrl.replace(/\/$/, "")}/.well-known/openid-configuration`, { tls: ca ? { ca } : undefined } as RequestInit);
  if (!res.ok) throw new Error(`OIDC discovery answered ${res.status}`);
  const issuer = ((await res.json()) as { issuer?: string }).issuer;
  if (!issuer) throw new Error("OIDC discovery has no issuer");
  return issuer;
}
