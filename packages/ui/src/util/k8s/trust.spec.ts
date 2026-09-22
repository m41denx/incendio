import { certificateFingerprint, pemBody } from "./trust";

// Throwaway self-signed cert; fingerprint from
// `openssl x509 -noout -fingerprint -sha256`.
const PEM = `-----BEGIN CERTIFICATE-----
MIIBhDCCASugAwIBAgIUB0Y9NFEGs+Jg3H78Mv5fD469ivIwCgYIKoZIzj0EAwIw
GDEWMBQGA1UEAwwNaW5jZW5kaW8tdGVzdDAeFw0yNjA5MjIyMjE3MDNaFw0zNjA5
MTkyMjE3MDNaMBgxFjAUBgNVBAMMDWluY2VuZGlvLXRlc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAATneK3K1oHKaNl3hLwHrS3/u++rSxdhImPUJIgPBGDiJAET
9vMS2H0RD4XE5Euo7ivLjqRMrdPD+WA39KvgzZhVo1MwUTAdBgNVHQ4EFgQUW5WL
fJEX0ui+QtJSyVialYOwc90wHwYDVR0jBBgwFoAUW5WLfJEX0ui+QtJSyVialYOw
c90wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNHADBEAiAz+o3h9JFVRa0b
p7xCY6J4RNMgWmt+e9L6IF6FTlE7SAIgcgQl0g+jd7a/mBocJwJr91mX4oTtXqpw
K4VAt8k5K9Q=
-----END CERTIFICATE-----
`;
const FINGERPRINT =
  "17ed11500381f95a970d703aa11eeb883cf37bb0e910872dc0af0b04267c613b";

describe("pemBody", () => {
  it("strips the armour and whitespace, leaving base64 DER", () => {
    const body = pemBody(PEM);
    expect(body.startsWith("MIIBhDCCASug")).toBe(true);
    expect(body.endsWith("K4VAt8k5K9Q=")).toBe(true);
    expect(body).not.toMatch(/\s|-/);
  });

  it("rejects text without a certificate block", () => {
    expect(() => pemBody("not a cert")).toThrow(/certificate/i);
  });
});

describe("certificateFingerprint", () => {
  it("matches the Incus / openssl sha256 fingerprint", async () => {
    expect(await certificateFingerprint(PEM)).toBe(FINGERPRINT);
  });

  it("ignores CRLF line endings", async () => {
    expect(await certificateFingerprint(PEM.replace(/\n/g, "\r\n"))).toBe(
      FINGERPRINT,
    );
  });
});
