import { Collection } from "./base/collection";
import type { RequestContext, ScopeOptions } from "./base/types";
import type {
  Certificate,
  CertificateAddToken,
  CertificatePut,
  CertificatesPost,
  Operation,
} from "./types/generated";
import type { Input } from "../utils/types";

/** `/1.0/certificates` — trusted client certificates, keyed by fingerprint. */
export class Certificates extends Collection<
  Certificate,
  Input<CertificatesPost>,
  CertificatePut
> {
  constructor(ctx: RequestContext) {
    super(ctx, ["certificates"]);
  }

  /**
   * Issues a trust token that a client can redeem with `addWithToken`.
   * Returns the token operation; the token string is in its metadata (see
   * `tokenFromOperation`).
   */
  async createToken(
    body: {
      name: string;
      projects?: string[];
      restricted?: boolean;
      type?: string;
    },
    opts?: ScopeOptions,
  ): Promise<Operation> {
    return this.op("POST", this.url(), {
      params: this.scope(opts),
      data: { type: "client", ...body, token: true },
    });
  }

  /**
   * Adds the calling client's certificate to the trust store using a trust
   * token (untrusted callers only).
   */
  async addWithToken(trustToken: string, name?: string): Promise<void> {
    await this.request("POST", this.url(), {
      data: { type: "client", trust_token: trustToken, name },
    });
  }
}

/**
 * Builds the base64 trust token string from a token operation, like
 * `incus config trust add` prints it.
 */
export const tokenFromOperation = (op: Operation): string => {
  const request = op.metadata.request as { name?: string } | undefined;
  const token: CertificateAddToken = {
    client_name: request?.name ?? "",
    fingerprint: String(op.metadata.fingerprint ?? ""),
    addresses: (op.metadata.addresses as string[] | undefined) ?? [],
    secret: String(op.metadata.secret ?? ""),
    // Go marshals a missing expiry as the zero time.
    expires_at:
      (op.metadata.expiresAt as string | undefined) ?? "0001-01-01T00:00:00Z",
  };
  const bytes = new TextEncoder().encode(JSON.stringify(token));
  return btoa(String.fromCharCode(...bytes));
};
