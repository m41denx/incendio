// Browser-safe certificate helpers (WebCrypto only).

const PEM_BLOCK =
  /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/;

/** Base64 DER inside a PEM certificate — what `POST /1.0/certificates` takes. */
export const pemBody = (pem: string): string => {
  const match = PEM_BLOCK.exec(pem);
  if (!match) throw new Error("No PEM certificate block found");
  return match[1]!.replace(/\s+/g, "");
};

/**
 * Canonical fingerprint spelling: lowercase hex without separators.
 * Accepts `sha256:ab…`, `AB:CD:…` (Node's `fingerprint256`) or plain hex.
 */
export const normalizeFingerprint = (fingerprint: string): string =>
  fingerprint
    .trim()
    .replace(/^sha256:/i, "")
    .replace(/:/g, "")
    .toLowerCase();

/** Lowercase hex SHA-256 of the certificate's DER bytes, as Incus reports fingerprints. */
export const certificateFingerprint = async (pem: string): Promise<string> => {
  const der = Uint8Array.from(atob(pemBody(pem)), (c) => c.charCodeAt(0));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", der);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
};
