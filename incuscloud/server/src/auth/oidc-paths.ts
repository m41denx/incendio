/** Hydra's public (browser- and client-facing) endpoints. */
export const isOidcPath = (path: string) => path.startsWith("/oauth2/") || path === "/.well-known/openid-configuration" || path === "/.well-known/jwks.json" || path === "/userinfo";
