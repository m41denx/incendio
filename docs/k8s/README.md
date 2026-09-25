# Incendio Kubernetes support — design & plan

Status: **implemented** (0.22-p11: create, list, detail, scale, kubeconfig,
delete; 0.22-p12: upgrades, activity log, day-2 statuses, agent updates). This
document is the original design and plan, kept for its rationale; where it
disagrees with the code, `management-appliance.md` §10–11 describe what was
actually built.

**Docs map (read in this order for current decisions):**
- [`management-appliance.md`](./management-appliance.md) — **current** source of
  truth for the management plane (k3s-in-container appliance), transport, agent
  persistence, and the Clusters-page UI. Start here. §11 covers day-2
  operations, §12 the ideas not built yet.
- [`deploy-model.md`](./deploy-model.md) — deploy/manage model; three-plane
  mental model + `user.incendio.*` schema still apply, but the operator-VM /
  kubeadm-management specifics are superseded by `management-appliance.md`.
- [`capn-reference.md`](./capn-reference.md) — pinned CAPN template variables
  the generator produces.

---

## 1. Goal

Let Incendio provision and manage Kubernetes clusters **on Incus**, using the
upstream **Cluster API Provider for Incus/LXD (CAPN)** as the underlying
mechanism:

- Docs: <https://capn.linuxcontainers.org/tutorial/quick-start.html>
- Templates: `default` (<https://capn.linuxcontainers.org/reference/templates/default.html>)
  and `ovn` (<https://capn.linuxcontainers.org/reference/templates/ovn.html>)

UX targets:

- A **Kubernetes** item under the **Cluster** menu.
- A **guided setup**: generate the Incus access credentials CAPN needs and
  produce either a ready-to-run command or a downloadable Kubernetes YAML.
- Represent clusters in Incus state so the UI can list/inspect them.

---

## 2. How CAPN actually works (and the "flavor" clarification)

CAPN is a **Cluster API (CAPI) infrastructure provider**. Moving parts:

1. **Management cluster** — a Kubernetes cluster (kind, or any k8s) where
   `clusterctl` installs the CAPI core controllers + the CAPN provider.
2. **Credentials Secret** — so the CAPN controller can reach the Incus API.
   Effectively an `incus remote` expressed as a Kubernetes Secret: server URL,
   client certificate + key **or** a trust token, plus the server certificate
   for TLS verification.
3. **`clusterctl generate cluster NAME --flavor X`** — renders the provider
   template file `cluster-template-X.yaml` by substituting environment variables
   (`KUBERNETES_VERSION`, `CONTROL_PLANE_MACHINE_COUNT`,
   `WORKER_MACHINE_COUNT`, provider-specific vars). Output is a bundle of CRs:
   `Cluster`, `IncusCluster`, `KubeadmControlPlane` + `IncusMachineTemplate`,
   `MachineDeployment` + `IncusMachineTemplate` + `KubeadmConfigTemplate`.
4. **CAPN controller** reconciles those CRs by calling the Incus API to launch
   instances and cloud-init/kubeadm-bootstrap them.

### "Flavor" is NOT an Incus profile

A **flavor** is a CAPI *template variant* (`cluster-template-<flavor>.yaml`). For
CAPN, `default` vs `ovn` is a **networking/topology** choice (native bridge vs an
OVN network + load balancer for the control-plane endpoint). The
"conversion to real resources" happens in **two stages**:

- `clusterctl` does **text templating** (vars -> concrete CAPI manifests), then
- the **CAPN controller** turns `IncusMachineTemplate` fields into real
  `incus launch` calls.

Incus **profiles** come in *inside* the machine template (it references profiles
/ sets config + devices). That is the seam where Incendio can genuinely help:
build a profile in the UI, reference it from the template.

> TODO: pin the exact `IncusCluster` / `IncusMachineTemplate` CRD fields, the
> Secret schema, and the config keys CAPN stamps on instances against the CAPN
> CRD reference + the real `cluster-template-*.yaml` files. Not yet mirrored on
> the dev box.

---

## 3. The core constraint

Incendio is a static SPA served by `incusd` at `/ui`. It has **no backend, no
management cluster, no clusterctl**. So there are three honesty levels:

1. **Generate artifacts** the user runs elsewhere (no bootstrap).
2. **Discover / visualize** CAPN clusters from Incus state (read-only).
3. **Actually bootstrap** clusters (heavy, imperative, stateful).

Level 3 cannot live in the SPA. That is what the **agent** is for.

---

## 4. Architecture decision — the `incendio-k8s` agent

Introduce a small, self-hostable **backend agent** that does the stateful,
privileged orchestration. Incendio stays a thin, **feature-gated** client.

- Tech: **Bun-compiled Elysia** (TypeScript) service. Elysia gives us CORS, JWT,
  bearer parsing, cron and an OpenAPI generator out of the box; `bun build
  --compile` yields a single static binary that a user drops on a host (systemd
  unit), like `node_exporter`. It can also ship as an OCI image or an Incus
  instance.
- The agent **hides CAPN behind a stable REST API** so Incendio calls
  `POST /v1/clusters`, not raw CAPI CRDs; CAPN churn does not break the UI.
- Configured like the Loki/logging targets: the user sets an **agent URL + token**
  in Incendio settings.

### Data flow

```
Browser (Incendio SPA)  --HTTPS+bearer-->  incendio-k8s agent  --Incus API-->  Incus
                                              |
                                              +--> mgmt cluster (kind) + clusterctl/CAPN
                                              +--> persists cluster records, kubeconfigs
```

---

## 5. Feature gate

There is **no Incus `api_extension`** for this, so the gate is config-driven
(mirrors the logging pattern):

- Enable the **Kubernetes** nav item, routes and queries only when an agent is
  **configured and reachable**.
- **Handshake:** the agent exposes `GET /v1/info -> { version, capabilities[],
  incusConnected, mgmtClusterReady }`. The UI shows the menu on a successful
  handshake and gates sub-features on `capabilities` (version negotiation lives
  here too).
- **Graduated gating (preferred):** keep the pure-UI *generator* (Phase 0)
  available without an agent; gate only the *lifecycle* actions (create/delete)
  behind the agent.
- **Config storage:** agent **URL** in Incus server config under a namespaced key
  (`user.incendio.k8s.agent_url`) so it is shared/discoverable; the **token**
  per-browser (localStorage) by default, with an option to store it server-side
  for teams that accept admin-readable secrets.

---

## 6. Agent API (stable, CAPN-agnostic) — first sketch

```
GET    /v1/info                     handshake: version, capabilities, health
POST   /v1/credentials              mint/accept the Incus access the agent uses
POST   /v1/clusters                 create (name, k8sVersion, flavor, cp/worker
                                     counts, image, profiles, network, project)
GET    /v1/clusters                 list
GET    /v1/clusters/:id             status (reconcile progress, machine roles/health)
GET    /v1/clusters/:id/kubeconfig  fetch kubeconfig
DELETE /v1/clusters/:id             delete
GET    /v1/clusters/:id/events      live bootstrap logs (SSE/WebSocket)
```

Internally the agent may run clusterctl/CAPN, or later kubeadm directly — the UI
does not care.

---

## 7. Transport realities (the main wrinkle)

Incendio is static and has **no proxy backend**, so the browser calls the agent
**cross-origin**. The agent must therefore:

- serve **HTTPS with a browser-trusted cert** (self-signed is blocked for
  `fetch`; document Caddy/real cert, an Incus network forward / proxy device in
  front, or installing the agent CA),
- send **CORS** headers for the Incendio origin, and
- authenticate with a **bearer token** over that TLS (browsers can't easily do
  client-cert mTLS, so bearer is the pragmatic choice).

The settings panel should do a live **"test connection"** with precise error
hints, because the TLS/CORS setup is where users will trip.

---

## 8. Auth / secrets model

- **Agent <-> Incus:** the agent holds its **own** least-privilege Incus client
  cert/token, ideally scoped to a k8s project. Incendio can *mint* it during
  onboarding (we already do certificate/trust-token creation) and hand it over
  via `POST /v1/credentials`.
- **Browser <-> agent:** bearer token generated by the agent on first run
  (printed to logs, like Loki), pasted into Incendio settings. Support rotation.
- **Agent <-> mgmt cluster / kubeconfigs:** stays in the agent's data dir;
  Incendio fetches on demand.

---

## 9. Representing clusters in Incus state

- Do **not** invent a bare `user.k8s`. Instead: (a) read whatever **CAPN already
  stamps** so real CAPN clusters light up, and (b) additionally stamp
  **namespaced** annotations on anything the UI/agent creates, e.g.
  `user.incendio.k8s.cluster=<name>`, `user.incendio.k8s.role=control-plane|worker`,
  `user.incendio.k8s.flavor=ovn`.
- **Project-per-cluster** is a clean grouping and aligns with pointing CAPN at a
  project.

---

## 10. Phased delivery

- **Phase 0 — menu + generator (pure UI, no agent).** Kubernetes item under
  Cluster; wizard that (1) mints Incus credentials + renders the CAPN Secret
  YAML, (2) renders a `cluster-template` manifest / prefilled `clusterctl`
  command from a form, (3) shows the `clusterctl init` prerequisites.
- **Phase 1 — discover & visualize (read-only).** Group instances into clusters
  from tags/project; show control-plane vs worker topology, health, kubeconfig
  hints.
- **Phase 2 — real bootstrap (agent-driven).** The agent runs the full lifecycle
  via CAPN; UI drives it through the stable API. This is the part the agent
  unlocks cleanly.

---

## 11. Monorepo layout (this branch)

```
incendio/                 (repo root = bun workspace)
  package.json            root workspace manifest (private, workspaces: packages/*)
  packages/
    ui/                   the existing Incendio SPA (Vite + React)
    k8s/                  the incendio-k8s agent (Bun + Elysia)
  docs/                   repo docs (incus-port/, k8s/)
  .github/workflows/      release + pr-lint-base + pr-lint-k8s
```

Agent stack: **Bun + Elysia + axios + t3-env + zod** (eden treaty optional for
end-to-end typed UI<->agent calls). Elysia provides cron, CORS, JWT, bearer
parsers and an OpenAPI generator. Whether to use workers is an open question.

---

## 12. Open decisions

1. Scope of the gate: hide the whole menu until an agent is set, or keep the
   generator visible and gate only lifecycle? (Lean: gate only lifecycle.)
2. Token storage: per-browser vs server config.
3. Agent boundary: CAPN-agnostic API (preferred) vs proxy CAPI CRDs 1:1.
4. Transport: require a reverse-proxy/real cert, and/or support an Incus
   proxy-device front so the agent sits on a trusted origin.
5. Do we bundle a management cluster inside the agent (kind) or require an
   external one?

---

## 13. First steps (done; the `k8s` branch was merged into `incus-port`)

1. Migrate the repo off yarn to **bun**.
2. Convert to a **bun-workspace monorepo** (`packages/ui`, `packages/k8s`).
3. Prune CI: drop `update_demo`, `zizmor`, `security`; disable all but `release`;
   add `pr-lint-base` and `pr-lint-k8s`.
4. Bootstrap the **`packages/k8s`** agent (Bun + Elysia + axios + t3-env + zod).
5. Ensure everything compiles, then return to Phase 0 design.
