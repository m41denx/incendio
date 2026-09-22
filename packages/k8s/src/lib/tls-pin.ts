import { Agent, type AgentOptions, type RequestOptions } from "node:https";
import { connect, type TLSSocket } from "node:tls";
import { X509Certificate } from "node:crypto";
import type { Duplex } from "node:stream";

/** SHA-256 fingerprint in getPeerCertificate().fingerprint256 format. */
export function pemFingerprint256(pem: string): string {
  return new X509Certificate(pem).fingerprint256;
}

export interface PinnedAgentOptions extends AgentOptions {
  /** The exact server certificate to accept (PEM). */
  pinnedCertPem: string;
}

/**
 * HTTPS agent that trusts exactly one server certificate, by fingerprint.
 *
 * Incus serves a self-signed *leaf* (CA:FALSE) whose SANs usually omit the
 * address we dial, so `ca` pinning cannot work: Bun rejects a leaf as a trust
 * anchor ("unable to verify the first certificate") and hostname checks would
 * fail anyway. Bun also never calls `checkServerIdentity`. So we skip chain
 * validation and compare the peer cert's fingerprint ourselves — the same
 * trust decision `incus remote add` makes when it pins a server cert.
 *
 * The socket is handed to the HTTP layer only after the check passes, so no
 * request bytes (or client-cert auth) reach a server we did not pin.
 */
export class PinnedAgent extends Agent {
  private readonly fingerprint: string;

  constructor({ pinnedCertPem, ...options }: PinnedAgentOptions) {
    super(options);
    this.fingerprint = pemFingerprint256(pinnedCertPem);
  }

  override createConnection(
    options: RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const socket: TLSSocket = connect({
      ...(options as object),
      rejectUnauthorized: false,
    });
    const done = (err: Error | null) => callback?.(err, socket);
    const onError = (err: Error) => {
      done(err);
    };
    socket.once("error", onError);
    socket.once("secureConnect", () => {
      socket.off("error", onError);
      const presented = socket.getPeerCertificate().fingerprint256;
      if (presented !== this.fingerprint) {
        const err = new Error(
          `Incus server certificate ${presented} does not match the pinned ${this.fingerprint}`,
        );
        // No error arg: that would emit an unhandled 'error' on the socket.
        socket.destroy();
        done(err);
        return;
      }
      done(null);
    });
    // Returning nothing makes the agent wait for the callback.
    return undefined;
  }
}
