# Incus port — progress log

Rebase-port of zabbly's Incus commits onto lxd-ui `0.22` (branch `incus-port`).
Approach: cherry-pick with `-x` (preserve authorship); extract only the Incus-critical
delta when a commit is superseded by 0.22; gate (don't delete) dead LXD features; defer
commits whose dependencies aren't yet ported. `tsc` is clean at HEAD; unit tests have only
the 14 pre-existing `loginProject.spec` failures (Node 26 + jsdom localStorage quirk, present
on the clean 0.22 base — not a regression).

**Status:** Phase 0 + Phase 1 **COMPLETE**. 92 commits on branch (HEAD `3a35fe3594`), all pushed to `origin/incus-port`. `tsc` clean, `yarn lint-js` clean, tests at the 14 pre-existing `loginProject.spec` baseline. Production `yarn build` succeeds. Smoke-tested against live Incus 7.4 (553 api_extensions) — see "Smoke test" below.

## Done — Phase 0 (branding & de-Canonical)
External links, version-check removal, Canonical image-server removal, "See {ref}" cleanup,
Incendio rebrand (logo from MicroCloud mark, title, favicon).

## Done — Phase 1 core-api / config
Config-key renames (`user.ui_*`→`user.ui.*`, `sso_only`, `default_project`), OpenFGA helper,
non-VM key labels, cert enrolment via classic `/1.0/certificates`, `security.devlxd`→`security.guestapi`,
placement-groups **gated** behind `instance_placement_groups`, hwaddr standard key, zfs default,
default shell, physical-network name validation.

## Done — Phase 1 storage
LVM-cluster support, **driver list matched to Incus** (dropped PowerFlex/PowerStore/Pure/Alletra,
LINSTOR/TrueNAS in picker).

## Done — Phase 1 features / fixes (ported)
OCI instance creation + app-container fix, instance preview, special disks, MAC on overview,
storage live migration, remote-cluster migration, **bulk migration**, OS column, un-managed bridges,
bridge NIC ACLs, network-device parent check, minimal console, console disconnect/reconnect prompts,
terminal error messages + notify fix, **Windows VM exec**, io.bus=usb ISO, GPU by vendor/product +
member-hosted query, volume import name override, remove snapshots/size volume columns, attached-boolean,
btrfs source fix, null-safety fixes (network counter, storage-pools), clear CPU limit, cert serial,
cloud-init default, buckets fix, image profile list, respect-profile-list, copy-handling.

Plus `fix(port)` commits repairing compile/test regressions (metrics drop, migration onSuccess,
CPU-limit type, network-device types, test fixtures, formChangeCount union-keys, addNicDevice).

## Done — previously-deferred clusters (all ported)
| Commit(s) | Result |
|---|---|
| `c633f59e` user properties | APPLIED `a18d081f25` (adapted UserPropertiesForm imports, `nameEditable`, userProperties form field/payload/changeCount) |
| `40727871` add-devices fix | APPLIED `f2ba1482dd` (added `devices` to `LxdMetadata.configs` type) |
| `19b50960` column reorder | APPLIED `f74d20195c` (`useIsClustered` + `Record<>` column typing) |
| `e7ecc4b0` hide-if-no-default-project | APPLIED `9c45f90897` (post-IncusOS, `hasAdminPermissions`) |
| `ef27c110` journald decode | APPLIED `7830a821ba` (applied `decodeMessage` to `OSDebugLog.tsx`) |
| `b069024684`+`53bd336367`+`c344855342` server-side filtering | APPLIED `da89307e7a`/`624be72592`/`dc513183ee` + fix `8cba16c467`; added `ip-address` dep; removed dead client-side filter block |
| `191e471466`+`808853ae70`+`820872e709` volume target/project | APPLIED `c7f1315e8c`/`eb7ad55801`/`43ace60654` + fix `4f6cc0df7e`; resolved to true upstream end state (`showClusterMember` removed, project flag on `fetchStoragePools`) |
| `9dadd779` authMethod init | Superseded — `authMethod` restored to auth context via `3ff1b71892` (OIDC logout) |
| `c1eef038` snapshot count | Dropped (superseded by applied `e21923904`) |

## Done — re-ported clusters (were built on wrong base `main`; redone on incus-port)
- **IncusOS** (`e5e5b29283`+`78a193b81e`) — APPLIED `a8f9798f0f` (checkout-based from `port/incusos`; 20 new `src/pages/os/*`/`api/os.tsx` files + anchor merges in App/Navigation/queryKeys/styles/YamlForm; aligned page set, no OSLogs/OSNetwork/OSSecurity/OSStorage).
- **Custom image servers** (`d7fda021`) — APPLIED `bf0fbabb48` (`IMAGE_SERVERS_KEY = "user.ui.image_servers"`; `isImageServers` in SettingForm; Incendio defaults kept, user servers layered on top).
- **Project Usage page** (`470319f8`) — APPLIED `07e57909b7`.

## Done — Access area (Incus has no fine-grained perms API)
- Cherry-picked `692f92e4` (`ca9e976478` skip LXD identity API), `45804b1b` (`92030399d3` disable fine-grained perms — `isFineGrained()` → false, dropped `fetchCurrentIdentity`), `8116826a` (`3ff1b71892` OIDC logout, keeps bearer-token support).
- LXD identity/permissions nav already gated behind `hasAccessManagement` (`access_management` ext) — hidden on Incus (confirmed False on live 7.4); the two auto-firing identity-API callers (`useLoggedInUser`, `auth.tsx`) removed. Permission pages left in place per "gate don't delete"; routes only reachable by manual URL.
- **New Trusted Certificates page** `1de27ea1fe` — `feat(incus)`: `src/pages/settings/TrustedCertificates.tsx` lists/adds(token)/removes trusted client certs via `/1.0/certificates`; nav "Certificates" + route `/ui/settings/certificates`; added `deleteCertificate`, extended `LxdCertificate` type.
- Read-only `instance_access`/`project_access` panels: **built in 0.22-p10** (see "Access panels + certificate descriptions" below).

## Done — LB, lint, smoke
- **zabbly LB view `405316ea` dropped** — never cherry-picked; 0.22's native network-load-balancer (CreateLoadBalancer/EditLoadBalancer/LoadBalancersTab/NetworkList) is in place and compiles.
- **Lint pass** `3a35fe3594` — `yarn lint-js` exit 0 (fixed ~252 issues: prettier/import-type auto-fixes + manual dedup-imports/unused-vars; wired up `InstancePreview` error handling that was an incomplete port).

## Smoke test — live Incus 7.4 (2026-09-20)
Daemon reachable via `sudo incus query` (unix socket); 553 api_extensions. Production `yarn build` → exit 0 (5.6M).
- Core endpoints respond: `/1.0/instances` `/1.0/projects` `/1.0/storage-pools` `/1.0/networks` `/1.0/profiles` `/1.0/certificates` `/1.0/cluster`.
- LXD-only `/1.0/auth/identities` + `/1.0/auth/groups` → **404 (not found)** — confirms gating is correct.
- Gate extensions on live server: `access_management`=False (perms UI hidden ✓), `instance_placement_groups`=False (placement gated ✓), `storage_driver_linstor`=True (driver list ✓), `instances_state`=False (confirms dropping old state-metrics commit was right).
- Not deployed to `/opt/incus/ui` (would overwrite the installed system UI — left for the user to decide). Browser render-test not performed (headless env).

## Phase 2 — in progress (Incus-specific instance config)
Approach: diff the UI's exposed config keys against live `sudo incus query /1.0/metadata/configuration`
(instance config group). The UI's `SecurityPoliciesForm` exposed 11 `security.*` keys; Incus 7.4 has ~40.
- **Done** `58bea1a81e` — added VM/security toggles the UI lacked: `security.iommu` (virtual IOMMU =
  device passthrough & nested virtualization), `security.sev` + `security.sev.policy.es` (AMD SEV/SEV-ES),
  `security.agent.metrics`, `security.protection.start`. Each wired through `instanceConfigFields` map +
  `SecurityPoliciesFormValues` type + `securityPoliciesPayload`/edit-values + `SecurityPoliciesForm` row
  (container/VM gated). Pattern for adding a field = those 4 touch-points + 1 UI row.
- **Done** — full instance-config coverage pass. Goal: expose all settable container/VM instance
  settings in the forms. Gap method = diff the config-key map (`instanceConfigFields.tsx`) against
  `sudo incus query /1.0/metadata/configuration` (instance group, excluding `volatile.*`/`image.*`).
  Result: **101 / 110 settable keys exposed** (was 35).
  - Existing sections expanded (+43): Security `1052a5fa05` (syscalls intercept/deny, selinux, bpffs,
    sev.session), Resource limits `c894f6b305` (cpu allowance/nodes/priority, memory enforce/hotplug/
    hugepages/oom, hugepages.*), Boot `9342ac6ff1`, Migration `6448071996`, Snapshots `2ae5250074`,
    prettier `9427633b6e`.
  - New sections (+23): NVIDIA `03afae2a69`, OCI `a6fe9c3db6`, Raw configuration `11852e077d`
    (raw.lxc/qemu/apparmor/seccomp/idmap/qemu.qmp.*/scriptlet + linux.kernel_modules, textareas),
    agent.nic_config fold `c7bf156692`. A new section needs: constant+MenuItem in BOTH
    `InstanceFormMenu.tsx` and `ProfileFormMenu.tsx`; a `<Name>Form.tsx`; `<Name>FormValues` type in all
    4 intersections; payload fn wired into `getInstancePayload`/`getProfilePayload` + the inline
    Create*/Edit* payload builders; edit-values lines; and a render line in all 4 host files
    (Create/Edit × Instance/Profile — Edit\* use `section === slugify(CONST)`).
  - **Intentionally NOT exposed** (9): `initial.secureboot.*` (6 secureboot key-material blobs → YAML
    editor only) and `user.network-config`/`user.user-data`/`user.vendor-data` (3 → redundant with the
    Cloud-init section + User properties).
- Deployed live to `/opt/incus/ui` on this host (apt pkg held); redeploy = `yarn build` +
  copy `build/ui/.` → `/opt/incus/ui` (root:root).

## Phase 2 — storage pool driver config coverage (done)
Same gap method vs `/1.0/metadata/configuration` storage_* groups (pool-level). **+31 keys**, all
deployed. New driver sub-forms `StoragePoolForm{LVM,LINSTOR,TrueNAS,Btrfs,Dir}.tsx` (menu section
constant + `is<D>Driver` gate + MenuItem in `StoragePoolFormMenu.tsx`; render in `StoragePoolForm.tsx`;
LINSTOR/TrueNAS added to `isStoragePoolWithSource`). Extended Ceph/CephFS/CephObject. Per-field
touch-points: `util/storagePool.tsx` map, `types/forms/storagePool.d.ts`, payload in `StoragePoolForm.tsx`
(`getPoolKey`), `toStoragePoolFormValues` + `handleConfigKeys` in `util/storagePoolForm.tsx`, sub-form row.
Commits `b2fe98f223`..`6711d5fef2`. **Metadata quirks skipped** (verified vs official incus-ui bundle):
`ceph.osd.pg_name` (real key is `ceph.osd.pg_num`, already wired), `cephobject.bucket_name_prefix`
(real key `cephobject.bucket.name_prefix`, already wired). **Still open for storage:** per-driver
storage *volume* config (storage_volume_* groups, ~120 keys) and storage buckets.

## Phase 2 — OVN interconnect network integrations (done)
New Incus-only surface (`network_integrations` ext, live on 7.4). Server-global entity
(`/1.0/network-integrations`, no project scope, synchronous CRUD, no fine-grained entitlements).
Commit `e7b1d73a1f`. Files: `api/network-integrations.tsx`, `context/useNetworkIntegrations.tsx`,
`pages/networks/{NetworkIntegrationList,CreateNetworkIntegration,EditNetworkIntegration}.tsx` +
`forms/NetworkIntegrationForm.tsx`; wired `queryKeys.networkIntegrations`,
`useSupportedFeatures.hasNetworkIntegrations`, 3 global routes in `App.tsx`, nav entry near
Certificates (gated on the extension). Config exposed: `ovn.northbound_connection` (required),
`ovn.transit.pattern`, `ovn.ca_cert`, `ovn.client_cert`, `ovn.client_key`; `type` fixed to `ovn`.
Deployed to `/opt/incus/ui`. **Corrected after reading the howto** (`0382b2d533`): added the second
required key `ovn.southbound_connection` and fixed the `ovn.transit.pattern` default template.
**Consumption side done** (`0a509a8c3c`): NetworkLocalPeeringForm gained a local/remote "Peer type"
selector (gated on `network_integrations`); remote builds `{type: "remote", target_integration}`
via `createNetworkPeer`, mirroring `incus network peer create <net> <peer> <integration> --type=remote`.
`LxdNetworkPeer` gained `type`/`target_integration`; the NetworkPeers table links the integration in
the target column for remote peers; edit seeds peerType/targetIntegration (description stays the only
mutable field).

## Phase 2 — OVN network load balancers (done)
The 0.22 base only shipped LXD's load-balancer **pool** model
(`network_load_balancer_pool`), and the Load balancers tab was gated behind that
LXD-only extension → invisible on Incus. Incus uses the **backend model**
(`network_load_balancer`): LB = backends (name/target_address/target_port) + ports
that forward a listen port to named backends. Commit `8da7f80dc4`. Changes:
- `hasNetworkLoadBalancers` flag; tab now shows on `network_load_balancer`.
- New `LoadBalancerBackendsForm` (backends + ports-with-target_backend); `LoadBalancerForm`
  / Create / Edit branch to it when pools are absent; `toLoadBalancer` emits the backend
  payload. `LoadBalancerBackendSchema` added.
- `LoadBalancers` hides the pool sub-nav on Incus; `LoadBalancersTab`/`Table` drop pool
  columns/buttons, show backends, and treat backend LBs as editable (not LXD "legacy read-only").
- Create/Edit buttons no longer require a pool on Incus; `useLoadBalancerPools` gained an
  `enabled` arg so it doesn't 404 on Incus.
- Verified payload shape vs live Incus 7.4 (accepted structurally; rejected only on
  target-address subnet membership).

## Phase 2 — UX polish (done)
- Nav: moved "Network integrations" into the **Clustering** accordion (labelled
  "Interconnect"), out of the server area (`4f23e37491`).
- Create-integration page now links to `/howto/network_integrations/`; list page doc links aligned.
- Renamed user-facing "Local peering(s)" → "Peering(s)" (peers can be remote now); route slug
  `local-peerings` unchanged (`NetworkDetail` tab slug derives from path, not label).

## Phase 2 — network address sets + parity cleanup (done)
- **Network address sets** (`network_address_set`, `fb084a20bf`): project-scoped CRUD of named
  IP/CIDR/range groups. `api/network-address-sets.tsx`, `context/useNetworkAddressSets.tsx`,
  `pages/networks/{NetworkAddressSetList,CreateNetworkAddressSet,EditNetworkAddressSet}.tsx` +
  `forms/NetworkAddressSetForm.tsx` (addresses one-per-line). Project-scoped routes, nav item under
  Networking after ACLs, `queryKeys.networkAddressSets`, `hasNetworkAddressSets` flag. ACL rule
  source/destination help notes the `$name` reference. Verified payload vs live Incus 7.4.
- **`storage_volumes_all` → `storage_volumes_all_projects`**: `hasStorageVolumesAll` now gates on the
  Incus extension (True on 7.4), restoring the all-projects volumes feature.
- **Removed dead `hasExplicitTrustToken`** flag.
- Terminology pass ("Cluster member"→"Location", drop VM/container qualifiers) **intentionally dropped**
  from scope per user.

## Phase 2 — network zones + LB health checks (done)
- **Network zones** (`network_dns`/`network_dns_records`, `02f5736c1f`): project-scoped CRUD
  (`api/network-zones.tsx`, `context/useNetworkZones.tsx`, List/Create/Edit pages + `NetworkZoneForm`)
  with `dns.nameservers`, plus a **Records** section on the edit page (add/edit/delete records with
  type/value/ttl entries via `NetworkZoneRecordModal`). Routes + nav under Networking (after Address
  sets). Verified zone+record CRUD vs live Incus 7.4.
- **LB health checks + state** (`network_load_balancer_health_check`, `network_load_balancer_state`):
  health-check config section (enable + interval/timeout/success/failure) on `LoadBalancerBackendsForm`;
  `toLoadBalancer` merges `healthcheck.*` onto preserved LB config; live `LoadBalancerHealthPanel`
  on the edit page from `/load-balancers/IP/state`. New flags `hasNetworkLoadBalancerHealthCheck`,
  `hasNetworkLoadBalancerState`.

## Release automation, versioning & settings polish (done)
- **Release workflow** (`.github/workflows/release.yaml`, `27a7edf06e`): on push to `incus-port`,
  builds the UI, zips `build/ui` → `incendio-ui-<version>.zip`, and publishes a GitHub release via
  `softprops/action-gh-release@v2` (tag/name from the top `## ` heading of `CHANGELOG.md`,
  `body_path: CHANGELOG.md`). Verified: release `0.22-p5` created with the zip asset.
- **CHANGELOG.md** added in the requested format (current release `0.22-p5`).
- **Versioning**: `UI_VERSION` in `util/version.tsx` = `0.22-p5` (UI base `0.22` + `INCENDIO_PATCH`);
  the StatusBar's `Version` component renders `Version <serverVersion>-ui-0.22-p5` (e.g. `7.4-ui-0.22-p5`),
  daemon version live. GitHub tag form = `0.22-p5`. Bump `INCENDIO_PATCH` + add a CHANGELOG entry per release.
- **Settings dropdowns** (`SettingFormSelect`): `acme.challenge` (HTTP-01/DNS-01),
  `backups.compression_algorithm` + `images.compression_algorithm` (none/bzip2/gzip/lz4/lzma/xz/zstd),
  `instances.nic.host_name` (random/mac) render as selects instead of free-text.

## Phase 2 — networking close-off + easy instance wins (done, release 0.22-p6)
- **Forward SNAT** (`b44d357c4b`): `snat` toggle on network forwards for bridged networks
  (`config.snat`); `LxdNetworkForward.config.snat` added; create/edit seed it.
- **DNS nameservers** for bridged/OVN networks: `NetworkFormDns` renders `dns_nameservers` for
  non-physical types when `network_dns_nameservers` is present (field/key map already existed).
  Note: DHCP routes, IPv6 stateful, etc. were already rendered by the network form.
- **VGA console screenshot**: `fetchInstanceConsoleScreenshot` (`GET .../console?type=vga`) + a
  Screenshot button on the graphic console, gated on `instance_console_screenshot`.
- **Snapshot schedule aliases**: added `@midnight` and the instance-only `@startup` option to
  `SnapshotScheduleInput` (via an `includeStartup` prop from the instance snapshots form).
- **Deferred (High)**: NIC-device keys (macvlan `mode`, SR-IOV `security.trusted`) and OVN
  isolated/tunnels — the NIC device panel (`NetworkDevicePanel.tsx`) only handles managed-network
  attach + ACLs, so these stay raw-config/YAML for now. Re-scoped from Low to **High**: it needs a
  `nictype` selector and a conditional field-set swap, i.e. a refactor of a panel currently built
  entirely around the managed-network/ACL model — not just extra inputs.

## Fix — storage volumes 404 + tag-based releases (0.22-p7)
- **Volumes 404 fix**: the earlier re-gate of `hasStorageVolumesAll` onto `storage_volumes_all_projects`
  was wrong — the flag drives `fetchAllStorageVolumes` (`GET /1.0/storage-volumes`), which needs the
  base `storage_volumes_all` extension. Incus 7.4 has only `storage_volumes_all_projects` (a param on
  that endpoint) and 404s the endpoint itself, so the volumes list broke. Reverted to gate on
  `storage_volumes_all` → false on Incus → `collectAllStorageVolumes` per-pool fallback (works).
- **Releases are now tag-triggered**: `.github/workflows/release.yaml` fires on `push: tags: ['*']`
  (not branch pushes). Version = `GITHUB_REF_NAME`; the body is that version's CHANGELOG section
  (awk split on `## <digit>` headings). `softprops/action-gh-release@v3`. Tag `0.22-pN` to release.

## UEFI/NVRAM viewer + QEMU scriptlet (0.22-p7, done)
- **UEFI/NVRAM viewer** (`instance_nvram`): a VM-only **"UEFI Variables"** tab on the instance detail
  page. `fetchInstanceNVRAM` (`GET /1.0/instances/{name}/nvram?recursion=2`) returns
  `LxdInstanceNVRAM = Record<guid, Record<var, LxdInstanceNVRAMVariable>>`; `InstanceUEFIVars.tsx`
  renders a sortable table grouped by GUID (attributes, dissected value, byte size) with per-variable
  delete (`deleteInstanceNVRAMVariable` → `DELETE .../nvram/{guid}/{var}`). Hook `useInstanceNVRAM`
  (queryKey `[instances, name, project, nvram]`). Tab shown only when `instance.type ===
  "virtual-machine"` and `hasInstanceNvram`. Daemon confirms NVRAM ops are VM-only; happy-path shape
  matched against the swagger (no VM image cached locally to exercise live).
- **QEMU scriptlet editor** (`qemu_scriptlet`): `raw.qemu.scriptlet` now renders in a CodeMirror
  editor (`ScriptletConfigInput.tsx`, line numbers + fold gutter) instead of a plain textarea. The
  input adapts CodeMirror's string `onChange` to a synthetic `{target:{name,value}}` event so it works
  through `getConfigurationRow`'s `formik.handleChange` injection. The scriptlet + `raw.qemu.qmp.*` +
  `raw.qemu.conf` rows in `RawConfigForm.tsx` are now gated on `qemu_scriptlet` / `qemu_raw_qmp` /
  `qemu_raw_conf` (previously always shown).
- Flags added: `hasInstanceNvram`, `hasQemuScriptlet`, `hasQemuRawQmp`, `hasQemuRawConf`.

## Cluster settings + group config/used-by (0.22-p9, done)
- **Cluster settings** (`ClusterSettings.tsx`, `/ui/cluster/settings`, shown as "Settings" inside the
  Clustering accordion): a rebalance form
  (`cluster.rebalance.interval/threshold/batch/cooldown` + `cluster.healing_threshold`,
  `cluster.offline_threshold`) and a CodeMirror `instances.placement.scriptlet` editor — Incus's
  placement-group alternative. Saved via `updateSettings`. Formats daemon-checked: cooldown is an
  expiry expression (e.g. `6H`, not `1h`/`60s`); healing/offline thresholds are integer seconds.
- **Cluster group config/used-by**: added `config` to `LxdClusterGroup`; `ClusterGroupForm` now shows
  the group's `config` (read-only key/value) and `used_by` (read-only list). Fixed latent data loss:
  the edit PUT (`EditClusterGroupPanel`) sent only name/description/members, dropping `config` — it now
  preserves `values.bareGroup.config`.
- Evacuation **mode** options (Auto/Stop/Migrate/Live-migrate on `EvacuateClusterMemberBtn`) and the
  per-instance `cluster.evacuate` policy (Migration form) already existed in the base — left as-is.
- Flags: `hasClusterRebalance`, `hasPlacementScriptlet`, `hasClusterGroupUsedBy`.

## Nav reorg (post-p9)
- Settings nav grouped into a new expandable **Settings** accordion (Certificates, Logging, ACME, and
  the original settings page renamed **Advanced**); added the `settings` `AccordionNavMenu` key.
- Cluster settings moved from `/ui/settings/cluster` to `/ui/cluster/settings` and shown as **Settings**
  inside the Clustering accordion.

## Server logging targets + ACME (0.22-p9, done)
- **Server logging targets** (`server_logging`): the named `logging.<name>.*` server config keys are
  wildcards, so the generic Settings table can't manage them. Added `util/serverLogging.tsx`
  (parse flat keys → `LoggingTarget[]`, and `loggingTargetToConfig` to build the PATCH / clear-all on
  delete), plus `Settings → Logging` (`ServerLoggingTargets.tsx` list + `ServerLoggingTargetForm.tsx`
  modal). Supports loki/syslog/webhook (webhook gated on `server_logging_webhook`), address, log level,
  event types, username/password, CA cert, retry, syslog facility, instance, labels, lifecycle filters.
  Parser checks `.target.`/`.logging.`/`.lifecycle.` before the bare `.types` suffix, and matches
  `.target.` before `.logging.` so target names containing "logging" parse correctly.
- **ACME** (`acme`): `Settings → ACME` (`AcmeSettings.tsx`) — a dedicated form for the `acme.*` keys
  (the settings table already lists them under the acme group, but the form is friendlier): agree_tos,
  email, domain, ca_url, challenge (HTTP-01/DNS-01), http.port, provider/environment/resolvers (DNS-01),
  eab.kid/hmac. Saves via `updateSettings` (empty string unsets).
- Both routed under `/ui/settings/{logging,acme}` with nav items gated on `hasServerLogging`/`hasAcme`;
  the "Settings" nav link's `ignoreUrlMatches` extended. Config keys round-trip-validated on the daemon.
- Also: CPU topology inputs stacked vertically (they overflowed side by side).

## Instances / VM batch (0.22-p8, done)
- **Explicit CPU topology** (`CpuLimitSelector`, `parseCpuLimit`, `cpuLimitToPayload`): a third CPU-limit
  mode "topology" (alongside number/fixed), shown for VMs and profiles, with sockets/cores/threads
  inputs building `limits.cpu=sockets=N,cores=N,threads=N` (`instance_limits_cpu_topology`).
  `parseCpuLimit` detects the topology string via `=` *before* the comma/range branch (a topology
  string also has commas). Daemon-validated round-trip.
- **Uptime/started-at + CPU-time** (`InstanceOverview.tsx`): added Started, Uptime, CPU time and
  Allocated CPU time rows from `instance.state.started_at` and `instance.state.cpu.{usage,allocated_time}`
  (extensions `instance_state_started_at`, `instances_state_total`). New `secondsToDurationString` helper;
  `LxdInstanceState` gained `started_at`, cpu gained `allocated_time`.
- **Richer custom-disk options** (`DiskDeviceFormCustom.tsx`): per-disk advanced rows via a `diskOptionRow`
  helper — `io.bus` (virtio-scsi/virtio-blk/nvme/usb) + `io.cache` (VM-only selects), combined byte/s+IOPS
  `limits.read`/`limits.write`/`limits.max` + `limits.max.burst`/`.burst.length`, and `wwn` (virtio-scsi,
  VM-only). Writes flat top-level keys via `setFieldValue(\`devices.${i}\`, {...})` because a
  `devices.${i}.io.bus` formik path would be parsed as a nested object. All keys daemon-validated.
  tmpfs remains TODO (it's a disk *source type*, a separate special-disk flow).
- **Migration refresh + live** (`migrateInstance`, `useInstanceMigration`, `MigrateInstanceModal`):
  `migrateInstance` gained an `options` arg → `refresh` / `live` / `allow_inconsistent` in the migration
  POST. The modal shows, at the confirm stage for cluster-member/pool/project moves, a Refresh checkbox
  and (for running instances) a Live toggle defaulting to the prior auto-live-for-running-VMs behaviour.
- **SMBIOS & credentials** (`CredentialPropertiesForm.tsx` + payload wiring): a raw key/value section
  in the instance edit form for `smbios11.*`, `systemd.credential.*`, `systemd.credential-binary.*`,
  mirroring the user-properties pattern (parse from config; clear+reapply on save, ordered after
  `getUnhandledKeyValues` so it wins). Edit-only, like user properties. Daemon-validated: systemd
  credentials round-trip on containers; smbios11 is VM-only (daemon rejects on containers) but the raw
  editor is shown for both types and the daemon validates per type.

## NIC-device type options — networking close-off (0.22-p8, done)
- **Nictype-specific NIC device widgets** in `NetworkDevicePanel.tsx`, rendered by the selected managed
  network's type via new `NetworkDeviceTypeOptions.tsx`:
  - **macvlan** → `mode` (bridge/vepa/passthru/private) + `vlan`.
  - **sriov** → `security.trusted` + `security.mac_filtering` (checkboxes) + `vlan`.
  - **ovn** → `nested` (parent NIC) + `vlan` (nesting) + `ipv4.routes` / `ipv6.routes`.
- Form model: added the fields to `NetworkDeviceFormValues` and the keys to `LxdNicDevice`; seeded from
  the existing device in `getInitialValues` (a shared `typeOptionDefaults` spread into all branches).
- **Fixes latent data loss**: `onSubmit` previously rebuilt the device from scratch, dropping keys the
  panel doesn't manage (`hwaddr`, `mtu`, `boot.priority`, …). It now spreads the existing device first,
  then sets managed keys — and always sets each type-specific key (value or `undefined`) so switching
  the network's type clears options that no longer apply (`undefined` keys drop out on the PUT).
- Validated every key against the live daemon (temp profiles): macvlan `mode`/`vlan`, sriov
  `security.trusted`/`security.mac_filtering`, OVN `nested`/`vlan`/`ipv4.routes`/`ipv6.routes` all
  round-tripped. Acceleration/`security.promiscuous` remain raw-config (out of scope).
- Re-scoped from the earlier **High** deferral — the panel didn't need a full nictype-selector refactor
  because Incus infers nictype from the selected managed network, so the widgets key off `network.type`.

## Fixes — image architecture aliasing + placement-group gating (0.22-p7)
- **Image selector split one arch into two** (aarch64 vs arm64): `localLxdToRemoteImage` hand-rolled
  arch normalisation with only `x86_64 → amd64`, leaving `aarch64` as-is while simplestreams reports
  `arm64`. On ARM hosts the local and online images landed in separate architecture groups. Fixed by
  routing `image.architecture` through the existing `getArchitectureDisplayName` helper (maps every
  canonical name to its simplestreams alias). Verified: live cached image has top-level
  `architecture: aarch64` but `properties.architecture: arm64`; the spec confirms the helper maps
  aarch64→arm64 / x86_64→amd64.
- **Placement group offered on Incus** (LXD-only feature): Incus has no placement groups (only
  `instances_placement_scriptlet`), and this daemon is a single-member cluster, so the clustered-only
  "Placement group" target option showed on instance creation despite being unsupported. The
  `usePlacementGroups` hook and the nav item were already gated on `hasPlacementGroups`
  (`instance_placement_groups`), but three render sites were not: gated the option in
  `InstanceTargetSelect`, and the `PlacementGroupSelect` in `EditInstanceDetails` and
  `ProfileDetailsForm`.

## Access panels + certificate descriptions (0.22-p10, done)
- **Read-only access panels** (`instance_access` / `project_access`): Incus exposes a
  "who can access" list at `GET /1.0/instances/{name}/access` and `GET /1.0/projects/{name}/access`,
  returning `Access = []AccessEntry{ identifier, role, provider }`. New `api/access.tsx`
  (`fetchInstanceAccess`/`fetchProjectAccess`), `types/access.ts` (`LxdAccessEntry`), and a shared
  presentational `components/ResourceAccessPanel.tsx` (sortable Identifier/Role/Provider table with
  provider labels tls→TLS, openfga→OpenFGA, …; spinner/error/empty states). Wired as:
  - **Instance**: a new **Access** tab in `InstanceDetail` (`InstanceAccess.tsx`), gated on
    `hasInstanceAccess`, appended after UEFI Variables. Route already covers `:activeTab` = `access`.
  - **Project**: a new **Access** nav item under the project (after Usage), gated on
    `hasProjectAccess`, route `/ui/project/:project/access` → `ProjectAccess.tsx` (via `ProjectLoader`).
  These are view-only by design — Incus manages OpenFGA role grants externally (see incus-auth-model),
  and there is no permissions-write API. This closes the earlier "read-only access panels: NOT built"
  deferral.
- **Certificate descriptions** (`certificate_description`): `LxdCertificate` gained `description?`.
  `addCertificate(token, description?)` now sends `description` in the POST (ignored by servers
  without the extension); new `updateCertificateDescription(fingerprint, description)` PATCHes
  `/1.0/certificates/{fingerprint}` with just `{description}`. `TrustedCertificates.tsx` gained a
  **Description** column, an optional Description field in the Add dialog, and an inline **edit**
  action (second `usePortal`) to change a cert's description — all gated on `hasCertificateDescription`.
- Flags added to `useSupportedFeatures`: `hasInstanceAccess`, `hasProjectAccess`,
  `hasCertificateDescription`. queryKey `access` added.
- **Live-validated on Incus 7.4**: all three extensions present; `/1.0/projects/default/access` and
  `/1.0/instances/kj/access` both return `[{identifier, provider:"tls", role:"admin"}]`; the cert
  `description` PATCH round-tripped (set `smoke-test-desc`, read back, restored). `tsc`/`yarn lint-js`
  clean, production `yarn build` succeeds.

## Phase 2 candidates (reassess with user before starting — per decision)
- Read-only `instance_access`/`project_access` entitlement panels.
- Gate `/ui/permissions/*` routes behind `hasAccessManagement` (nav already hidden; blocks manual URL entry only).
- Incus-only api_extension features (187 incus-only extensions) — new UI surface (placement scriptlets, LINSTOR/TrueNAS pool options, etc.).
- Optional cleanup: unused `util/searchAndFilter` helpers / InstanceSearchFilter param constants left after server-side filtering.
