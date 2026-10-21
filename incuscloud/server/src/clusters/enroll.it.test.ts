import { expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import { fingerprintOf } from "../incus/certs.ts";
import { clusterClient, enrollCluster } from "./enroll.ts";

// Live: IC_IT_TRUST_TOKEN = `incus config trust add <name> --quiet` on a real cluster.
const token = process.env.IC_IT_TRUST_TOKEN;

test.if(!!token)("enrols a real Incus cluster and cleans up", async () => {
  const deps = { db: await testDb(), secretKey: Buffer.alloc(32, 9) };
  const row = await enrollCluster(deps, { name: "it", token: token! });
  const client = clusterClient(deps, row);
  const server = await client.server();
  expect(server.auth).toBe("trusted");
  expect(server.environment.server_version).toMatch(/^\d+\.\d+/);
  // Remove our certificate again.
  await client.request("DELETE", `/1.0/certificates/${fingerprintOf(row.clientCert)}`);
  expect((await clusterClient(deps, row).server()).auth).toBe("untrusted");
});
