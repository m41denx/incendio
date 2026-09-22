import forge from "node-forge";
import type { IncusClientCredential } from "util/k8s/capn";

// Web worker: mint an RSA client certificate + private key (PEM) for the CAPN
// infrastructure Secret. Runs off the main thread because RSA keygen blocks.

self.onmessage = () => {
  self.postMessage(generateClientCredential());
};

const getRandomBytes = (n: number) => {
  const crypto = self.crypto;
  const QUOTA = 65536;
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i += QUOTA) {
    crypto.getRandomValues(a.subarray(i, i + Math.min(n - i, QUOTA)));
  }
  return a;
};

const details = [
  {
    name: "organizationName",
    value: `Incendio ${location.hostname} (Kubernetes)`.replace(
      /[^a-zA-Z0-9 '()+,-./:=?]/g,
      "",
    ),
  },
];

const generateClientCredential = (): IncusClientCredential => {
  const validDays = 1000;

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;

  const serialBytes = getRandomBytes(16);
  if (serialBytes[0] >= 128) {
    serialBytes[0] &= 0x7f;
  }
  cert.serialNumber = Array.from(serialBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(
    Date.now() + 1000 * 60 * 60 * 24 * validDays,
  );
  cert.setSubject(details);
  cert.setIssuer(details);
  cert.sign(keys.privateKey);

  return {
    crt: forge.pki.certificateToPem(cert),
    key: forge.pki.privateKeyToPem(keys.privateKey),
  };
};
