## 0.22-p11
## What's Changed
### ✨ New Features
- (feat) Kubernetes: **Clusters** is now the main page — a list of agent-managed clusters (status with live CAPI phase and blocking reason, Kubernetes version, ready/desired control-plane and worker counts, API endpoint, project link) with SWR-style polling and per-cluster delete, plus **Create cluster** and **Kubernetes settings** actions. Creating a cluster is a dedicated multi-section form (Cluster, Machines, Infrastructure credentials, Generated artifacts) with side-navigation, matching the rest of Incendio's create/edit panels
- (feat) Kubernetes: **cluster detail page** — general info (status, phase, version, API endpoint, project, ready counts), **Control plane / Workers / Load balancer** node lists linking to each Incus instance with its instance status, Kubernetes node readiness (and why it is not ready), IPv4 and version, plus the cluster's CAPI **conditions**
- (feat) Kubernetes: **scale clusters** from the detail page — control-plane (odd sizes, for etcd quorum) and worker counts are patched into the cluster's CAPI topology and rolled out by Cluster API
- (feat) Kubernetes: **kubeconfig** — show, copy or download a cluster's admin kubeconfig on demand from the detail page
- (feat) Kubernetes: **Kubernetes version** is a picker of valid kubeadm images (v1.37.0 … v1.33.0, Ubuntu 24.04) instead of a free-text field; the generator, management-appliance deploy, and agent cluster create default to `v1.37.0`
- (feat) Kubernetes: **management appliance** — the **Kubernetes settings** view deploys the CAPI/CAPN control plane as a privileged, nested Incus **container** (`images:ubuntu/24.04/cloud`) running single-node k3s, in its own `incendio-mgmt` project, exposed via a host proxy device on `:8843`. The appliance tab shows a live **bring-up checklist** (container → cloud-init bootstrap → agent reachable → CAPN ready → Incus trust) with the bootstrap log tail, the appliance's Incus client certificate is **trusted automatically** on deploy (or with one click for existing appliances), and the agent handle (URL + token) is stored in `user.k8s.api-config` so every session reconnects. Create cluster is only enabled once the appliance is fully ready; without an agent, the pure-browser artifact generator still works.
- (feat) Kubernetes agent (`@incendio/k8s`): a thin broker over CAPI/CAPN (no reconcile loop) — project-per-cluster with `user.incendio.*` metadata, `clusterctl generate | kubectl apply` create, live status from the Cluster/Machine CRDs (cache fallback in `bun:sqlite` + drizzle), one-shot teardown, `GET /v1/clusters/:name/kubeconfig`, `PATCH /v1/clusters/:name` scaling, and a pinned appliance **bootstrap script** (k3s + clusterctl + CAPN, self-signed agent TLS, systemd unit) driven by cloud-init.

### 📦 Other changes
- (fix) Kubernetes: **Create cluster now applies every form option** — only name, version and counts used to reach the agent, so CNI (flannel), machine types/flavors/profiles/targets, load balancer, image and pod/service CIDRs were silently ignored and clusters came up without a CNI (nodes never Ready). The form's template variables are now sent as-is (the same ones the preview shows) and the agent rejects unknown variables instead of dropping them
- (fix) Kubernetes: node ready counts use CAPI's `Ready` condition — a joined node without a working CNI no longer shows as ready
- (fix) Kubernetes agent: talks to Incus by **pinning the server certificate's fingerprint** (Incus serves a self-signed leaf without the dialled IP in its SANs, which Bun cannot trust via `ca`)
- (fix) Kubernetes: appliance deploy works when the `default` profile has no root disk or NIC (a pool and a NAT network are picked automatically), and uses the `cloud` image variant so the cloud-init bootstrap actually runs; a missing cloud-init is reported instead of hanging on "bootstrapping"
- (fix) Kubernetes: **Test connection** verifies the token before saving it (it used to overwrite a good handle with a stale token), rejected tokens get an actionable message, and agent errors show their detail, not just the generic summary
- (fix) Kubernetes: deleting a cluster from its detail page no longer crashes the page (instances being torn down can be listed without config); you are taken back to the cluster list right away, where the cluster shows as **Deleting** until the teardown finishes, and the result is reported by a toast

