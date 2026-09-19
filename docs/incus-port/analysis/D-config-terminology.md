# Analyst D — Config-Key & Terminology Delta (LXD → Incus)

Scope: what the UI must change in config keys, labels/strings, storage-driver
lists and external/documentation URLs to be an Incus UI. Sources: incus vs lxd
config metadata (`/home/m41den/refs/incus/doc/config_options.txt` = 998 option
blocks; `/home/m41den/refs/lxd/doc/metadata.txt` = 877), the zabbly rebrand/config
commits (`/home/m41den/refs/incus-ui-canonical`, range `9cbb82d9..main`), and the
current fork `/home/m41den/incendio` (branch `incus-port`, lxd-ui 0.22 base — NONE
of the zabbly config/terminology work is applied yet).

---

## 1. Renamed config keys — the UI's OWN `user.*` keys

The UI stores its preferences as server-level `user.*` config. LXD-UI used a
`ui_` prefix; Incus moved these to a dotted `user.ui.` namespace. Zabbly commits
`9b29f04c` (title), `78aca61b` (ui_ prefix), `deef8d6b` (sso_only). The fork
still uses every old key.

| LXD-UI key | Incus-UI key | Fork files to touch |
|---|---|---|
| `user.ui_grafana_base_url` | `user.ui.grafana.base_url` | `src/util/settings.tsx:69`, `src/util/grafanaUrl.tsx:9`, `public/assets/scripts/setup-grafana.sh:111` |
| `user.ui_login_project` | `user.ui.default_project` (**also a semantic rename**, not just prefix) | `src/util/settings.tsx:80`, `src/pages/settings/SettingForm.tsx:55`, `tests/login-project.spec.ts` |
| `user.ui_theme` | `user.ui.theme` | `src/util/settings.tsx:88`, `src/pages/settings/SettingForm.tsx:54` |
| `user.ui_title` | `user.ui.title` | `src/util/settings.tsx:97`, `src/util/title.tsx:18` |
| `user.ui_terminal_default_payload` | **UNCHANGED** — zabbly LEFT this one as `user.ui_terminal_default_payload` (underscore) | `src/util/instanceTerminal.tsx:4` |

Note the inconsistency: zabbly migrated 4 of the 5 `ui_` keys to `ui.` but left
`user.ui_terminal_default_payload` with the old underscore form
(`incus-ui-canonical/src/util/instanceTerminal.tsx:5`). Incendio can either match
zabbly (leave it) or finish the job (`user.ui.terminal_default_payload`); flag as
a decision. `grafanaUrl.tsx` also keeps a fallback read of the even-older
`user.grafana_base_url` — retain that fallback.

`user.microcloud` (`src/util/settings.tsx:29`) is LXD/MicroCloud-specific; zabbly
KEPT it (`incus-ui-canonical/src/util/settings.tsx:30`). Harmless on incus (it is
a `user.*` free-form key) but semantically dead — MicroCloud is not an Incus
product. See also title branding in §4.

### New `user.ui.*` keys Incus UI introduces (not in fork)
- `user.ui.sso_only` (bool) — restrict login page to OIDC/SSO. Read in
  `Login.tsx` (`settings?.config?.["user.ui.sso_only"] == "true"`). Added by
  zabbly `deef8d6b`; also defined in `settings.tsx` getUserSettings.
- `user.ui.image_servers` = `IMAGE_SERVERS_KEY`
  (`incus-ui-canonical/src/util/imageServers.ts:1`) — custom image-server list.
  Added by zabbly `d7fda021` (`ImageServersForm.tsx`). SettingForm branches on it
  (`isImageServers`). The fork has neither the key nor `ImageServersForm.tsx`.

---

## 2. Renamed INSTANCE config key — `security.devlxd` → `security.guestapi`

Incus renamed the `/dev/lxd` guest socket to `/dev/incus` and the gating config
keys accordingly (`incus/doc/config_options.txt:3001-3013`):

| LXD key | Incus key | shortdesc |
|---|---|---|
| `security.devlxd` | `security.guestapi` | "Whether `/dev/incus` is present in the instance" |
| `security.devlxd.images` | `security.guestapi.images` | "Controls the availability of the `/1.0/images` API over `guestapi`" |

