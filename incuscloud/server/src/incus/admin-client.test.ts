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

const sha = (b: Buffer) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
function body(n: number, chunk = 100_000): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      const k = Math.min(chunk, n - sent);
      if (k <= 0) return c.close();
      c.enqueue(new Uint8Array(k).fill((sent / chunk) % 251));
      sent += k;
    },
  });
}

test("download streams a body larger than one chunk", async () => {
  let n = 0;
  for await (const c of await client.download("/1.0/stream?bytes=3000000")) n += c.length;
  expect(n).toBe(3_000_000);
});

test("download of an error is a ClusterError with the Incus message", async () => {
  await expect(client.download("/1.0/boom")).rejects.toThrow("Cluster: kaboom");
});

test("download stops when its signal aborts", async () => {
  const ac = new AbortController();
  const before = fake.slowClosed;
  const s = await client.download("/1.0/slow", { signal: ac.signal });
  const reader = s.getReader();
  await reader.read();
  ac.abort(new Error("cancelled"));
  await expect(reader.read()).rejects.toThrow("cancelled");
  for (let i = 0; i < 50 && fake.slowClosed === before; i++) await Bun.sleep(10);
  expect(fake.slowClosed).toBe(before + 1);
});

test("upload streams the body intact with its headers and returns the Incus envelope", async () => {
  const parts: Buffer[] = [];
  for await (const c of body(2_500_000)) parts.push(Buffer.from(c));
  const r = await client.upload<{ bytes: number; sha256: string; headers: Record<string, string> }>("/1.0/sink", body(2_500_000), { headers: { "X-Incus-name": "web" } });
  expect(r.metadata.bytes).toBe(2_500_000);
  expect(r.metadata.sha256).toBe(sha(Buffer.concat(parts)));
  expect(r.metadata.headers["x-incus-name"]).toBe("web");
  expect(r.metadata.headers["content-type"]).toBe("application/octet-stream");
});

test("upload stops when its signal aborts", async () => {
  const ac = new AbortController();
  const endless = new ReadableStream<Uint8Array>({
    async pull(c) {
      await Bun.sleep(2);
      c.enqueue(new Uint8Array(10_000));
    },
  });
  setTimeout(() => ac.abort(new Error("cancelled")), 50);
  await expect(client.upload("/1.0/sink", endless, { signal: ac.signal })).rejects.toThrow("cancelled");
});
