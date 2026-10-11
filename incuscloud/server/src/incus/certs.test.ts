import { expect, test } from "bun:test";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { fingerprintOf, generateClientCertificate, normalizeFingerprint } from "./certs.ts";

test("generates a client certificate and matching key", async () => {
  const { cert, key } = await generateClientCertificate("incuscloud");
  const x = new X509Certificate(cert);
  expect(x.subject).toContain("CN=incuscloud");
  expect(x.checkPrivateKey(createPrivateKey(key))).toBe(true);
  expect(x.keyUsage).toContain("1.3.6.1.5.5.7.3.2");
});

test("fingerprints are lowercase hex without separators", async () => {
  const { cert } = await generateClientCertificate("x");
  expect(fingerprintOf(cert)).toMatch(/^[0-9a-f]{64}$/);
  expect(normalizeFingerprint("AB:CD:ef")).toBe("abcdef");
  expect(normalizeFingerprint("sha256:ABcd")).toBe("abcd");
});
