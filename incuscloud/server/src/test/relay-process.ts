// Runs relayRequest in its own process for memory measurements:
//   bun relay-process.ts <cluster-url> <fingerprint>
// Prints its port; GET /_peak returns its peak RSS in bytes.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { relayRequest, Upstreams } from "../gateway/relay.ts";

const [url, fingerprint] = process.argv.slice(2);
const agent = new Upstreams().agentFor({ id: "c", fingerprint: fingerprint! });
let peak = process.memoryUsage().rss;
setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 50);
const server = createServer((req, res) => {
  if (req.url === "/_peak") return res.end(String(Math.max(peak, process.memoryUsage().rss)));
  relayRequest(req, res, { url: url!, agent, path: req.url!, clientIp: "127.0.0.1" });
});
server.listen(0, "127.0.0.1", () => console.log((server.address() as AddressInfo).port));
