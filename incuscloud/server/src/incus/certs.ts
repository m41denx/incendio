import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import { X509Certificate } from "node:crypto";

/** `AB:CD…`, `sha256:abcd…` and `abcd…` all become `abcd…`. */
export const normalizeFingerprint = (f: string) => f.replace(/^sha256:/i, "").replaceAll(":", "").toLowerCase();

/** SHA-256 fingerprint of a PEM certificate, lowercase hex. */
export const fingerprintOf = (pem: string) => normalizeFingerprint(new X509Certificate(pem).fingerprint256);

const pemWrap = (label: string, der: ArrayBuffer) =>
  `-----BEGIN ${label}-----\n${Buffer.from(der).toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

/** A self-signed ECDSA P-384 TLS client certificate (10 years), as Incus clients use. */
export async function generateClientCertificate(commonName: string): Promise<{ cert: string; key: string }> {
  const alg = { name: "ECDSA", namedCurve: "P-384", hash: "SHA-384" };
  const keys = await crypto.subtle.generateKey(alg, true, ["sign", "verify"]);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex"),
    name: `CN=${commonName}, O=IncusCloud`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 3650 * 86_400_000),
    signingAlgorithm: alg,
    keys,
    extensions: [
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.clientAuth]),
    ],
  });
  return { cert: cert.toString("pem"), key: pemWrap("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", keys.privateKey)) };
}
