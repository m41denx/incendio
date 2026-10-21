// Spike C: move an instance between two Incus clusters, driven by a third
// party holding an admin certificate on both (the IncusCloud worker).
//   bun spikes/migrate.ts pull|refresh|relay
// Cluster A: local Incus, cluster B: nested Incus in incuscloud-dev/cluster-b.
import { request } from "node:https";
import { readFileSync } from "node:fs";
import WS from "../../packages/api/node_modules/ws/index.js";
import { PinnedAgent } from "../../packages/api/src/node.ts";

const dev = new URL("../.dev/", import.meta.url);
const read = (f: string) => readFileSync(new URL(f, dev), "utf8");
const cert = read("admin.crt");
const key = read("admin.key");

type Cluster = { name: string; url: string; serverCert: string; agent: PinnedAgent; project: string; pool: string };
const mk = (name: string, url: string, certFile: string, project: string, pool: string): Cluster => {
  const serverCert = read(certFile);
  return { name, url, serverCert, project, pool, agent: new PinnedAgent({ pin: serverCert, cert, key }) };
};
const A = mk("A", "https://10.133.241.1:8443", "incus-a.crt", "incuscloud-dev", "nevergoonalone");
const B = mk("B", "https://10.133.241.74:8443", "incus-b.crt", "default", "default");

function api<T = any>(c: Cluster, method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(c.url + path);
    const req = request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: c.agent, headers: { "content-type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        const j = JSON.parse(data);
        if (j.type === "error") reject(new Error(`${c.name} ${method} ${path}: ${j.error}`));
        else resolve(j);
      });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const wait = async (c: Cluster, opUrl: string) => {
  const r = await api(c, "GET", `${opUrl}/wait?timeout=600`);
  if (r.metadata.status !== "Success") throw new Error(`${c.name} op ${r.metadata.status}: ${r.metadata.err}`);
  return r.metadata;
};

const opWebsocket = (c: Cluster, opId: string, secret: string) =>
  new Promise<WS>((resolve, reject) => {
    const ws = new WS(`${c.url.replace("https", "wss")}/1.0/operations/${opId}/websocket?secret=${secret}`, { agent: c.agent });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });

/**
 * Pipe two websockets both ways, message by message (the control socket's
 * protobuf messages must keep their boundaries), with backpressure: reading
 * from one side pauses while the other side has HIGH bytes queued.
 */
const HIGH = 4 << 20;
const forward = (from: WS, to: WS) =>
  from.on("message", (d, bin) => {
    if (to.readyState !== WS.OPEN) return;
    to.send(d, { binary: bin }, () => {
      if (from.isPaused && to.bufferedAmount < HIGH / 2) from.resume();
    });
    if (to.bufferedAmount > HIGH) from.pause();
  });
const pipe = (a: WS, b: WS) =>
  new Promise<void>((done) => {
    forward(a, b);
    forward(b, a);
    const end = () => { a.close(); b.close(); done(); };
    a.on("close", end); b.on("close", end);
  });

async function targetRequest(name: string, src: any, sourceBlock: Record<string, unknown>) {
  const inst = (await api(A, "GET", `/1.0/instances/${name}?project=${A.project}`)).metadata;
  const config = Object.fromEntries(Object.entries(inst.config as Record<string, string>).filter(([k]) => !k.startsWith("volatile.") || k === "volatile.base_image"));
  // Map the source's storage pool and drop NICs on networks the target lacks.
  const devices: Record<string, any> = {};
  for (const [d, v] of Object.entries(inst.devices as Record<string, any>)) {
    if (v.type === "disk" && v.path === "/") devices[d] = { ...v, pool: B.pool };
    else if (v.type !== "nic") devices[d] = v;
  }
  return { name, type: inst.type, architecture: inst.architecture, config, devices, profiles: ["default"], ephemeral: false, source: { type: "migration", instance_only: true, ...sourceBlock, ...src } };
}

async function pull(name: string, refresh: boolean) {
  const t0 = Date.now();
  const op = await api(A, "POST", `/1.0/instances/${name}?project=${A.project}`, { migration: true, live: false, instance_only: true });
  const secrets = op.metadata.metadata as Record<string, string>;
  const body = await targetRequest(name, {}, {
    mode: "pull",
    operation: `${A.url}/1.0/operations/${op.metadata.id}`,
    certificate: A.serverCert,
    secrets,
    refresh,
  });
  const top = await api(B, "POST", `/1.0/instances?project=${B.project}`, body);
  await wait(B, top.operation);
  console.log(`${refresh ? "refresh" : "pull"} done in ${Date.now() - t0} ms`);
}

async function relay(name: string) {
  const t0 = Date.now();
  const sop = await api(A, "POST", `/1.0/instances/${name}?project=${A.project}`, { migration: true, live: false, instance_only: true });
  const sourceSecrets = sop.metadata.metadata as Record<string, string>;
  const body = await targetRequest(name, {}, { mode: "push" });
  const top = await api(B, "POST", `/1.0/instances?project=${B.project}`, body);
  const targetSecrets = top.metadata.metadata as Record<string, string>;
  console.log("source sockets:", Object.keys(sourceSecrets), "target sockets:", Object.keys(targetSecrets));
  const pipes: Promise<void>[] = [];
  for (const n of ["control", ...Object.keys(sourceSecrets).filter((k) => k !== "control")]) {
    if (!targetSecrets[n]) continue;
    const [s, t] = await Promise.all([opWebsocket(A, sop.metadata.id, sourceSecrets[n]), opWebsocket(B, top.metadata.id, targetSecrets[n])]);
    pipes.push(pipe(s, t));
  }
  await wait(B, top.operation);
  await Promise.all(pipes);
  console.log(`relay done in ${Date.now() - t0} ms`);
}

const mode = process.argv[2];
const name = process.argv[3] ?? "mig-src";
if (mode === "pull") await pull(name, false);
else if (mode === "refresh") await pull(name, true);
else if (mode === "relay") await relay(name);
else console.log("usage: migrate.ts pull|refresh|relay [name]");
process.exit(0);
