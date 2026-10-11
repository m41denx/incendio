import { ApiError } from "../lib/errors.ts";
import { normalizeFingerprint } from "./certs.ts";

/** An Incus certificate add token (`incus config trust add`), decoded. */
export interface TrustToken {
  clientName: string;
  /** SHA-256 of the server certificate, lowercase hex. */
  fingerprint: string;
  /** host:port pairs the server listens on. */
  addresses: string[];
  secret: string;
  expiresAt: Date | null;
}

const invalid = () => new ApiError(400, "invalid_token", "This is not a valid trust token (run `incus config trust add <name>` on the cluster)");

/** Decodes a trust token; rejects malformed and expired ones. */
export function decodeTrustToken(input: string): TrustToken {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(Buffer.from(input.trim(), "base64").toString("utf8"));
  } catch {
    throw invalid();
  }
  const addresses = raw.addresses;
  if (
    typeof raw.client_name !== "string" ||
    typeof raw.fingerprint !== "string" ||
    typeof raw.secret !== "string" ||
    !raw.secret ||
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    !addresses.every((a) => typeof a === "string")
  ) {
    throw invalid();
  }
  // Go's zero time means "never expires".
  const expires = typeof raw.expires_at === "string" && !raw.expires_at.startsWith("0001-") ? new Date(raw.expires_at) : null;
  if (expires && expires.getTime() < Date.now()) {
    throw new ApiError(400, "token_expired", "This trust token has expired; create a new one");
  }
  return { clientName: raw.client_name, fingerprint: normalizeFingerprint(raw.fingerprint), addresses, secret: raw.secret, expiresAt: expires };
}