Incus has **zero** references to `devlxd` anywhere in `internal/` or `shared/`
(no backward-compat alias). **Zabbly's UI did NOT migrate these keys** — it still
sends `security.devlxd` / `security.devlxd.images`
(`incus-ui-canonical/src/util/instanceConfigFields.tsx:16-17`) and only softened
the label (commit `72543dd3` dropped the "(Containers only)" qualifier). That is a
latent bug for incendio to fix, not copy. Fork touch points:
- `src/util/instanceConfigFields.tsx:16-17` (`security_devlxd`→`security.devlxd`,
  `security_devlxd_images`→`security.devlxd.images`) — repoint values to
  `security.guestapi` / `security.guestapi.images`.
- `src/components/forms/SecurityPoliciesForm.tsx:157,173` — form field + label
  `"Allow /dev/lxd in the instance (Containers only)"` → `/dev/incus`.
- `src/types/forms/instanceAndProfile.d.ts:96-97`,
  `src/util/instanceAndProfilePayloads.tsx:172` — form field plumbing (the local
  form-field name `security_devlxd` can stay; only the mapped config key must
  change).

Other `raw.*` and instance keys are unchanged in incus (verified present in
`config_options.txt`: `raw.lxc`, `raw.apparmor`, `raw.idmap`, `migration.stateful`,
`linux.kernel_modules`, `security.idmap.isolated`, `boot.host_shutdown_timeout`),
so the rest of `instanceConfigFields.tsx` needs no key renames.

---

## 3. Removed / Canonical-only config keys & storage drivers

### Storage drivers (zabbly `85dfa6bc` "Match storage driver list to Incus")
Incus driver set (`incus/internal/server/storage/drivers/driver_*.go`):
`btrfs, ceph, cephfs, cephobject, dir, linstor, lvm, truenas, zfs`.
LXD adds four proprietary drivers Incus does NOT ship, whose config keys appear
as **LXD-only** in the metadata diff:
- `powerflex.*` (`powerflex.gateway`, `powerflex.pool`, `powerflex.sdt`,
  `powerflex.user.name/password`, `powerflex.mode`, …) — REMOVE
- `powerstore.*` (`powerstore.gateway`, `powerstore.target`, …) — REMOVE
- `pure.*` (`pure.api.token`, `pure.gateway`, `pure.target`, …) — REMOVE
- `alletra.*` (`alletra.cpg`, `alletra.wsapi`, `alletra.target`, …) — REMOVE

Incus ADDS `linstor.*` and `truenas.*` config keys the UI has no forms for.

Fork touch points (all present, none removed yet):
- `src/util/storageOptions.tsx:11-14` define `powerFlex`, `powerStore`,
  `pureStorage`, `alletraDriver` (+ their labels/descriptions lines 25-47,
  cluster-source lists line 125). Replace with `linstor`, `truenas`.
- `src/pages/storage/forms/StoragePoolFormPowerflex.tsx`,
  `StoragePoolFormPowerStore.tsx`, `StoragePoolFormPure.tsx`,
  `StoragePoolFormAlletra.tsx` — delete (zabbly deleted all four).
- `StoragePoolFormMain.tsx`, `StoragePoolFormMenu.tsx`, `StorageDriverSelect.tsx`,
  `CreateStoragePool.tsx`, `StorageVolumeFormBlock.tsx`, `instanceOptions.tsx`,
  `src/types/config.d.ts`, `src/types/forms/storagePool.d.ts`,
  `src/util/permissions.spec.ts` — strip the four drivers, add Linstor/TrueNAS.

### Other removed keys
- `ubuntu_pro.guest_attach` — LXD-only, gone in incus (Ubuntu Pro is
  Canonical-only). Not referenced by the fork's config forms; safe.
- Fan-networking keys `fan.overlay_subnet` / `fan.underlay_subnet` and the
  `bridge.mode=fan` option are LXD-only (Ubuntu FAN). Verify no UI form exposes
  a "fan" bridge mode.

---

## 4. Notable Incus-only config keys the UI may reference / surface

