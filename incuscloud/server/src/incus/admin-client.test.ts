import { afterAll, beforeAll, expect, test } from "bun:test";
import { FakeIncus } from "../clusters/fake-incus.ts";
import { IncusAdminClient } from "./admin-client.ts";
import { generateClientCertificate } from "./certs.ts";

let fake: FakeIncus;
let client: IncusAdminClient;
let id: { cert: string; key: string };

beforeAll(async () => {
  fake = await new FakeIncus().start();
  const c = await generateClientCertificate("incuscloud");
  id = { cert: c.cert, key: c.key };
  client = new IncusAdminClient({ url: fake.url, fingerprint: fake.fingerprint, ...id });
  await client.request("POST", "/1.0/certificates", { type: "client", trust_token: fake.token(), name: "t" });
  fake.operationSockets.set("op1", "s3cret");
});
afterAll(() => fake.stop());

test("an operation websocket opens with its secret, pinned, and carries messages", async () => {
  const ws = await client.websocket("/1.0/operations/op1/websocket?secret=s3cret");
  const echoed = new Promise<string>((resolve) => ws.once("message", (d) => resolve(String(d))));
  ws.send("hello");
  expect(await echoed).toBe("hello");
  ws.close();
});

test("a wrong secret is refused", async () => {
  await expect(client.websocket("/1.0/operations/op1/websocket?secret=nope")).rejects.toThrow(/403|Unexpected server response/);
});

test("a server that does not match the pin is refused", async () => {
  const other = new IncusAdminClient({ url: fake.url, fingerprint: "00".repeat(32), ...id });
  await expect(other.websocket("/1.0/operations/op1/websocket?secret=s3cret")).rejects.toThrow();
});

test("cancelling an operation deletes it; an operation already gone is fine", async () => {
  await client.cancel("/1.0/operations/op1");
  expect(fake.requests.some((r) => r.method === "DELETE" && r.url === "/1.0/operations/op1")).toBe(true);
  await client.cancel("missing");
});
