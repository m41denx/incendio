## 0.22-p7
## What's Changed
### 📦 Other changes
- (fix) Storage: the volumes list no longer 404s on Incus — `hasStorageVolumesAll` gates on the base `storage_volumes_all` endpoint extension (absent on Incus 7.4), so the UI falls back to collecting volumes per pool
- (chore) CI: releases are now cut by pushing a **tag** (e.g. `0.22-p7`) instead of on every push to `incus-port`; the release body is the matching CHANGELOG section

## 0.22-p6
## What's Changed
### ✨ New Features
- (feat) Networking: **SNAT toggle** on network forwards (bridged networks)
- (feat) Networking: **DNS nameservers** (`dns.nameservers`) field for bridged and OVN networks
- (feat) Instances: **VGA console screenshot** action — download a PNG of a running VM's console
- (feat) Instances: snapshot schedule interval gains **`@midnight`** and the instance-only **`@startup`** alias

### 📦 Other changes
- (chore) Networking: many bridge/OVN network config widgets (routes, DHCP, IPv6 stateful) were already present; remaining NIC-device keys (macvlan mode, SR-IOV) stay raw-config/YAML for now
- (chore) CI: release workflow now publishes only the latest CHANGELOG section as the release body, and uses `softprops/action-gh-release@v3`

## 0.22-p5
## What's Changed
### ✨ New Features
- (feat) Networking: **OVN interconnect network integrations** — server-global CRUD (northbound/southbound connections, TLS certs, transit pattern) plus `type: remote` network peers that target an integration
- (feat) Networking: **OVN network load balancers** for Incus (backend model) — the tab was previously gated behind an LXD-only extension; adds backend + port editing, health-check config and a live backend-health panel
- (feat) Networking: **Network address sets** — project-scoped CRUD of named IP/CIDR/range groups, referenced from ACL rules via `$name`
- (feat) Networking: **Network DNS zones** — project-scoped CRUD plus a records editor (type/value/ttl entries)
- (feat) Storage: full **storage-pool driver** coverage — LINSTOR, TrueNAS, LVM, Btrfs, Dir sub-forms and extended Ceph/CephFS/CephObject (+31 config keys); driver picker greys out drivers unsupported by the server
- (feat) Instances: broad instance-config coverage (101/110 settable keys) incl. `boot.autorestart`, memory hotplug, OOM priority, `security.iommu`, SELinux/SEV, syscalls interception, NVIDIA, OCI and a raw-config section
- (feat) Settings: dropdown selectors for `acme.challenge`, `backups.compression_algorithm`, `images.compression_algorithm` and `instances.nic.host_name`

### 📦 Other changes
- (feat) Nav: "Interconnect" entry below Clustering; "Address sets" and "Zones" under Networking
- (fix) Re-gate `storage_volumes_all` on Incus's `storage_volumes_all_projects` so "volumes across all projects" works
- (fix) Rename user-facing "Local peering(s)" → "Peering(s)" (peers can now be remote)
- (chore) Remove the unused `hasExplicitTrustToken` flag
- (chore) GitHub Actions workflow: build the UI into a zip bundle and publish a release on push to `incus-port`