From `comm` of the two metadata key sets (incus 998 vs lxd 877), incus-only keys
of UI relevance:
- **Authorization**: `authorization.scriptlet`,
  `authorization.openfga.api.url/token`, `authorization.openfga.store.id`,
  `authorization.client.{default,oidc,tls,tls-restricted,unix}` — Incus uses
  OpenFGA where LXD used Candid/RBAC. Affects any server-settings auth surfacing.
- **ACME**: `acme.provider`, `acme.provider.environment`,
  `acme.provider.resolvers`, `acme.eab.hmac`, `acme.eab.kid`, `acme.http.port`
  (LXD had a narrower `acme.*`).
- **Cluster rebalancing**: `cluster.rebalance.{batch,cooldown,interval,threshold}`
  — Incus auto-rebalancing, no LXD equivalent.
- **Boot/shutdown**: `boot.autorestart`, `boot.host_shutdown_action`,
  `core.shutdown_action`, `core.https_allowed_websocket_origin`,
  `core.storage_buckets_address`.
- **DRBD (Linstor)**: `drbd.*`, plus `linstor.*` and `truenas.*` storage keys.
- Networking additions: `ipv4/ipv6.gateway.hwaddr`, `ipv4.dhcp.routes`,
  `ipv6.host_tables`, `bridge.multicast_relay/snooping`, `bgp.peers.NAME.interface`.

These are candidates for later feature work (analyst-B/C territory); for D they
matter because any hardcoded key allow-list in the UI (e.g. `standardKeys` in
`src/util/devices.tsx` — zabbly `590a745d` added `hwaddr` there) must not reject
incus-only keys. Most UI config surfaces read the server's metadata dynamically,
so no per-key change is needed beyond the hardcoded ones catalogued above.

---

## 5. Terminology changes (labels / strings)

