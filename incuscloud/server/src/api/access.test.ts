import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { clusters, placements, serviceAccounts, users } from "../db/schema.ts";
import { harness } from "../test/harness.ts";

let h: Awaited<ReturnType<typeof harness>>;
let lab: string;
let acme: { id: string };
let beta: { id: string };

beforeEach(async () => {
  h = await harness();
  lab = (await h.db.insert(clusters).values({ name: "lab", url: "https://10.0.0.5:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  acme = await h.tenant("acme");
  beta = await h.tenant("beta");
  await h.db.insert(placements).values([
    { tenantId: acme.id, clusterId: lab, project: "acme", status: "ready" },
    { tenantId: beta.id, clusterId: lab, project: "beta-lab", status: "ready" },
  ]);
});

const who = (r: { body: { platform?: Array<{ name: string; role: string; relation: string }>; tenants: Array<{ tenant: { slug: string }; project: string; members: Array<{ name: string; kind: string; role: string; relation: string }> }> } }) => ({
  platform: r.body.platform?.map((p) => `${p.name}:${p.role}→${p.relation}`),
  tenants: r.body.tenants.map((t) => `${t.tenant.slug}/${t.project}: ${t.members.map((m) => `${m.name}(${m.kind}):${m.role}→${m.relation}`).join(", ")}`),
});

test("a cluster's access: platform roles on the server, each placed tenant's members on its project, as the reconciler grants them", async () => {
  const op = await h.user("op@example.com", { platformRole: "operator" });
  await h.user("ann@example.com", { tenants: { [acme.id]: "owner" } });
  await h.user("vic@example.com", { tenants: { [acme.id]: "viewer" } });
  await h.user("bob@example.com", { tenants: { [beta.id]: "member" } });
  const gone = await h.user("old@example.com", { tenants: { [acme.id]: "member" } });
  await h.db.update(users).set({ disabled: true }).where(eq(users.id, gone.id));
  await h.db.insert(serviceAccounts).values({ name: "ci", clientId: "sa-ci", tenantId: acme.id });
  const r = await h.call(op, "GET", "/api/v1/access?cluster=lab");
  expect(r.status).toBe(200);
  expect(who(r)).toEqual({
    platform: ["op:operator→operator"],
    tenants: ["acme/acme: ann(user):owner→operator, ci(service-account):member→operator, vic(user):viewer→viewer", "beta/beta-lab: bob(user):member→operator"],
  });
  // One project: its tenant only.
  expect(who(await h.call(op, "GET", "/api/v1/access?cluster=lab&project=beta-lab")).tenants).toEqual(["beta/beta-lab: bob(user):member→operator"]);
});

test("tenant members see their own tenants' access, not the platform's or other tenants'", async () => {
  await h.user("op@example.com", { platformRole: "operator" });
  const ann = await h.user("ann@example.com", { tenants: { [acme.id]: "member" } });
  await h.user("bob@example.com", { tenants: { [beta.id]: "member" } });
  const r = await h.call(ann, "GET", "/api/v1/access?cluster=lab");
  expect(r.status).toBe(200);
  expect(who(r)).toEqual({ platform: undefined, tenants: ["acme/acme: ann(user):member→operator"] });
});

test("an unknown cluster, or one the caller cannot reach, is not found", async () => {
  const ann = await h.user("ann@example.com", { tenants: { [acme.id]: "member" } });
  expect((await h.call(ann, "GET", "/api/v1/access?cluster=nope")).status).toBe(404);
  const edge = (await h.db.insert(clusters).values({ name: "edge", url: "https://10.0.0.6:8443", fingerprint: "f", serverCert: "", clientCert: "", clientKeyEnc: "", status: "ready" }).returning())[0]!.id;
  void edge;
  expect((await h.call(ann, "GET", "/api/v1/access?cluster=edge")).status).toBe(404);
  expect((await h.call(null, "GET", "/api/v1/access?cluster=lab")).status).toBe(401);
});
