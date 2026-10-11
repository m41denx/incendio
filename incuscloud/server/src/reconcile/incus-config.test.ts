import { afterAll, beforeAll, expect, test } from "bun:test";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { IncusAdminClient } from "../incus/admin-client.ts";
import { generateClientCertificate } from "../incus/certs.ts";
import { clusterConfigFor, ensureServerConfig } from "./incus-config.ts";

let fake: FakeIncus;
let client: IncusAdminClient;
beforeAll(async () => {
  fake = await new FakeIncus().start();
  const id = await generateClientCertificate("t");
  client = new IncusAdminClient({ url: fake.url, fingerprint: fake.fingerprint, ...id });
  await client.request("POST", "/1.0/certificates", { type: "client", trust_token: fake.token(), name: "t" });
});
afterAll(() => fake.stop());

const want = clusterConfigFor({ issuer: "https://id.test/", clientId: "incus-cli", audience: "incuscloud", openfgaUrl: "https://fga.test", openfgaToken: "secret-token", storeId: "S1" });

test("cluster config for OIDC and OpenFGA", () => {
  expect(want).toEqual({
    "oidc.issuer": "https://id.test/",
    "oidc.client.id": "incus-cli",
    "oidc.audience": "incuscloud",
    "oidc.claim": "sub",
    "authorization.openfga.api.url": "https://fga.test",
    "authorization.openfga.api.token": "secret-token",
    "authorization.openfga.store.id": "S1",
    "authorization.client.oidc": "openfga",
    "authorization.client.tls": "allow",
  });
});

test("only differing keys are patched, once", async () => {
  fake.config = { "oidc.claim": "sub", "core.https_address": ":8443" };
  const changed = await ensureServerConfig(client, want);
  expect(changed.sort()).toEqual(Object.keys(want).filter((k) => k !== "oidc.claim").sort());
  expect(fake.config["core.https_address"]).toBe(":8443");
  expect(fake.config["authorization.openfga.store.id"]).toBe("S1");
  const before = fake.patches.length;
  expect(await ensureServerConfig(client, want)).toEqual([]);
  expect(fake.patches.length).toBe(before);
});