| LXD term | Incus term | Fork location(s) |
|---|---|---|
| "Cluster member" (as an instance's location) | "Location" | `src/util/instanceTable.tsx:4` (`CLUSTER_MEMBER` const), `src/pages/instances/InstanceOverview.tsx:85`, `src/pages/instances/InstanceSearchFilter.tsx:72`, `src/pages/instances/forms/EditInstanceDetails.tsx:52`, `ClusterMemberSelector.tsx:22`. Zabbly `c07e341f` renamed only the instance-facing labels via the shared `CLUSTER_MEMBER` const + two files; the Cluster *pages* (`ClusterMemberList/Detail`, evacuate/restore btns) keep "Cluster member". |
| "Ubuntu" / "Ubuntu Minimal" / "LXD Images" image-server labels | "Linux Containers" | `src/pages/images/ImageSelector.tsx` (uses `canonicalServer`/`minimalServer`/`imagesLxdServer`), `src/util/imageLegacy.ts:11,16,19`. Zabbly `02fce4ad` collapsed all three to a single `linuxContainersServer` labelled "Linux Containers". |
| "/dev/lxd" | "/dev/incus" | `SecurityPoliciesForm.tsx` labels (§2). |
| "(VMs only)" / "(Containers only)" qualifiers | dropped | `MigrationForm.tsx` ("Stateful migration (VMs only)"→"Stateful migration"), `SecurityPoliciesForm.tsx` (zabbly `72543dd3`). |
| Title suffix "LXD UI" / "MicroCloud" | "Incus UI" | `src/util/title.tsx:9,19` — fork builds `${host} | ${suffix}` with `suffix = isMicroCloud ? "MicroCloud" : "LXD UI"`; zabbly hardcodes `${host} | Incus UI` and drops the microcloud branch. |
| "…work with LXD." | "…work with Incus." | `src/pages/storage/UploadCustomImageHint.tsx:14` (zabbly also removed the Ubuntu-tutorial Windows-ISO link there). |
| "LXD" product name in assorted copy | "Incus" | broad; e.g. `NoMatch.tsx` viewer-permission copy reworded by zabbly `74f84a06`. Branding sweep overlaps analyst on strings. |

---

## 6. Documentation / external URL replacements

| Fork URL (LXD/Canonical) | Incus replacement | Fork location |
|---|---|---|
| `https://documentation.ubuntu.com/lxd/en/latest` (docs base) | `/documentation` (bundled local docs; canonical remote is `https://linuxcontainers.org/incus/docs/main/`) | `src/context/useDocs.tsx:4` — zabbly `74f84a06` set `remoteBase = "/documentation"` (== localBase) |
| `https://documentation.ubuntu.com/lxd/v5/reference/remote_image_servers/#…` | incus docs equivalent | `src/pages/images/ImageRegistryProtocolSelector.tsx:16` — **zabbly left this unchanged**; incendio should fix |
| `https://documentation.ubuntu.com/lxd/en/latest/reference/networks/` (comment) | incus docs | `src/pages/networks/forms/NetworkForm.tsx:185` (comment only) |
| `https://documentation.ubuntu.com/lxd/en/latest/api/` (comment) | incus docs | `src/util/resourceDetails.tsx:30` |
| `https://discourse.ubuntu.com/c/lxd/126` | `https://discuss.linuxcontainers.org` | `src/components/Navigation.tsx:775` (zabbly `74f84a06`) |
| `https://github.com/canonical/lxd-ui/issues/new` | incendio's own repo (zabbly used `github.com/zabbly/incus-ui-canonical`) | `src/components/NoMatch.tsx:15`, `src/util/reportBug.tsx:28` |
| `https://github.com/canonical/lxd-ui/wiki/Authentication-Setup-FAQ` | incendio/incus equivalent | `src/pages/login/CertificateGenerate.tsx:69` |
| image stream JSON + servers: `cloud-images.ubuntu.com/releases`, `cloud-images.ubuntu.com/minimal/releases`, `images.lxd.canonical.com` | `https://images.linuxcontainers.org` (+ `/streams/v1/images.json`) | `src/util/imageLegacy.ts:10-19` (zabbly `02fce4ad`) |
| `https://cloud-images.ubuntu.com/daily/` (default registry URL) | incus/linuxcontainers image server | `src/pages/images/panels/CreateImageRegistryPanel.tsx:62` |
| `https://cloud-images.ubuntu.com/releases/` (placeholder) | linuxcontainers | `src/pages/images/ImageRegistryForm.tsx:84` |
| `https://ubuntu.com/tutorials/how-to-install-a-windows-11-vm-using-lxd…` | removed | `src/pages/storage/UploadCustomImageHint.tsx:15` (zabbly deleted) |
| setup-grafana.sh doc links `documentation.ubuntu.com/lxd/en/latest/{metrics,howto/grafana}` + `loki.instance=lxd` + the `user.ui_grafana_base_url` key | incus docs + `user.ui.grafana.base_url` | `public/assets/scripts/setup-grafana.sh:15,111,129` |

Code-comment references to `github.com/canonical/lxd` (architectures.tsx:1,
images.tsx:155, resourceDetails.tsx:51, auth-permissions.tsx:17,
permissions.tsx:24, _selectable_main_table.scss:9) are non-user-facing; update
opportunistically, not required for function.

---

## 7. Summary of what the port must touch (config/terminology only)

1. Rename 4 `user.ui_*` → `user.ui.*` keys across `settings.tsx`, `SettingForm.tsx`,
   `grafanaUrl.tsx`, `title.tsx`, `setup-grafana.sh`, tests (decide on the 5th,
   `user.ui_terminal_default_payload`).
2. Add `user.ui.sso_only` + `user.ui.image_servers` support (new Login/ImageServers
   behaviour).
3. Rename instance keys `security.devlxd[.images]` → `security.guestapi[.images]`
   (fix that zabbly missed) and `/dev/lxd` copy → `/dev/incus`.
4. Storage: drop powerflex/powerstore/pure/alletra drivers+keys+forms, add
   linstor/truenas.
5. Terminology: "Cluster member"→"Location" (instance context), image-server
   labels→"Linux Containers", drop "(VMs/Containers only)" qualifiers, title
   suffix→"Incus UI".
6. URLs: docs base → `/documentation`, discourse → discuss.linuxcontainers.org,
   image servers → images.linuxcontainers.org, bug/report links → incendio repo,
   and the two doc links zabbly left on documentation.ubuntu.com.
