# Incendio — Incus port: feature parity & task sheet

Incendio is a fork of [`canonical/lxd-ui`](https://github.com/canonical/lxd-ui) being
adapted to [Incus](https://github.com/lxc/incus). This directory is the plan.

- **Base:** tag `0.22` (`6d62c339d6`), branch `incus-port`.
- **Reference:** [`zabbly/incus-ui-canonical`](https://github.com/zabbly/incus-ui-canonical) — the
  existing Incus UI, forked from lxd-ui at `9cbb82d9` (Apr 2026) with **112 commits** of
  Incus adaptation on top. Added as git remote `zabbly`.
- **Sources for reference:** `lxc/incus` and `canonical/lxd` (cloned under `~/refs`).

Detailed analyses live in [`analysis/`](analysis/): A = feature opportunities, B = LXD/Canonical
dead code, C = the 84-commit port map, D = config-key & terminology deltas.

---

## The core fact

LXD and Incus share the `/1.0/` REST API. Of the extensions each exposes:

| Set | Count | Consequence for the UI |
|---|---:|---|
| **Shared** | 369 | lxd-ui code works on Incus unchanged |
| **Incus-only** | 187 | Incus capabilities with no LXD-UI surface → **new-feature candidates** |
| **LXD-only** | 117 | lxd-ui gates that never fire on Incus → **dead/broken code to remove** |

(Live Incus 7.4 daemon reports 553 extensions. Numbers computed from each project's
`doc/api-extensions.md`, `LC_ALL=C` normalized.)

So the adaptation is **surgical, not a rewrite**: rebrand, swap Canonical bits, remove
LXD-only surface, then add Incus features.

---

## What the 0.22 base means (important)

zabbly forked lxd-ui **167 commits before** `0.22`. Basing on `0.22` gives us a newer, cleaner
lxd-ui — but it also drags in **LXD-only features that post-date zabbly's fork**, which zabbly
never had to handle and which are wrong on Incus:

- **replicators**, **cluster links**, **LXD load-balancer *pools*** (distinct from Incus's plain
  network load balancers), **managed cloud-init SSH keys**, **instance import/conversion** — all
  fail *closed* (nav hidden) on Incus, so harmless but dead weight.
- **placement groups** — fails **open**: nav + route are unconditional and `GET /1.0/placement-groups`
  **404s on Incus**, so the page errors. Highest-priority breakage.
- **PowerFlex / PowerStore / Pure / Alletra** enterprise storage drivers — dead forms; and the
  same allow-list silently hides Incus's own **LINSTOR / TrueNAS** drivers.

This extra surface is net-new work beyond replaying zabbly's patches — captured in the tasks below.

---

## Port strategy (decided)

**Rebase** zabbly's Incus commits onto `0.22`, preserving upstream authorship. Because 75 of 84
non-merge commits touch files that also changed upstream (`9cbb82d9`→`0.22`), a blind
`git rebase` conflicts heavily. Instead port in **dependency-ordered clusters** (see
[`analysis/C`](analysis/C-zabbly-patchmap.md)), resolving each against the already-Incus-ified base:

1. rebrand → 2. core-api/config → 3. features → 4. bugfixes. Drop the 1 upstreamed commit.

---

## Three-phase plan

> **Status (2026-09-20):** Phase 0 + Phase 1 **complete** and deployed to `/opt/incus/ui`.
> Phase 2 **in progress** — done so far: instance-config coverage (101/110 keys), storage-pool
> driver forms, **OVN interconnect network integrations** (+ remote peers), and **OVN network
> load balancers**. Remaining Incus gaps are checklisted under "Phase 2" below. See
> [`PORT-LOG.md`](PORT-LOG.md) for the authoritative per-commit record.

<details>
<summary><strong>Phase 0 — Foundation &amp; branding</strong> <em>(prereq)</em> — ✅ complete</summary>

- [x] Branding sweep → **Incendio** name; **MicroCloud logo** where possible, else LXD logo
      (`Logo.tsx`, `title.tsx`, `favicon.tsx`, `certificate.tsx`). Drop the LXD/MicroCloud branches.
- [x] External links → Incus: docs base `/documentation` (remote `linuxcontainers.org/incus/docs`),
      forum `discuss.linuxcontainers.org`, bug/issue links → incendio repo. *(analysis D §6)*
- [x] Image servers → `images.linuxcontainers.org`; relabel to "Linux Containers". *(D §6, B §2b)*
- [x] Remove the LXD version-check nag. *(B §2c)*

</details>

<details>
<summary><strong>Phase 1 — Parity</strong> (a working Incus UI on the 0.22 base) — ✅ complete</summary>

**1a. Remove LXD-only / Canonical surface** *(analysis B, D)*
- [x] **Remove placement groups** (fails open / 404s). *(B §2a — highest priority)*
- [x] Storage drivers: drop PowerFlex/PowerStore/Pure/Alletra; add **LINSTOR + TrueNAS**. *(D §3, B §1b)*
- [x] Remove/leave-gated: replicators, cluster-links, LXD load-balancer *pools*, managed SSH keys,
      import/conversion, backup-metadata-version, boot-mode. *(B §1a)*
- [x] `storage_volumes_all`: kept gated on the base `storage_volumes_all` extension (which serves
      `GET /1.0/storage-volumes`). Incus 7.4 ships only `storage_volumes_all_projects` (a param on that
      endpoint) but not the endpoint itself, so the flag is false there and the UI collects volumes
      per pool. *(B §1c — gating on `_all_projects` 404s the volumes list; reverted.)*
- [x] **Access area (revised — see `analysis/` + memory `incus-auth-model`):** Incus has **no** permissions-management API (OpenFGA is external/config-driven). So: disable the LXD identity/fine-grained section, and build the Incus-manageable surfaces — a **Trusted Certificates** page (`/1.0/certificates`) + read-only `instance_access`/`project_access` panels. *(B §2d)*
- [x] Deleted the unused `hasExplicitTrustToken` flag. *(B §1c)*

**1b. Config-key & terminology deltas** *(analysis D)*
- [x] Rename `user.ui_*` → `user.ui.*` (4 keys); add `user.ui.sso_only`, `user.ui.image_servers`. *(D §1)*
- [x] **Fix zabbly's miss:** `security.devlxd[.images]` → `security.guestapi[.images]`; `/dev/lxd`→`/dev/incus`. *(D §2)*
- ~~Terminology: "Cluster member"→"Location"; drop "(VMs/Containers only)" qualifiers.~~ *(D §5 — intentionally out of scope)*

**1c. Port zabbly's Incus features & fixes** *(analysis C — 83 portable commits)*
- [x] core-api/config cluster: certificate generation, OpenFGA, key renames, storage-driver match.
- [x] Feature clusters (port as ordered units): **console/terminal**, **migration**
      (action→live-storage→bulk→remote-cluster), **IncusOS pages**, **instance filtering**,
      **storage driver/LVM-cluster**, OCI creation, special disks, custom-volume target selection,
      user-properties, project Usage page, custom image servers, GPU by vendor/product, io.bus=usb ISO.
- [x] **Load balancers:** DROP zabbly's version; adopt `0.22`'s native LB tree; verify vs Incus
      `network_load_balancer`. *(C — dropped commit)*
- [x] Bugfix cluster (28 commits): terminal reconnection, null-safety, snapshot/volume fixes, OIDC logout, etc.

**1d. Verify parity**
- [x] `yarn lint-js` + `yarn test-js` green.
- [x] Manual smoke against the local Incus 7.4 daemon (API-level; daemon reachable via unix socket).
- [x] Compare behavior against the shipped `incus-ui-canonical` (`/opt/incus/ui`).

</details>

<details open>
<summary><strong>Phase 2 — Incus features beyond zabbly</strong> <em>(analysis A — prioritized)</em> — 🚧 in progress</summary>

**Done**
- [x] **Storage-pool driver forms** — LINSTOR + TrueNAS + LVM/Btrfs/Dir sub-forms, extended
      Ceph/CephFS/CephObject; +31 pool config keys. Driver picker greys out unsupported drivers.
- [x] **Network integrations** (OVN interconnect) CRUD — server-global List/Create/Edit
      (`ovn.northbound_connection`/`southbound_connection`/certs/transit pattern), gated on
      `network_integrations`. Consumption side too: OVN networks create `type: remote` peers
      targeting an integration (peer form + NetworkPeers table). Nav "Interconnect" below Clustering.
- [x] **OVN network load balancers** (backend model, `network_load_balancer`) — the Load balancers
      tab was gated behind the LXD-only pool extension and never showed on Incus; now a backend-based
      form (backends + ports→target_backend) create/edit/delete, pool sub-nav hidden on Incus.
- [x] **First-class VM knobs** (part of instance-config coverage, 101/110 settable keys) —
      `boot.autorestart`, `limits.memory.hotplug`, `limits.memory.oom_priority`, `migration.stateful`,
      `security.iommu`, `security.selinux.*`, `security.sev*`, syscalls intercept, `nvidia.runtime`,
      OCI, and a raw-config section (`raw.lxc/qemu/apparmor/...`).
- [x] **Network address sets** (`network_address_set`) — project-scoped CRUD of named IP/CIDR/range
      groups (List/Create/Edit), nav under Networking; ACL rule source/destination help notes the
      `$name` reference syntax.
- [x] **Network zones** (`network_dns` / `network_dns_records`) — project-scoped List/Create/Edit of
      DNS zones (name, description, `dns.nameservers`) + a Records section (type/value/ttl entries).
- [x] **Load-balancer health checks + live state** (`network_load_balancer_health_check`, `_state`) —
      health-check config on the backend LB form + a live "Backend health" panel on the edit page.
- [x] **Forward SNAT** toggle (`network_forward_snat`) on bridged-network forwards.
- [x] **DNS nameservers** (`dns.nameservers`) field for bridged/OVN networks. (DHCP routes / IPv6
      stateful were already rendered by the network form.)
- [x] **VGA console screenshot** (`instance_console_screenshot`) — download a PNG of a running VM console.
- [x] Snapshot schedule **`@midnight` / `@startup`** aliases (`snapshots_schedule_aliases`).
- [x] **UEFI/NVRAM viewer** (`instance_nvram`) — a VM-only "UEFI Variables" tab on the instance detail
      page: lists variables grouped by GUID (attributes, dissected value, byte size) with per-variable
      delete. Reads `GET /1.0/instances/{name}/nvram?recursion=2`.
- [x] **QEMU scriptlet** config (`qemu_scriptlet`) — `raw.qemu.scriptlet` now uses a CodeMirror editor
      (line numbers/folding) in the Raw-configuration section; the scriptlet + `raw.qemu.qmp.*` +
      `raw.qemu.conf` rows are now gated on their API extensions (`qemu_scriptlet`, `qemu_raw_qmp`,
      `qemu_raw_conf`) so they only show when supported.
- [x] **NIC-device type options** — the network-device panel now renders nictype-specific fields based
      on the selected managed network's type: macvlan **mode** (bridge/vepa/passthru/private) + VLAN;
      SR-IOV **`security.trusted`** + **`security.mac_filtering`** + VLAN; OVN **nesting** (`nested` +
      VLAN) + **static routes** (`ipv4.routes`/`ipv6.routes`). Also fixes latent data loss: editing a
      NIC now preserves unmanaged keys (`hwaddr`, `mtu`, `boot.priority`, …). Validated all keys against
      the live daemon. (Acceleration/promiscuous stay raw-config.)

**Still missing — Incus functionality with no dedicated UI** (ranked; see [`analysis/A`](analysis/A-incus-opportunities.md))

*Networking* — ✅ nothing outstanding; the networking surface is feature-complete for the port
(integrations, address sets, zones, load balancers + health, forwards/SNAT, peers, DNS nameservers,
NIC-device type options). Remaining bits are raw-config-only advanced keys (NIC acceleration/promiscuous).

*Storage*
- [ ] **Custom-volume file browser** (`file_storage_volume` + `custom_volume_sftp`) — browse/upload/download. **High**.
- [ ] Storage **volume** config coverage (`storage_volume_*`, ~120 keys) + volume **rebuild** + `dependent` disk flag. **Med**.
- [ ] Storage **bucket backups** (export/import) + local buckets on non-object pools. **Med**.
- [ ] ZFS vdev/raid builder, btrfs compression, initial-owner on volume forms. **Med/Low**.

*Instances / VM*
- [x] Explicit **CPU topology** builder (`instance_limits_cpu_topology`) — a "topology" CPU-limit mode
      (VM/profile only) building `limits.cpu=sockets=N,cores=N,threads=N`. Daemon-validated.
- [x] Snapshot **manual expiry** + **disk-only restore** — already present in the base UI (stale entry):
      the snapshot create/edit modal has Expiry date/time inputs (`expires_at`, gate-free), and the
      restore dialog offers a "Restore the instance state" toggle for stateful snapshots (unchecked =
      disk-only; non-stateful snapshots restore disk-only anyway). Verified wired end-to-end on Incus.
- [x] Migration **refresh** (incremental) + **live** toggle (enables live project moves) — migrate dialog
      checkboxes wired to the migration POST (`instance_refresh_migration`, `instance_allow_inconsistent_copy`).
- [x] **Uptime/started-at + CPU-time** on the instance overview (Started/Uptime/CPU time/Allocated CPU time,
      from `instance_state_started_at` + `instances_state_total`).
- [x] **Richer custom-disk options**: `io.bus`/`io.cache`, combined byte/s+IOPS `limits.read/write/max`,
      `limits.max.burst`(+length), `wwn`. (tmpfs disk **source type** still TODO — separate special-disk flow.)
- [x] **SMBIOS & credentials** raw key/value editor (`smbios11.*`, `systemd.credential(.*|-binary.*)`).

*Cluster / server / auth*
- [x] **Access panels** (`instance_access`/`project_access`) + **certificate descriptions** (0.22-p10):
      read-only "who can access" table (identifier/role/provider) as an **Access** tab on instances and
      an **Access** page in the project nav (shared `ResourceAccessPanel`, gated on
      `hasInstanceAccess`/`hasProjectAccess`); Trusted Certificates gained a description column, an
      add-dialog field, and inline edit (`certificate_description`). View-only by design (Incus manages
      OpenFGA grants externally). Live-validated on Incus 7.4.
- [x] Server **logging targets** panel (loki/webhook/syslog) + **ACME** settings section — Settings →
      Logging (named `logging.*` targets CRUD) and Settings → ACME (dedicated `acme.*` form). Nav gated
      on `server_logging` / `acme`; config keys daemon-validated.
- [x] Cluster **evacuation mode** options, **rebalance** settings, cluster-group config/used-by,
      **placement scriptlet** editor — Settings → Cluster (rebalance `cluster.rebalance.*` +
      healing/offline thresholds + Starlark `instances.placement.scriptlet` editor); cluster groups
      show config + used-by (and edit no longer drops group config). Evacuation mode options + per-
      instance `cluster.evacuate` were already in the base. Daemon-validated.
- [ ] **Placement-group replacement for Incus** (proposed; design agreed, build deferred). Incus has no
      placement groups — emulate LXD's policy (compact/spread) + rigor (strict/permissive) via the
      global `instances.placement.scriptlet`. Two tiers:
      **A (faithful):** UI writes per-instance `user.placement.group/policy/rigor` and installs a
      generated `instance_placement(request, candidate_members)` scriptlet that packs (compact) or
      anti-affines (spread) using `get_instances()`, failing on strict / falling through on permissive.
      Caveat: the scriptlet is singular + server-global, so the UI must manage it as one block and
      warn/refuse when a custom scriptlet already exists; multi-member cluster only.
      **B (lightweight):** no scriptlet — at create time the UI computes a `target` member from where
      group-mates run (best-effort, create-time only, no evacuation/rebalance/CLI). **Med**.
- [ ] Project restriction toggles (`restricted.storage-pools`, VM nesting). **Low**.
- [ ] Config-coverage passes still open: **project** (~53), **server** (~107), **network** (bridge/OVN/…),
      **device** (~290) keys, and per-driver storage **volume** config.

*Integrations*
- [ ] **Kubernetes on Incus via [cluster-api-provider-incus](https://github.com/lxc/cluster-api-provider-incus)**
      (CAPN) (proposed; feasibility agreed, build deferred). CAPN is a Cluster API *infrastructure
      provider*: a Kubernetes management cluster runs CRDs (`IncusCluster`/`IncusMachine`) whose
      controller drives the Incus API to launch instances (VMs/LXC) as kubeadm-bootstrapped k8s nodes.
      Orchestration lives in Kubernetes-land, not Incus, so from Incus a cluster is just instances +
      a project + a profile + a trust cert + the kubeadm image remote. Three scopes to pick from:
      **1) Observe** — recognise CAPN instances (by project/labels) and show them grouped as a cluster
      (read-only). **Low**.
      **2) Prerequisite helpers** — a guided setup that provisions the Incus-side bits (dedicated
      project, mgmt-cluster trust token, kubeadm image remote, required profile). **Med**.
      **3) Full CAPI management** — apply/watch CRDs, drive `clusterctl` from the UI. Needs a Kubernetes
      backend, duplicates Rancher/Headlamp — **out of scope / High**.

Full ranked list with extensions/coverage: [`analysis/A`](analysis/A-incus-opportunities.md).

</details>

---

## Open decisions — RESOLVED
1. ~~**Depth of Phase 1a:**~~ **leave-gated** (dead LXD subtrees kept, subject to later porting).
2. ~~**Permissions:**~~ Incus has no perms API → disabled fine-grained perms + built **Trusted Certificates** page.
3. ~~**Phase 2 selection:**~~ instance config + storage-pool drivers + OVN integrations + OVN load
   balancers done; project/server/network/device/volume config coverage and the networking/storage/auth
   feature gaps in the Phase 2 checklist above are still open.
4. ~~**`user.ui_terminal_default_payload`:**~~ finished the `user.ui.*` rename.
