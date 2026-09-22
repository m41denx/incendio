import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import axios from "axios";
import { PinnedAgent, pemFingerprint256 } from "./tls-pin.ts";

// A throwaway self-signed *leaf* (CA:FALSE, SAN without the IP we dial) —
// the shape of an Incus server cert that plain `ca` pinning rejects.
let dir: string;
let certPem: string;
let server: Server;
let url: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "tls-pin-"));
  const gen = Bun.spawnSync([
    "openssl", "req", "-x509", "-newkey", "ec",
    "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
    "-days", "1", "-subj", "/CN=incus-test",
    "-addext", "basicConstraints=critical,CA:FALSE",
    "-addext", "subjectAltName=DNS:incus-test",
  ]);
  if (gen.exitCode !== 0) throw new Error(gen.stderr.toString());
  certPem = readFileSync(join(dir, "cert.pem"), "utf8");
  server = createServer(
    { cert: certPem, key: readFileSync(join(dir, "key.pem")) },
    (_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `https://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("pemFingerprint256", () => {
  it("formats like getPeerCertificate().fingerprint256", () => {
    expect(pemFingerprint256(certPem)).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});

describe("PinnedAgent", () => {
  it("connects when the server presents exactly the pinned cert", async () => {
    const agent = new PinnedAgent({ pinnedCertPem: certPem });
    const res = await axios.get(url, { httpsAgent: agent, timeout: 5000 });
    expect(res.data).toEqual({ ok: true });
    agent.destroy();
  });

  it("refuses any other cert before sending the request", async () => {
    let requests = 0;
    server.on("request", () => {
      requests += 1;
    });
    Bun.spawnSync([
      "openssl", "req", "-x509", "-newkey", "ec",
      "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", join(dir, "other.key"), "-out", join(dir, "other.pem"),
      "-days", "1", "-subj", "/CN=someone-else",
    ]);
    const other = readFileSync(join(dir, "other.pem"), "utf8");
    const agent = new PinnedAgent({ pinnedCertPem: other });
    await expect(
      axios.get(url, { httpsAgent: agent, timeout: 5000 }),
    ).rejects.toThrow(/does not match the pinned/);
    expect(requests).toBe(0);
    agent.destroy();
  });
});
