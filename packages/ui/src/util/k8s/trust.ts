import { fetchCertificates, trustClientCertificate } from "api/certificates";
import { LxdApiError } from "util/helpers";

// Incus trust for the management appliance's client certificate. The agent
// (and CAPN through it) talks to Incus with this cert, so until it is in the
// trust store every project/instance call comes back "untrusted". The SPA is
// already an authenticated Incus client, so it can add the cert itself.

const PEM_BLOCK =
  /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/;

/** Base64 DER inside a PEM certificate — what POST /1.0/certificates takes. */
export const pemBody = (pem: string): string => {
  const match = PEM_BLOCK.exec(pem);
  if (!match) throw new Error("No PEM certificate block found");
  return match[1].replace(/\s+/g, "");
};

/** Lowercase hex SHA-256 of the DER bytes, as Incus reports fingerprints. */
export const certificateFingerprint = async (pem: string): Promise<string> => {
  const der = Uint8Array.from(atob(pemBody(pem)), (c) => c.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", der);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};

const APPLIANCE_CERT_NAME = "incendio-k8s-appliance";

/**
 * Whether Incus fully trusts this cert. A restricted entry would still fail the
 * agent's project creation, so it does not count.
 */
export const isCertificateTrusted = async (pem: string): Promise<boolean> => {
  const fingerprint = await certificateFingerprint(pem);
  const trusted = await fetchCertificates();
  return trusted.some(
    (cert) => cert.fingerprint === fingerprint && !cert.restricted,
  );
};

/** Add the appliance's client cert to the Incus trust store (idempotent). */
export const trustApplianceCertificate = async (pem: string): Promise<void> => {
  try {
    await trustClientCertificate(
      pemBody(pem),
      APPLIANCE_CERT_NAME,
      "Incendio Kubernetes management appliance (agent + CAPN)",
    );
  } catch (error) {
    // Already in the trust store: nothing to do.
    if (error instanceof LxdApiError && error.status === 409) return;
    if (/already/i.test((error as Error).message)) return;
    throw error;
  }
};
