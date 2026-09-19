# Incus port — progress log

Tracks the rebase-port of zabbly's Incus commits onto lxd-ui `0.22` (branch `incus-port`).
Approach: cherry-pick cleanly-applying commits (preserve authorship); for commits heavily
superseded by 0.22, extract only the Incus-critical delta; gate (don't delete) dead LXD
features; defer commits whose dependencies aren't yet ported.

## Done

**Phase 0 — branding & de-Canonical**
- Update all external links (zabbly 74f84a06) + Incendio repo links
- Remove version check (4341bb6c), Canonical image servers (02fce4ad), "See {ref}" (556e9284)
- Incendio rebrand: logo (from MicroCloud mark), title, favicon

**Phase 1 — core-api / config**
- OpenFGA support (4223123f), non-VM-specific key labels (72543dd3)
- Config-key renames: `user.ui_title`→`user.ui.title` (9b29f04c), `user.ui.sso_only` (deef8d6b),
  `ui_`→`ui.` prefix sweep (78aca61b, incl. `user.ui.default_project`)
- Remove zfs default (7f31334f), default-shell tweak (b4a2bdbf), hwaddr standard key (590a745d),
  physical-network name validation (a146799d)
- **Cert trust fix (surgical):** `addCertificate` → classic `/1.0/certificates` (0.22 used LXD
  identity API which 404s on Incus); cert names → Incendio
- **security.devlxd → security.guestapi** (Incus key rename; a bug zabbly never migrated)
- **Placement groups gated** behind `instance_placement_groups` (LXD-only; was 404ing on Incus)

**Phase 1 — storage cluster**
- LVM-cluster support (a478da6c, 789fb3a9, cd232b48)
- **Match storage driver list to Incus** (85dfa6bc): removed PowerFlex/PowerStore/Pure/Alletra
  driver forms + config keys; LINSTOR/TrueNAS in the driver list

## Deferred (dependencies not yet ported)
- **820872e709** "Pass project flag when fetching storage pools" — entangled with server-side
  instance filtering (b069024684, 53bd336367) and `showClusterMember` (808853ae70). Re-attempt
  after the filtering cluster lands.
- **789fb3a9af** originally out-of-order; re-applied after a478da6c. (resolved)

## Remaining (Phase 1)
- **Access area:** disable LXD identity/fine-grained (692f92e4, 45804b1b) + build Trusted
  Certificates page + access panels + OIDC logout fix (8116826a)
- **Console/terminal cluster:** da2f7d83, 0797c463, fb5b8085, 8aff2944, d0f583e9, 4719cd6d,
  00d44132, 08a7a77d (Windows exec), ef27c110 (journald)
- **Migration cluster:** d133554a → af7c742f → 597745400 → 168b1e61
- **Instance filtering:** b069024684 → 53bd336367 → c3448553
- **IncusOS:** e5e5b292 → 78a193b8
- **Instances/overview:** OCI creation (5b06c2ba, 216ad454), app-container annotation (829efdc5),
  state-API usage (2cdcd29e), instance preview (22f119fb), MAC on overview (8afa4b5b),
  user properties (c633f59e), OS column (57186d5), column reorder (19b5096), usage page (470319f8),
  hide-if-no-default-project (e7ecc4b0), image profile list (c03648218)
- **Devices/storage features:** special disks (4c6b9774), io.bus=usb ISO (8768089a), GPU by
  vendor/product (89e0dbaf), un-managed bridges (2c93d092), bridge NIC ACLs (e5cabac5),
  custom-volume target selection (191e4714), volume import name (f8fd1eb3), custom image servers (d7fda021)
- **Bugfixes:** ~28 commits (terminal/console robustness, null-safety, snapshot/volume fixes, OIDC logout)
- **Drop:** 405316ea "Add load balancers view" (0.22 ships its own native LB — verify vs Incus)