## 0.22-p10
## What's Changed
### ✨ New Features
- (feat) Instances: **Access** tab — a read-only "who can access" list (identifier, role, provider) for the instance, from `GET /1.0/instances/{name}/access` (`instance_access`)
- (feat) Projects: **Access** page in the project menu — the same read-only access list for the project, from `GET /1.0/projects/{name}/access` (`project_access`)
- (feat) Settings: trusted certificates now support a **description** — a new Description column, an optional description field in the Add dialog, and an inline edit action to change it (`certificate_description`)
- (feat) Projects: new restriction toggles — **VM nesting** (`restricted.virtual-machines.nesting`, allow/block) under Restrictions → Instances, and **Available storage pools** (`restricted.storage-pools.access`, a comma-separated allow-list of pool names) under Restrictions → Device usage
- (feat) Storage: **ZFS vdev/raid builder** when creating a ZFS pool — pick a vdev type (stripe / mirror / raidz1 / raidz2) and list block devices to compose the pool source (`storage_zfs_vdev`); **btrfs volume compression** (`btrfs.compression`: zstd/lzo/zlib/none); and **initial owner** (`initial.uid`/`initial.gid`/`initial.mode`) on custom filesystem volumes (`storage_initial_owner`)
- (feat) Storage: **bucket backups** — export a bucket to a downloadable backup archive and import a bucket from one (`storage_bucket_backup`), with new Export actions on each bucket and an Import bucket button on the Buckets page; plus a caution when creating a **bucket on a local (non-object) pool** without the server's `core.storage_buckets_address` set (`storage_buckets_local`)

## 0.22-p9
## What's Changed
### ✨ New Features
- (feat) Settings: **server logging targets** panel (Settings → Logging) — create/edit/delete named `logging.*` targets for **Loki / syslog / webhook** (address, level, event types, auth, CA cert, retry, facility, lifecycle filters) (`server_logging`, `server_logging_webhook`)
- (feat) Settings: dedicated **ACME certificates** section (Settings → ACME) — a form for the `acme.*` keys (ToS, email, domain, CA URL, HTTP-01/DNS-01 challenge, DNS provider/environment/resolvers, EAB) (`acme`)
- (feat) Cluster: **Cluster settings** page (Settings → Cluster) — automatic **re-balancing** settings (`cluster.rebalance.*` + healing/offline thresholds) and a Starlark **placement scriptlet** editor (`instances.placement.scriptlet`), Incus's alternative to placement groups (`cluster_rebalance`, `instances_placement_scriptlet`)
- (feat) Cluster: cluster groups now show **config** + **used-by** in the edit panel

### 📦 Other changes
- (feat) Nav: settings grouped into an expandable **Settings** menu (Certificates, Logging, ACME, and the original settings table renamed **Advanced**); **Cluster settings** moved under the **Clustering** menu as "Settings"
- (fix) Instances: the CPU topology sockets/cores/threads inputs now stack vertically instead of overflowing
- (fix) Cluster: editing a cluster group no longer drops its config (`user.*`, CPU baselines)

## 0.22-p8
## What's Changed
### ✨ New Features
- (feat) Networking: **NIC-device type options** in the network-device panel, shown by the selected managed network's type — macvlan **mode** (bridge/vepa/passthru/private) + VLAN; SR-IOV **`security.trusted`** + **`security.mac_filtering`** + VLAN; OVN **nesting** (`nested` + VLAN) and **static routes** (`ipv4.routes`/`ipv6.routes`)
- (feat) Instances: instance overview now shows **Started**, **Uptime**, **CPU time** and **Allocated CPU time** (`instance_state_started_at`, `instances_state_total`)
- (feat) Instances: **richer custom-disk options** — I/O bus (virtio-scsi/virtio-blk/nvme/usb), I/O cache, combined byte/s+IOPS **read/write/max limits** with **burst** + burst length, and **WWN** (virtio-scsi)
- (feat) Instances: **migration refresh + live toggle** — the migrate dialog gains a "Refresh (incremental transfer)" checkbox and, for running instances, a "Live migration" toggle (enables live project moves) (`instance_refresh_migration`)
- (feat) Instances: **SMBIOS & credentials** editor — a raw key/value section for `smbios11.*`, `systemd.credential.*` and `systemd.credential-binary.*` (`instance_smbios11`, `instance_systemd_credentials`)
- (feat) Instances: **explicit VM CPU topology** — a "topology" CPU-limit mode building `limits.cpu=sockets=N,cores=N,threads=N` (`instance_limits_cpu_topology`)

### 📦 Other changes
- (fix) Networking: editing a NIC device no longer drops device keys the panel doesn't manage (e.g. `hwaddr`, `mtu`, `boot.priority`) — the existing config is now preserved on save

## 0.22-p7
## What's Changed
### ✨ New Features
- (feat) Instances: **UEFI/NVRAM viewer** — a VM-only "UEFI Variables" tab on the instance detail page lists UEFI variables grouped by GUID (attributes, value, size) with per-variable delete (`instance_nvram`)
- (feat) Instances: **QEMU scriptlet editor** — `raw.qemu.scriptlet` now edits in a code editor with line numbers; the QEMU scriptlet, QMP and `raw.qemu.conf` raw-config rows are gated on their API extensions so they only appear when the server supports them

### 📦 Other changes
- (fix) Images: the base-image selector no longer splits one architecture into two — local images (canonical `aarch64`/`x86_64`) are now normalised to the simplestreams alias (`arm64`/`amd64`) so they group with online images
- (fix) Instances/Profiles: the "Placement group" target option no longer appears on Incus — placement groups are LXD-only (Incus uses placement scriptlets), so the option/select is gated on the `instance_placement_groups` extension
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
