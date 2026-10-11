# IncusCloud P0 — Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove or disprove the four assumptions the IncusCloud design rests on, with throwaway code, and record the answers.

**Architecture:** Local Ory Hydra (in-memory) as OIDC issuer with a tiny Bun login/consent stub; the local Incus 7.5.1 as cluster A; a nested Incus container as cluster B; a ~100-line Bun reverse proxy. Nothing here ships; findings go to `incuscloud/docs/spikes.md` and feed the P1 plan.

**Tech Stack:** Bun 1.4, Ory Hydra ≥ v25.4 (linux arm64 binary), Incus 7.5.1, stock `incus` CLI, openssl.

**Spec:** `docs/superpowers/specs/2026-10-11-incuscloud-design.md` (D1, D2, D3, D6, D11; §3.3).

## Global Constraints

- Hydra ≥ v25.4 (device authorization grant), JWT access tokens, audience `incuscloud`.
- Incus identity claim: `oidc.claim=sub`.
- The proxy must never present a TLS client certificate on proxied calls (D6).
- Everything the spikes change on the local Incus is reverted at the end of each task (`oidc.*`, trusted certs, `incuscloud-dev` project).
- Dev artefacts live in `incuscloud/.dev/` (git-ignored); spike code in `incuscloud/spikes/` (committed for reference, never imported).

## Review Focus

- Incus restarted while `oidc.issuer` points at a dead Hydra: does incusd still start? (Expect: yes, OIDC is lazy; verify, since the 7.5 OpenFGA patch showed startup can depend on external services.)
- A token for the wrong audience or an expired token through the proxy: Incus must answer 403/401 with its own error, and the proxy must pass it through unchanged.
- Websocket upgrade through the proxy when the caller's token is missing: proxy must refuse before upgrading.
- Large upload (≥ 1 GiB) through the proxy: constant memory (stream, not buffer).
- Path-prefixed remote: if the `incus` CLI drops the prefix, host routing (D11) becomes the documented default.

---

### Task 1: Dev toolchain and TLS

**Files:**
- Create: `incuscloud/scripts/dev-deps.sh`, `incuscloud/.gitignore`

- [ ] **Step 1:** Write `dev-deps.sh`: downloads the pinned Hydra release for the host arch into `incuscloud/.dev/bin/`, creates a dev CA and a server certificate for `127.0.0.1` and the host's bridge IP in `incuscloud/.dev/tls/`, idempotent.
- [ ] **Step 2:** Run it; `incuscloud/.dev/bin/hydra version` prints ≥ v25.4.
- [ ] **Step 3:** Install the dev CA into the host trust store (`/usr/local/share/ca-certificates/incuscloud-dev.crt`, `update-ca-certificates`) so incusd can verify the issuer; restart incus so Go reloads the system pool; confirm instances are still running.
- [ ] **Step 4:** Commit (`incuscloud/.gitignore` ignores `.dev/`).

### Task 2: Spike A — Incus accepts Hydra tokens

**Files:**
- Create: `incuscloud/spikes/hydra.yml`, `incuscloud/spikes/login-stub.ts`

