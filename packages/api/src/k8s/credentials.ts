/** A PEM client certificate and its private key. */
export interface ClientCredential {
  clientCrt: string;
  clientKey: string;
}

type Forge = typeof import("node-forge");

const loadForge = async (): Promise<Forge> => {
  try {
    const mod = (await import("node-forge")) as Forge & { default?: Forge };
    return mod.default ?? mod;
  } catch {
    throw new Error(
      "Generating a client certificate needs the `node-forge` package (npm install node-forge), or pass `credentials` explicitly",
    );
  }
};

/**
 * Mints a self-signed RSA-2048 client certificate + key (PEM) for the
 * appliance's Incus access, like the UI's credential worker. RSA keygen is
 * CPU-heavy (~0.5–2s); in browsers prefer running it in a worker.
 */
export const generateClientCredential = async (
  organization = "Incendio (Kubernetes)",
  validDays = 1000,
): Promise<ClientCredential> => {
  const forge = await loadForge();
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;

  const serial = new Uint8Array(16);
  globalThis.crypto.getRandomValues(serial);
  serial[0]! &= 0x7f; // keep the serial positive
  cert.serialNumber = Array.from(serial, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + validDays * 86_400_000);
  const subject = [
    {
      name: "organizationName",
      value: organization.replace(/[^a-zA-Z0-9 '()+,-./:=?]/g, ""),
    },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    clientCrt: forge.pki.certificateToPem(cert),
    clientKey: forge.pki.privateKeyToPem(keys.privateKey),
  };
};
