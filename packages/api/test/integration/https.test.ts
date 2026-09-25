/**
 * HTTPS transport with a trusted client certificate and a pinned server
 * certificate. Runs when INCUS_TEST_URL, INCUS_TEST_CLIENT_CERT and
 * INCUS_TEST_CLIENT_KEY are set (the CI workflow sets them up).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createIncusClient } from "../../src";
import { nodeTransport } from "../../src/node";

const url = process.env.INCUS_TEST_URL;
const certPath = process.env.INCUS_TEST_CLIENT_CERT;
const keyPath = process.env.INCUS_TEST_CLIENT_KEY;
const enabled = !!(url && certPath && keyPath);

describe.if(enabled)("https transport", () => {
  const cert = enabled ? readFileSync(certPath!) : undefined;
  const key = enabled ? readFileSync(keyPath!) : undefined;

  test("pins the self-signed server certificate", async () => {
    // Learn the server cert over the unix socket (the trusted path).
    const local = createIncusClient(nodeTransport());
    const serverCert = (await local.info()).environment.certificate;
    const remote = createIncusClient(
      nodeTransport({ url, cert, key, serverCert }),
    );
    const info = await remote.info();
    expect(info.auth).toBe("trusted");
    expect(info.auth_user_method).toBe("tls");
  });

  test("websockets go through the pinned agent too", async () => {
    const serverCert = (await createIncusClient(nodeTransport()).info())
      .environment.certificate;
    const remote = createIncusClient(
      nodeTransport({ url, cert, key, serverCert }),
    );
    const sub = await remote.on("operation", () => {});
    sub.close();
    await sub.closed;
  });

  test("a wrong pin is refused before any request is sent", async () => {
    const remote = createIncusClient(
      nodeTransport({ url, cert, key, serverCert: "0".repeat(64) }),
    );
    const err = await remote.info().catch((e: unknown) => e);
    expect((err as Error).message).toContain("does not match the pinned");
  });
});
