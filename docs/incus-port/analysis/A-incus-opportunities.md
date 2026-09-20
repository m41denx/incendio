# Analyst A — Incus-only feature opportunities for the UI

Scope: the 187 api_extensions present in Incus but not LXD (`scratchpad/incus_only.txt`), read against
`/home/m41den/refs/incus/doc/api-extensions.md`, cross-checked against what the zabbly UI already ships
(`/home/m41den/refs/incus-ui-canonical/src` + the 112 incus commits `9cbb82d9..zabbly/main`).

Method notes:
- "zabbly covers" = there is a dedicated UI surface (page/form/action/column), not just a generic
  key/value settings row. Many server config keys render automatically in the settings/config editor;
  I mark those `partial` (editable but no purpose-built UX) rather than `yes`.
- `no-UI` = pure backend/plumbing/agent/preseed/header extension with no meaningful user-facing surface.

---

## Theme: OCI / application containers  — zabbly: YES
Extensions: `instance_oci`, `instance_oci_entrypoint`, `oci_network_config`.
Zabbly already implements OCI instance creation (`5b06c2ba ui: Added support for OCI instances creation`,
`216ad454 Fix Application container creation`) and annotates application containers in the list
(`829efdc5`). `oci_network_config` (static `ipv4/ipv6.address`+`gateway`, `oci.dns.*`) is only partially
surfaced — the NIC/config keys exist but there is no dedicated "OCI networking" UX.
UI opportunity: expose `oci.entrypoint/cwd/uid/gid` and the static OCI network/DNS keys in the instance
config editor with proper widgets. Priority: **low** (mostly done; polish only).

## Theme: Storage — new drivers & pool/volume options  — zabbly: PARTIAL
- New drivers: `storage_driver_linstor` (+`linstor_raw`), `storage_driver_truenas`,
  `storage_lvm_cluster` (+`storage_lvm_cluster_create`, `storage_lvmcluster_qcow2`, `storage_lvmcluster_size`,
  `lvmcluster_remove_snapshots`, `storage_lvm_metadatasize`).
  LVM-cluster is DONE (`a478da6c Add support for LVM Cluster`, `cd232b48 Fix lvmcluster pool creation`,
  `85dfa6bc Match storage driver list to Incus`, `789fb3a9 lvmcluster to driversWithFilesystemSupport`).
  LINSTOR and TrueNAS drivers are **not** in the driver picker/create form → real gap.
- Pool/volume create knobs: `storage_create_options` (`block.create_options`, `btrfs.create_options`),
  `storage_btrfs_compression`, `storage_zfs_vdev` (mirror/raidz1/raidz2 source syntax),
  `storage_initial_owner` (`initial.uid/gid/mode`), `storage_ceph_rbd_backend`,
  `storage_cephobject_endpoint_cert`, `storage_lvm_metadatasize`.
UI opportunity: add LINSTOR + TrueNAS to the storage-pool driver list with their config schemas; add a
ZFS vdev/raid builder to the pool create form; surface btrfs compression and initial-owner on volume forms.
Priority: **high** (LINSTOR/TrueNAS drivers), **med** (create options, zfs vdev).

## Theme: Storage buckets — zabbly: PARTIAL
Extensions: `storage_bucket_backup`, `storage_bucket_full`, `storage_buckets_local`.
Buckets list/create exists (`api/storage-buckets.tsx`, `context/useBuckets.tsx`, `0cda2be9`), but there is
**no bucket backup** UI (`/buckets/<b>/backups`) and `core.storage_buckets_address` (local buckets on
non-object pools) is only a generic setting. UI opportunity: bucket backup export/import actions mirroring
instance/volume backups; enable buckets on local pools once the address is set. Priority: **med**.

