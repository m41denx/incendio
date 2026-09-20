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
> Phase 2 **in progress** — full instance-config coverage done (101/110 settable keys). See
> [`PORT-LOG.md`](PORT-LOG.md) for the authoritative per-commit record.

### Phase 0 — Foundation & branding  *(prereq for everything)*
- [x] Branding sweep → **Incendio** name; **MicroCloud logo** where possible, else LXD logo
      (`Logo.tsx`, `title.tsx`, `favicon.tsx`, `certificate.tsx`). Drop the LXD/MicroCloud branches.
- [x] External links → Incus: docs base `/documentation` (remote `linuxcontainers.org/incus/docs`),
      forum `discuss.linuxcontainers.org`, bug/issue links → incendio repo. *(analysis D §6)*
- [x] Image servers → `images.linuxcontainers.org`; relabel to "Linux Containers". *(D §6, B §2b)*
- [x] Remove the LXD version-check nag. *(B §2c)*

### Phase 1 — Parity (a working Incus UI on the 0.22 base)
**1a. Remove LXD-only / Canonical surface** *(analysis B, D)*
- [x] **Remove placement groups** (fails open / 404s). *(B §2a — highest priority)*
- [x] Storage drivers: drop PowerFlex/PowerStore/Pure/Alletra; add **LINSTOR + TrueNAS**. *(D §3, B §1b)*
- [x] Remove/leave-gated: replicators, cluster-links, LXD load-balancer *pools*, managed SSH keys,
      import/conversion, backup-metadata-version, boot-mode. *(B §1a)*
- [ ] `storage_volumes_all` → re-gate on Incus's `storage_volumes_all_projects`. *(B §1c)*
- [x] **Access area (revised — see `analysis/` + memory `incus-auth-model`):** Incus has **no** permissions-management API (OpenFGA is external/config-driven). So: disable the LXD identity/fine-grained section, and build the Incus-manageable surfaces — a **Trusted Certificates** page (`/1.0/certificates`) + read-only `instance_access`/`project_access` panels. *(B §2d)*
- [ ] Delete unused `hasExplicitTrustToken` flag. *(B §1c)*

**1b. Config-key & terminology deltas** *(analysis D)*
- [x] Rename `user.ui_*` → `user.ui.*` (4 keys); add `user.ui.sso_only`, `user.ui.image_servers`. *(D §1)*
- [x] **Fix zabbly's miss:** `security.devlxd[.images]` → `security.guestapi[.images]`; `/dev/lxd`→`/dev/incus`. *(D §2)*
- [ ] Terminology: "Cluster member"→"Location"; drop "(VMs/Containers only)" qualifiers. *(D §5)*

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

### Phase 2 — Incus features beyond zabbly *(analysis A — prioritized)*
High-value, self-contained first:
- [ ] **Network address sets** page + ACL integration (`network_address_set`).
- [ ] **Custom-volume file browser** (`file_storage_volume` + `custom_volume_sftp`).
- [x] **LINSTOR/TrueNAS** driver forms — done as part of full storage-pool driver config coverage
      (also added LVM/Btrfs/Dir sub-forms + extended Ceph/CephFS/CephObject; +31 pool config keys).
- [ ] **Network integrations** (OVN interconnect) CRUD.
- [ ] **Load-balancer health checks + state** panel.
- [x] First-class VM knobs: `boot.autorestart`, memory hotplug, OOM priority. *(part of the instance-config coverage pass — 101/110 settable keys now exposed)*
- [ ] **Access panels** (`instance_access`/`project_access`) + certificate descriptions.
- [ ] Server **logging targets** panel + **ACME** settings.
- [ ] **VGA console screenshot** action (quick win). · **Network zones** page. · Snapshot schedule aliases.

Full ranked list with extensions/coverage: [`analysis/A`](analysis/A-incus-opportunities.md).

---

## Open decisions — RESOLVED
1. ~~**Depth of Phase 1a:**~~ **leave-gated** (dead LXD subtrees kept, subject to later porting).
2. ~~**Permissions:**~~ Incus has no perms API → disabled fine-grained perms + built **Trusted Certificates** page.
3. ~~**Phase 2 selection:**~~ current focus = **expose all settable container/VM settings** (instance config done; project/server/network/storage/device config still open).
4. ~~**`user.ui_terminal_default_payload`:**~~ finished the `user.ui.*` rename.
