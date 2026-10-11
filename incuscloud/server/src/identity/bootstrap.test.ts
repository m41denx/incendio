import { expect, test } from "bun:test";
import { FakeHydra } from "./fake-hydra.ts";
import { CLI_CLIENT_ID, WEB_CLIENT_ID, ensureClients, webClientSecret } from "./bootstrap.ts";

const opts = { publicUrl: "https://cloud.example", secretKey: Buffer.alloc(32, 5) };

test("creates the CLI and web clients", async () => {
  const hydra = new FakeHydra();
  await ensureClients(hydra, opts);
  const cli = hydra.clients.get(CLI_CLIENT_ID)!;
  expect(cli.token_endpoint_auth_method).toBe("none");
  expect(cli.grant_types).toContain("urn:ietf:params:oauth:grant-type:device_code");
  expect(cli.audience).toEqual(["incuscloud"]);
  expect(cli.metadata).toEqual({ first_party: true });
  const web = hydra.clients.get(WEB_CLIENT_ID)!;
  expect(web.redirect_uris).toEqual(["https://cloud.example/auth/callback"]);
  expect(web.client_secret).toBe(webClientSecret(opts.secretKey));
  expect(web.access_token_strategy).toBe("jwt");
});

test("updates drifted clients and is idempotent", async () => {
  const hydra = new FakeHydra();
  await ensureClients(hydra, opts);
  await ensureClients(hydra, { ...opts, publicUrl: "https://new.example" });
  expect(hydra.clients.get(WEB_CLIENT_ID)!.redirect_uris).toEqual(["https://new.example/auth/callback"]);
  expect(hydra.clients.size).toBe(2);
});

test("the web secret is stable per key and differs across keys", () => {
  expect(webClientSecret(Buffer.alloc(32, 1))).toBe(webClientSecret(Buffer.alloc(32, 1)));
  expect(webClientSecret(Buffer.alloc(32, 1))).not.toBe(webClientSecret(Buffer.alloc(32, 2)));
});