## Theme: Storage volumes — file access, rebuild, snapshots — zabbly: PARTIAL
Extensions: `custom_volume_sftp`, `file_storage_volume` (files API on volumes), `disk_volume_subpath`
(`source=volume/path`), `storage_volumes_rebuild`, `custom_volume_refresh_exclude_older_snapshots`,
`storage_volume_full`, `daemon_storage_logs` (`storage.logs_volume`), `dependent` (lifecycle-tied disks/volumes).
Volume export exists (`ExportVolumeModal`), and volume import name override (`f8fd1eb3`), but:
- No file browser / upload-download for custom volumes (`file_storage_volume` + `custom_volume_sftp`) — a
  genuinely valuable UI feature (browse a volume's files like a file manager).
- No "rebuild volume" action (`storage_volumes_rebuild`).
- `dependent` disk flag not exposed in the disk-device form.
- `storage.logs_volume` not surfaced alongside backups/images volume settings.
UI opportunity (high value): a **custom-volume file browser** (list/upload/download/delete) via the volume
files API. Plus a rebuild action and a `dependent` toggle on disk devices. Priority: **high** (file browser),
**med** (rebuild, dependent, logs_volume).

## Theme: Snapshots — zabbly: PARTIAL
Extensions: `snapshots_schedule_aliases` (`@daily`,`@hourly`,…,`@startup`), `snapshot_manual_expiry`
(`snapshots.expiry.manual`), `instance_snapshot_disk_only_restore`.
`SnapshotScheduleInput.tsx` exists; check whether alias tokens and `@startup` are offered. Manual expiry
override and disk-only restore are not surfaced. UI opportunity: add alias buttons to the schedule input,
a manual-expiry field, and a "restore disk only" option on snapshot restore. Priority: **med**.

## Theme: Backups / export — zabbly: PARTIAL
Extensions: `backup_iso`, `backup_override_config` (`X-Incus-config`/`X-Incus-devices` on import),
`backup_s3_upload` (push backup straight to S3), `direct_backup` (streamed, no disk buffer),
`instance_publish_split` (split-format image).
Instance/volume export modals exist (`ExportInstanceModal`, `ExportVolumeModal`). Gaps: S3-target backup
upload, override config/devices on import, split image publish. UI opportunity: an "upload to S3" option in
the export flow; config/device overrides in the import flow. Priority: **med** (S3 upload), **low** (rest).

## Theme: Networking — OVN interconnect / integrations — zabbly: NO
Extensions: `network_integrations`, `network_integrations_peer_name`.
Brand-new top-level API (`/1.0/network-integrations`) for OVN Interconnection — no trace in zabbly src.
UI opportunity: a "Network integrations" list + create/edit form (name, type=ovn, `ovn.northbound_connection`,
CA/client certs, transit pattern). Priority: **med** (advanced/OVN-only audience but a whole new object type
with zero coverage).

## Theme: Networking — address sets — zabbly: NO
Extensions: `network_address_set`, `network_address_set_ip_ranges`.
New top-level object `/1.0/network-address-sets` (named IP/CIDR/range groups usable in ACLs) — no UI. This
pairs directly with the existing ACL UI. UI opportunity: an "Address sets" CRUD page + reference them from
the ACL rule editor. Priority: **high** (self-contained CRUD, directly complements ACLs which the UI has).

## Theme: Networking — load balancers (health) — zabbly: PARTIAL
Extensions: `network_load_balancer_health_check`, `network_load_balancer_state`.
Load-balancer view/create/edit exists (`405316ea Add load balancers view`, `api/network-load-balancers.tsx`),
but no `healthcheck*` config fields and no health/state display (`/load-balancers/IP/state`). UI opportunity:
add healthcheck config (interval/timeout/failure/success counts) to the LB form and a live backend-health
status panel. Priority: **med**.

## Theme: Networking — forwards — zabbly: PARTIAL
Extensions: `network_forward_snat`.
Forward create/edit exists (`api/network-forwards.tsx`, `NetworkForwardFormPorts`). Just add the `snat`
toggle (bridged networks). Priority: **low**.

## Theme: Networking — bridge / OVN / NIC config keys — zabbly: PARTIAL
Large set of per-network / per-NIC config keys, editable today only as raw config rows:
`network_dns_nameservers`, `network_ipv4_dhcp_routes`, `network_ipv6_ra`, `network_ovn_ipv4_dhcp_expiry`,
`network_bridge_multicast_snooping`, `network_ovn_multicast`, `network_bridge_dns_include_hosts`,
`network_bridge_external_create`, `network_ovn_external_interfaces`, `network_ovn_external_nic_address`,
`network_ovn_isolated` (uplink `none`), `network_ovn_tunnels`, `network_bgp_peer_interface`,
`network_bridge_bgp_instances`, `network_physical_gateway_hwaddr`, `network_hwaddr_pattern`,
`network_zones_dns_contact` (no zones page at all in zabbly), `nic_attached_connected` (attached bool DONE
`a9bd9dda`), `nic_sriov_security_trusted`, `nic_sriov_select_ext`, `ovn_nic_limits`, `ovn_nic_promiscuous`,
`ovn_nic_ip_address_none`, `instance_nic_macvlan_mode`, `instance_nic_routed_host_address`,
`instance_nic_routed_host_tables`, `instance_nic_txqueuelength`, `network_io_bus`(+`_ovn`),
`network_allocations_network`, `network_state_ovn_lr`/`_ls`/`network_ovn_state_addresses` (state fields),
`network_acl_stateless`, `network_bridge_acl_devices` (bridge ACL DONE `e5cabac5`).
UI opportunity: mostly incremental — richer widgets for the common keys (DNS nameservers, DHCP routes,
IPv6 RA toggle, macvlan mode, OVN isolated), plus a **Network zones** management page (missing entirely) and
surfacing OVN LR/LS + uplink addresses on the network state view. Priority: **med** (network zones page,
DNS/DHCP-route/RA widgets), **low** (the many niche OVN/SR-IOV keys).

## Theme: Clustering / placement / rebalancing — zabbly: PARTIAL
Extensions: `cluster_evacuating_restoring` (states DONE — `EvacuateClusterMemberBtn`/`RestoreClusterMemberBtn`),
`clustering_evacuation_stop_options` (`stateful-stop`/`force-stop`), `cluster_rebalance`
(`cluster.rebalance.*`), `server_shutdown_action` (`core.shutdown_action=evacuate`),
`boot_host_shutdown_action` (`boot.host_shutdown_action`), `cluster_group_usedby`, `clustering_groups_config`,
`clustering_groups_vm_cpu_definition`, `instances_placement_scriptlet` (+`_rebalance`, +the
`instances_scriptlet_get_*` helpers). Note: zabbly **removed** LXD placement-groups (`6cf28fdc`); Incus uses
placement *scriptlets* instead, which have no UI.
UI opportunity: evacuation mode picker (stateful/force/refresh-migrate) in the evacuate action; cluster
rebalance settings panel; cluster-group config editor + used-by; a **placement scriptlet editor** (Starlark)
in cluster settings. Priority: **med** (evacuation options, cluster group config/used-by), **low** (rebalance
tuning, scriptlet editor — advanced).

## Theme: Migration — zabbly: PARTIAL
Extensions: `instance_project_move_live`, `instance_refresh_migration`, `container_migration_stateful`
(`migration.stateful`), `storage_live_migration` (DONE `af7c742f`), `instance_publish_split`.
Migration is an action (`d133554a`), incl. remote-cluster (`168b1e61`) and bulk (`59774540`). Gaps: refresh
(incremental) migration option, live project move, `migration.stateful` toggle in instance config.
UI opportunity: expose refresh + live-project-move as migration options; `migration.stateful` toggle.
Priority: **low** (core migration already covered).

## Theme: VM lifecycle & hardware knobs — zabbly: PARTIAL / mostly config-only
Extensions: `memory_hotplug` + `limits_memory_hotplug`, `instance_limits_cpu_topology`
(`sockets/cores/threads`), `instance_limits_oom` (`limits.memory.oom_priority`), `instance_memory_swap_bytes`,
`instance_auto_restart` (`boot.autorestart`), `numa_cpu_balanced`, `instance_smbios11` (`smbios11.*`),
`instance_systemd_credentials` (`systemd.credential*`), `security_iommu`, `instance_selinux`
(`security.selinux.*`), `security_iommu`, `boot_host_shutdown_action`, `instance_types`.
Today all raw config keys. UI opportunity: dedicated widgets on the instance config form — memory-hotplug
max, explicit CPU topology builder, OOM priority, auto-restart toggle — these are high-visibility VM knobs
users expect as first-class fields. Priority: **med** (auto-restart, cpu topology, memory hotplug),
**low** (smbios11, systemd creds, selinux, iommu — advanced).

## Theme: VM UEFI / NVRAM & QEMU scriptlets — zabbly: NO
Extensions: `instance_nvram` (+`_bulk_update`, +`instance_nvram_config`, `instances_tpm_platform_cert`),
`qemu_raw_qmp`, `qemu_scriptlet` (+`_config`, `_nvram`).
NVRAM get/set/delete endpoints and QEMU scriptlet keys — no UI. UI opportunity: a UEFI-variable
viewer/editor per VM and `raw.qemu.*` / scriptlet config fields. Niche/expert. Priority: **low**.

## Theme: Instance console & debugging — zabbly: PARTIAL
Extensions: `instance_console_screenshot` (VGA screenshot), `console_force` (DONE — console prompt to
disconnect existing session `fb5b8085`/`8aff2944`), `instance_port_forward`, `instance_nbd`,
`instance_debug_memory`, `instances_debug_repair`, `instance_access`.
Console/terminal work is largely done (incl. Windows exec `08a7a77d`, journald decode `ef27c110`, minimal
console). Gaps: **VGA screenshot** button (easy, nice for VMs — the UI already has a graphic console
`InstanceGraphicConsole.tsx`), instance port-forward helper, memory-dump/repair debug actions, and an
**"who can access this instance" panel** (`instance_access` / `project_access` — `GET .../access`).
UI opportunity: screenshot action on the VGA console; an access/permissions panel on instance & project
detail. Priority: **med** (screenshot, access panels), **low** (debug memory/repair, port-forward, nbd).

## Theme: Instance state / metadata columns — zabbly: PARTIAL
Extensions: `instances_state_os_info` (OS column DONE `57186d51`), `instance_state_started_at`,
`instance_state_cpu_time` (`allocated_time`), `resources_load`.
UI opportunity: show uptime/started-at and allocated CPU time on the instance overview; a host "load"
readout on the cluster/host view. Priority: **low**.

## Theme: Devices — disk / usb / gpu / nic attach & limits — zabbly: PARTIAL
Extensions: `disk_attached`/`usb_attached`/`nic_attached_connected` (attached-boolean DONE `a9bd9dda`),
`disk_io_bus_usb` (iso-as-usb DONE `8768089a`), `disk_io_bus_cache_filesystem`, `disk_io_limits_combined`
(byte/s + IOPS), `device_burst_limits`, `disk_wwn`, `disk_volume_subpath`, `container_disk_tmpfs`,
`unix_block_limits`, `unix_hotplug_pci`, `device_pci_firmware`, `device_queue_disc`, `proxy_priv_drop`
(`security.uid/gid`), `infiniband_sriov_guid`, `gpu_native_context`, `gpu_physical_clique`,
`nvidia_runtime`(+`_config`). GPU by vendor/product DONE (`89e0dbaf`), special disks DONE (`4c6b9774`).
UI opportunity: richer disk-device form (io.bus, io.cache, combined byte+IOPS limits, burst, wwn, tmpfs
source, dependent flag); nvidia runtime toggle + capabilities on containers; native-context virtio-gpu option
on VMs. Priority: **med** (disk io/limits widgets, nvidia runtime toggle), **low** (the rest).

## Theme: Resources / hardware inventory — zabbly: PARTIAL
Extensions: `resources_cpu_flags`, `resources_load`, `resources_serial`, `resources_cpu_cluster`,
`resources_cpu_address_sizes`, `image_locations`, `metrics_project_resources` (project Usage page DONE
`470319f8`).
UI opportunity: enrich the host/cluster "resources" view with CPU flags, serial devices, load, and
big.LITTLE cluster info; show `image_locations` (which members hold an image) on the image detail.
Priority: **low** (image_locations is the most useful — **med** for that one).

## Theme: Auth / authorization / OIDC / certificates — zabbly: PARTIAL
Extensions: `authorization_config` (openfga.*→authorization.* — OpenFGA support DONE `4223123f`, but note
`45804b1b` disabled fine-grained permissions), `authorization_scriptlet` (+`_cert`, `_claims`),
`authorization_client_routing`, `auth_tls_jwt`, `oidc_claim`, `oidc_allowed_subnets`, `certificate_description`
(add description to certs), `project_access`, `instance_access`.
UI opportunity: certificate description field in the trust/certs UI; an authorization-scriptlet editor;
OIDC claim config in settings; the access panels noted above. Priority: **med** (certificate description,
access panels), **low** (scriptlet editor, client routing, jwt — advanced/config-only).

## Theme: ACME / TLS server certs — zabbly: NO (config-only)
Extensions: `acme_dns01`, `acme_eab`, `acme_http01_port`.
Only `acme.*` server config keys (no dedicated UI; appear in config.spec test list). UI opportunity: an ACME
section in server settings (challenge type, EAB kid/hmac, HTTP port). Priority: **low**.

## Theme: Server logging — zabbly: PARTIAL (config-only)
Extensions: `server_logging` (multi-target `logging.*`, supersedes `loki.*`), `server_logging_webhook`.
SettingForm special-cases only `loki.auth.password`. New multi-target logging (incl. webhook target) has no
structured UI. UI opportunity: a "Logging targets" panel (add/remove named targets: loki/webhook/syslog with
their address/auth/retry keys). Priority: **med**.

## Theme: IncusOS — zabbly: YES
Not an api_extension per se, but zabbly built IncusOS management pages (`e5e5b292`, `78a193b8`). Noted for
completeness; no further opportunity here beyond keeping aligned.

## Theme: Projects — restrictions & metrics — zabbly: PARTIAL
Extensions: `projects_restricted_image_servers` (custom image servers DONE `d7fda021`),
`projects_restricted_storage_pool_access`, `projects_restricted_virtual_machines_nesting`,
`metrics_project_resources` (Usage page DONE). Gaps: the two new `restricted.*` keys in the project
restriction form. UI opportunity: add storage-pool-access and VM-nesting restriction toggles to
`NetworkRestrictionForm`/project restriction UI. Priority: **low**.

---

## no-UI (backend / plumbing / agent / preseed / header — track, don't build)
`api_filtering_extended`, `api_fragments`, `bpf_token_delegation`, `dev_incus_events`, `dev_incus_images`,
`restrict_dev_incus` (`security.guestapi` — a config toggle, borderline), `init_preseed_certificates`,
`init_preseed_cluster_groups`, `init_preseed_profile_project`, `image_import_alias` (`X-Incus-aliases` header),
`image_template_permissions`, `image_restriction_privileged`, `core_https_allowed_websocket_origin`,
`core_https_allowed_websocket_origin`, `file_delete_force` (`X-Incus-force` header),
`instances_lxcfs_per_instance`, `agent_config_drive`, `instance_systemd_credentials` (borderline),
`storage_volume_nbd`/`instance_nbd` (raw block access — CLI/API only), `direct_backup` (streaming header),
`instances_scriptlet_get_*` (scriptlet runtime helpers), `network_state_ovn_lr`/`_ls` (state fields, surface
only inside a state view), `image_locations` (a field, surface in image detail), `instance_nvram_config`
(initial NVRAM defaults — config-only), `bpf_token_delegation`.

## Top opportunities (post-parity feature phase)
Status as of the current branch (see `../PORT-LOG.md` for commits): ✅ done · 🟡 partial · ⬜ open.

1. ⬜ **Network address sets** page + ACL integration — new self-contained object, high value, zero coverage.
2. ⬜ **Custom-volume file browser** (list/upload/download via volume files API + SFTP) — genuinely new UX.
3. ✅ **LINSTOR + TrueNAS storage drivers** in the pool create form — done (full pool-driver coverage: also
   LVM/Btrfs/Dir sub-forms + extended Ceph/CephFS/CephObject, +31 keys; picker greys out unsupported drivers).
4. ✅ **Network integrations (OVN interconnect)** CRUD — done, incl. the `type: remote` peer consumption side.
5. 🟡 **Load-balancer health checks + state** panel — the base OVN LB view now works on Incus (backend model);
   healthcheck config fields + live `/state` panel still open.
6. 🟡 **First-class VM knobs** — auto-restart, memory hotplug, OOM priority, `migration.stateful`,
   `nvidia.runtime`, iommu/selinux/sev done; **explicit CPU topology** (sockets/cores/threads) still raw.
7. ⬜ **Access panels** (`instance_access`/`project_access`) + **certificate descriptions**.
8. ⬜ **Server logging targets** panel (loki/webhook) + **ACME** settings section.
9. ⬜ **VGA console screenshot** action (quick win on existing graphic console).
10. ⬜ **Network zones** management page (missing entirely) + DNS/DHCP-route/IPv6-RA widgets.

Also since this report: config-coverage passes remain open for **project** (~53), **server** (~107),
**network** (bridge/OVN/…) and **device** (~290) keys, plus per-driver storage **volume** config
(`storage_volume_*`, ~120 keys), storage **bucket backups**, snapshot schedule aliases / manual expiry /
disk-only restore, migration refresh + live project move, and cluster evacuation/rebalance/placement-scriptlet UI.