- [ ] **Step 1:** `hydra.yml`: `dsn: memory`, issuer `https://127.0.0.1:4444/`, TLS from `.dev/tls`, `strategies.access_token: jwt`, login/consent/device URLs pointing at the stub on :3000.
- [ ] **Step 2:** `login-stub.ts` (Bun.serve): `/login?login_challenge` → accept with `subject: "spike-user"`; `/consent?consent_challenge` → accept with `grant_scope` + `grant_access_token_audience: ["incuscloud"]`; `/device?device_challenge&user_code` → accept via admin API.
- [ ] **Step 3:** Create clients with the admin API: `incus-cli` (public; grant types authorization_code, refresh_token, device_code; audience incuscloud; scopes openid offline_access email profile) and `spike-svc` (client_secret_post; client_credentials; audience incuscloud).
- [ ] **Step 4:** Point the local Incus at Hydra: `oidc.issuer=https://127.0.0.1:4444/`, `oidc.client.id=incus-cli`, `oidc.audience=incuscloud`, `oidc.claim=sub`.
- [ ] **Step 5:** Client credentials: get a token for `spike-svc`; `curl -H "Authorization: Bearer $T" https://127.0.0.1:8443/1.0` → expect `auth: trusted`, `auth_user_method: oidc`, `auth_user_name: spike-svc`.
- [ ] **Step 6:** Negative cases: token without audience, expired token, garbage token → record Incus's status and error text.
- [ ] **Step 7:** Device flow with the stock CLI: `incus remote add spike https://127.0.0.1:8443 --auth-type=oidc --accept-certificate`; open the printed verification URL with curl (stub auto-accepts); `incus list spike:` works; `auth_user_name` = `spike-user`.
- [ ] **Step 8:** Stop Hydra, `systemctl restart incus` → does incusd start? Record.
- [ ] **Step 9:** Revert: remove remote, unset `oidc.*`, restart Hydra not needed. Write results to `incuscloud/docs/spikes.md` §A. Commit.

### Task 3: Spike B — Bun reverse proxy

**Files:**
- Create: `incuscloud/spikes/proxy.ts`

- [ ] **Step 1:** `proxy.ts`: Bun.serve on :9443 (TLS from `.dev/tls`); route `/clusters/local/*` → `https://127.0.0.1:8443/*`; require `Authorization: Bearer`; forward method, headers minus hop-by-hop, body as stream (`duplex: "half"`); pin the Incus server cert (`tls: { ca: serverCert }`), no client cert; websocket upgrade → open upstream `WebSocket` with the same Authorization header and pipe frames both ways.
- [ ] **Step 2:** With Spike A's `oidc.*` set again: `curl` `/clusters/local/1.0/instances` with a bearer → same JSON as direct.
- [ ] **Step 3:** CLI through the proxy: `incus remote add viaproxy https://127.0.0.1:9443/clusters/local --auth-type=oidc` → does the CLI keep the path prefix for REST, operations and websockets? Try `incus list`, `incus exec kj -- uname -a`, `incus file push` of a 1 GiB file (watch proxy RSS), `incus monitor` (events websocket).
- [ ] **Step 4:** If the prefix is dropped anywhere: add host routing (`local.clusters.127.0.0.1.nip.io`-style via `--resolve` or an /etc/hosts entry) and repeat Step 3.
- [ ] **Step 5:** Missing/invalid token on a websocket path → proxy answers 401 without upgrading.
- [ ] **Step 6:** Revert Incus `oidc.*`. Results to `spikes.md` §B. Commit.

### Task 4: Spike C — cross-cluster migration

**Files:**
- Create: `incuscloud/spikes/migrate.ts`

- [ ] **Step 1:** Cluster B: project `incuscloud-dev` on the local Incus with a privileged, nested container `cluster-b` running Incus from Zabbly (`incus admin init --auto`, HTTPS on 8443, a `dir` pool).
- [ ] **Step 2:** Admin certs: one client certificate trusted by A and B (spike only).
- [ ] **Step 3:** `migrate.ts` (using `@incendio/api/node` transport): create a small container on A; source `POST /1.0/instances/<n>` `{migration:true}`; target `POST /1.0/instances` with `source.type=migration, mode=pull, operation=<A op URL>, certificate=<A cert>, secrets`. Expect the instance on B.
- [ ] **Step 4:** Refresh: change a file on A, repeat with `source.refresh=true`; expect the change on B, faster.
- [ ] **Step 5:** Relay mode (target cannot reach source): source `migration:true`, target `mode=push`… or both sides' websockets relayed by the spike process; measure that it works. Record which modes work.
- [ ] **Step 6:** Clean up (instances on A and B stay for P1 tests only if useful; trusted spike cert removed). Results to `spikes.md` §C. Commit.

### Task 5: Decide

- [ ] **Step 1:** Update the spec's decisions table with what changed (e.g. D11 default routing, relay requirement for D-mobility).
- [ ] **Step 2:** Add any blockers to `QUESTIONS.md`. Commit.
