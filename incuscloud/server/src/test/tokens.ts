import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from "jose";

export const TEST_ISSUER = "https://id.test/";

/** A local signing key and a JWKS for it, like Hydra's. */
export async function testKeys() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: JWTPayload, o: { expiresIn?: string | number; issuer?: string; audience?: string[] } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(o.issuer ?? TEST_ISSUER)
      .setAudience(o.audience ?? ["incuscloud"])
      .setIssuedAt()
      .setExpirationTime(o.expiresIn ?? "1h")
      .sign(privateKey);
  return { jwks, sign };
}
