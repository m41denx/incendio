# Analyst C — Zabbly 112-commit patch map & rebase-risk

**Scope:** 84 non-merge commits in `9cbb82d985479d35c8fbf16816a3275996dd941b..zabbly/main` (the 112-count includes 28 merge commits). Base = lxd-ui **0.22** (`6d62c339d6`). Fork-point = `9cbb82d9`.

**Risk rule:** HIGH = commit touches ≥1 file that lxd-ui also changed between fork-point and 0.22 (`git diff --name-only 9cbb82d9 0.22`, 529 files). LOW = none of its files moved upstream.

**Category counts:** rebrand 6 · core-api 16 · feature 33 · bugfix 28 · upstreamed-since 1 (DROP). **Risk:** HIGH 75 · LOW 9. **Portable:** 83.

## Recommended port order

Order = rebrand → core-api → feature → bugfix (chronological within each bucket); drop upstreamed-since. Land branding/API-shape first so feature/bugfix patches apply against already-Incus-ified surfaces.

| # | sha | cat | risk | #f | conflicts | subject |
|---|-----|-----|------|----|-----------|---------|
| 1 | `74f84a06f8` | rebrand | HIGH | 6 | 2 | Update all external links |
| 2 | `13a8ad3a39` | rebrand | HIGH | 16 | 2 | Branding |
| 3 | `02fce4ad92` | rebrand | HIGH | 2 | 1 | Remove Canonical image servers |
| 4 | `4341bb6cdd` | rebrand | LOW | 1 | - | Remove version check |
| 5 | `c07e341f07` | rebrand | HIGH | 3 | 2 | Rename Cluster member to Location |
| 6 | `556e92840c` | rebrand | HIGH | 3 | 1 | Remove 'See {ref}' sentence from description |
| 7 | `8253bd5122` | core-api | HIGH | 13 | 6 | Update certificate generation |
| 8 | `4223123fb0` | core-api | HIGH | 1 | 1 | Improve OpenFGA support |
| 9 | `72543dd33b` | core-api | HIGH | 2 | 2 | Update keys that aren't VM specific |
| 10 | `9b29f04cdf` | core-api | HIGH | 2 | 1 | Rename user.ui_title to user.ui.title |
| 11 | `deef8d6b19` | core-api | HIGH | 2 | 1 | Add user.uid.sso_only |
| 12 | `692f92e41b` | core-api | HIGH | 2 | 1 | Skip LXD identity API |
| 13 | `7f31334f57` | core-api | HIGH | 1 | 1 | Remove zfsDriver default value from storage creation form |
| 14 | `45804b1b63` | core-api | HIGH | 1 | 1 | Disable fine grained permissions |
| 15 | `820872e709` | core-api | HIGH | 13 | 10 | Pass project flag when fetching storage pools |
| 16 | `b4a2bdbf11` | core-api | LOW | 1 | - | instances: Tweak default shell |
| 17 | `789fb3a9af` | core-api | LOW | 1 | - | Add lvmcluster to driversWithFilesystemSupport |
| 18 | `6cf28fdc66` | core-api | HIGH | 5 | 3 | Remove placement groups |
| 19 | `590a745dc9` | core-api | HIGH | 1 | 1 | Add hwaddr to standardKeys |
| 20 | `78aca61b10` | core-api | HIGH | 6 | 3 | Replace ui_ prefix with ui. for user config keys |
| 21 | `85dfa6bc4c` | core-api | HIGH | 18 | 14 | Match storage driver list to Incus |
| 22 | `a146799d6a` | core-api | HIGH | 2 | 2 | Remove physical network name length validation |
| 23 | `d133554ae4` | feature | HIGH | 7 | 3 | Make migration an action |
| 24 | `c03648218c` | feature | HIGH | 3 | 1 | Respect image profile list |
| 25 | `a478da6cc6` | feature | HIGH | 4 | 1 | Add support for LVM Cluster |
| 26 | `829efdc518` | feature | HIGH | 1 | 1 | Annotate application containers in the instance list view |
| 27 | `2cdcd29e43` | feature | HIGH | 4 | 2 | Use state API for instance resource usage |
| 28 | `22f119fb16` | feature | HIGH | 6 | 5 | Add instance preview to overview view |
| 29 | `4c6b9774e5` | feature | HIGH | 8 | 4 | Support for special disks |
| 30 | `8afa4b5b73` | feature | HIGH | 3 | 2 | Show MAC address on instance overview page |
| 31 | `af7c742f3c` | feature | HIGH | 4 | 1 | Add support for storage live migration in UI |
| 32 | `b069024684` | feature | HIGH | 7 | 6 | Improved instance filtering |
| 33 | `5b06c2baaf` | feature | HIGH | 7 | 1 | ui: Added support for OCI instances creation |
| 34 | `191e471466` | feature | HIGH | 6 | 4 | Add support for target selection when creating or moving custom storage volumes |
| 35 | `53bd336367` | feature | HIGH | 2 | 1 | Move instance filtering logic from client to server |
| 36 | `2c93d09287` | feature | HIGH | 10 | 4 | Allow selecting un-managed bridges |
| 37 | `c633f59e9a` | feature | HIGH | 9 | 6 | Add support for managing user properties |
| 38 | `e5e5b29283` | feature | HIGH | 21 | 4 | Implement an IncusOS management page |
| 39 | `e7ecc4b0e8` | feature | HIGH | 4 | 3 | Hide some UI components if not allowed access to the 'default' project |
| 40 | `57186d5127` | feature | HIGH | 6 | 3 | Add OS column to instances view |
| 41 | `19b50960be` | feature | HIGH | 6 | 1 | Allow for instance list columns to be re-ordered |
| 42 | `470319f8cc` | feature | HIGH | 6 | 5 | Add a Usage page for projects |
| 43 | `ef27c110db` | feature | LOW | 2 | - | ui: Decode journald binary messages |
| 44 | `fb5b808557` | feature | HIGH | 7 | 5 | Add console prompt to disconnect an existing session |
| 45 | `8aff2944e0` | feature | HIGH | 7 | 3 | ui: Add minimal console view |
| 46 | `d7fda0212b` | feature | HIGH | 9 | 4 | Add support for configuring custom image servers |
| 47 | `78a193b81e` | feature | HIGH | 19 | 1 | Align IncusOS management pages with MM/OC |
| 48 | `168b1e61d3` | feature | HIGH | 10 | 3 | Add support for migration to remote cluster |
| 49 | `e5cabac53d` | feature | HIGH | 3 | 2 | Add ACL support for bridge NICs |
| 50 | `597745400b` | feature | HIGH | 8 | 2 | Add support for migrating instances in bulk |
| 51 | `f8fd1eb3b7` | feature | HIGH | 1 | 1 | Allow overriding the name during volume import |
| 52 | `e21923904b` | feature | HIGH | 2 | 2 | Remove snapshots and size columns from volumes view |
| 53 | `08a7a77d7f` | feature | HIGH | 5 | 3 | Add support for Windows VMs exec |
| 54 | `8768089a8d` | feature | HIGH | 7 | 5 | Utilize the io.bus=usb functionality for iso |
| 55 | `89e0dbafd3` | feature | HIGH | 3 | 2 | Support adding GPU by vendor id and product id |
| 56 | `8b750e01f4` | bugfix | HIGH | 1 | 1 | Fix stateful snapshots creation |
| 57 | `da2f7d83ac` | bugfix | HIGH | 5 | 4 | Handle console disconnections/reconnections |
| 58 | `0797c4633b` | bugfix | HIGH | 3 | 3 | Improved error messages on the terminal view |
| 59 | `1fea197db8` | bugfix | HIGH | 2 | 2 | Fix issue with listing instances when cluster member is down |
| 60 | `5f3db15de1` | bugfix | LOW | 1 | - | Add missing return to function |
| 61 | `0fb788cd4b` | bugfix | HIGH | 2 | 1 | Add check for null network state counter |
| 62 | `0266ac82d4` | bugfix | HIGH | 3 | 3 | Handle null response from storage-pools API by treating it as an empty array |
| 63 | `59c2b142c0` | bugfix | HIGH | 1 | 1 | Allow clearing CPU limit field |
| 64 | `238da71e47` | bugfix | LOW | 1 | - | util/certificate: Fix serial in generate certificate |
| 65 | `be9d57d8c3` | bugfix | LOW | 1 | - | Set empty default value for cloud-init configuration |
| 66 | `0cda2be95c` | bugfix | HIGH | 4 | 1 | Fix missing current buckets in ui and no storage pool in create bucket form |
| 67 | `c1eef038a1` | bugfix | HIGH | 2 | 2 | Fix displaying number of snapshots on storage volumes page |
| 68 | `40727871f3` | bugfix | LOW | 1 | - | Fix adding devices to an instance |
| 69 | `f3b108edc0` | bugfix | HIGH | 2 | 2 | Improve instance copy handling |
| 70 | `c344855342` | bugfix | HIGH | 3 | 3 | Pass valid filter to useInstances |
| 71 | `e603670991` | bugfix | HIGH | 1 | 1 | Fix passing source for btrfs driver |
| 72 | `1801bd9534` | bugfix | HIGH | 1 | 1 | networks: Only report global addresses on broadcast interfaces |
| 73 | `d0f583e980` | bugfix | HIGH | 1 | 1 | Fix reconnecting issue during vm restart |
| 74 | `4719cd6d03` | bugfix | HIGH | 1 | 1 | Fix undefined notify in InstanceTerminal |
| 75 | `00d4413225` | bugfix | HIGH | 2 | 1 | Revert terminal and console background to previous color |
| 76 | `808853ae70` | bugfix | HIGH | 3 | 3 | Fix undefined showClusterMember in storage volume form |
| 77 | `46ab43c3cf` | bugfix | HIGH | 1 | 1 | Check correct parent value during network device edition |
| 78 | `216ad454c0` | bugfix | HIGH | 2 | 1 | Fix Application container creation |
| 79 | `9dadd77904` | bugfix | LOW | 1 | - | Initialize authMethod variable |
| 80 | `8116826a8a` | bugfix | HIGH | 2 | 2 | Fix OIDC logout |
| 81 | `a9bd9ddafd` | bugfix | HIGH | 3 | 1 | Show 'attached' field as boolean |
| 82 | `cd232b4892` | bugfix | HIGH | 1 | 1 | Fix lvmcluster pool creation |
| 83 | `731fc27ef1` | bugfix | HIGH | 5 | 2 | Query GPUs from the member hosting the instance |

## Dropped (upstreamed-since / superseded)

- `405316ea62` **Add load balancers view** — lxd-ui 0.22 shipped its OWN native load-balancer feature (WD-36668/#2007/#2010, files `src/pages/networks/CreateLoadBalancer.tsx`, `EditLoadBalancer.tsx`, `LoadBalancerPool*.tsx`, `src/context/useLoadBalancers.tsx`, plus health-checks #2079 in the fork tip). Zabbly implemented a parallel, incompatible tree (`CreateNetworkLoadBalancer.tsx`, `NetworkLoadBalancerForm*.tsx`). DROP the zabbly version and adopt upstream native LB; verify it works against Incus network-load-balancer API extensions.

## Highest-risk commits (explicit call-outs)

| sha | conflicts | why it is dangerous |
|-----|-----------|---------------------|
| `85dfa6bc4c` | 14 | **Match storage driver list to Incus** — Rewrites the whole storage-pool driver surface. lxd-ui 0.22 ALSO reworked storage-pool driver forms (Pure/Powerflex/PowerStore/Alletra all changed upstream). Near-certain full-file conflict — rebase manually, reconcile driver list against `incus_only`/`lxd_only` extensions, not a clean cherry-pick. |
| `820872e709` | 10 | **Pass project flag when fetching storage pools** — Threads a `project` flag through 10 storage files that all moved upstream (storage-pools API, StoragePoolSelector, both copy/snapshot forms, StorageVolumeForm). Expect conflicts in every hunk. |
| `e5e5b29283` | 21 | **Implement an IncusOS management page** — IncusOS management page — 21 files, mostly NEW (low textual conflict) but touches shared `App.tsx`/`Navigation.tsx`/`queryKeys.tsx` routing that changed upstream. Split: land new files clean, hand-merge the 4 shared anchors. |
| `78a193b81e` | -/19 | **Align IncusOS management pages with MM/OC** — 'Align IncusOS pages with MM/OC' — 19 files, follow-up to e5e5b29283; only `queryKeys.tsx` conflicts but it DEPENDS on e5e5b29283 landing first. |
| `8253bd5122` | 6 | **Update certificate generation** — Certificate generation for Incus — touches App.tsx, Navigation.tsx, both login cert forms, helpers.tsx, all changed upstream. Core-api, must land early, so resolve conflicts up front. |
| `b069024684` | 6 | **Improved instance filtering** — Server-side instance filtering — changes package.json + yarn.lock + useInstances + InstanceList + InstanceSearchFilter, all upstream-touched. Paired with 53bd336367 (also filtering). Port together. |
| `c633f59e9a` | 6 | **Add support for managing user properties** — User-properties management — EditInstance/InstanceOverview/InstanceFormMenu/instanceAndProfilePayloads all moved upstream. |
| `168b1e61d3` | 3 | **Add support for migration to remote cluster** — Migration to remote cluster — depends on d133554ae4 ('Make migration an action') and af7c742f3c (storage live migration) and 597745400b (bulk migrate); the migration cluster of 4 commits must be ported as an ordered unit against upstream MigrateInstanceModal/instances.tsx. |

### Dependency clusters to port as ordered units

- **Console/terminal** (da2f7d83, 0797c463, fb5b8085, 8aff2944, d0f583e9, 4719cd6d, 00d44132, 08a7a77d): all rewrite InstanceConsole/InstanceTerminal repeatedly; port in commit order or squash.
- **Migration** (d133554a → af7c742f → 597745400 → 168b1e61): make-action → live-storage → bulk → remote-cluster.
- **IncusOS** (e5e5b292 → 78a193b8): base page then alignment.
- **Instance filtering** (b0690246 → 53bd3363 → c3448553): client filter → move-to-server → valid filter.
- **Storage driver/LVM-cluster** (a478da6c, 789fb3a9, cd232b48, 85dfa6bc): LVM-cluster support then driver-list match; 85dfa6bc is the big conflict, land it last in this cluster.
- **user config key rename** (9b29f04c → 78aca61b): ui_title rename then ui_ → ui. prefix sweep; both hit util/settings.tsx.

## Full commit table (chronological)

| sha | cat | risk | #f | conflicting files (upstream-touched) |
|-----|-----|------|----|--------------------------------------|
| `74f84a06f8` | rebrand | HIGH | 6 | `src/components/Navigation.tsx`; `src/components/NotFound.tsx` |
| `13a8ad3a39` | rebrand | HIGH | 16 | `public/assets/js/manifest.js`; `src/sass/styles.scss` |
| `8253bd5122` | core-api | HIGH | 13 | `src/App.tsx`; `src/components/Navigation.tsx`; `src/pages/login/BrowserImport.tsx`; `src/pages/login/CertificateAddForm.tsx`; `src/pages/login/CertificateGenerateBtn.tsx`; `src/util/helpers.tsx` |
| `02fce4ad92` | rebrand | HIGH | 2 | `src/pages/images/ImageSelector.tsx` |
| `4341bb6cdd` | rebrand | LOW | 1 | _(none)_ |
| `4223123fb0` | core-api | HIGH | 1 | `src/util/helpers.tsx` |
| `72543dd33b` | core-api | HIGH | 2 | `src/components/forms/MigrationForm.tsx`; `src/components/forms/SecurityPoliciesForm.tsx` |
| `9b29f04cdf` | core-api | HIGH | 2 | `src/util/settings.tsx` |
| `deef8d6b19` | core-api | HIGH | 2 | `src/util/settings.tsx` |
| `692f92e41b` | core-api | HIGH | 2 | `src/components/Navigation.tsx` |
| `c07e341f07` | rebrand | HIGH | 3 | `src/pages/instances/InstanceOverview.tsx`; `src/pages/instances/InstanceSearchFilter.tsx` |
| `d133554ae4` | feature | HIGH | 7 | `src/api/instances.tsx`; `src/pages/instances/InstanceDetailActions.tsx`; `src/sass/styles.scss` |
| `c03648218c` | feature | HIGH | 3 | `src/pages/instances/CreateInstance.tsx` |
| `a478da6cc6` | feature | HIGH | 4 | `src/util/storagePool.tsx` |
| `8b750e01f4` | bugfix | HIGH | 1 | `src/util/instanceSnapshots.tsx` |
| `829efdc518` | feature | HIGH | 1 | `src/util/instances.tsx` |
| `2cdcd29e43` | feature | HIGH | 4 | `src/pages/instances/InstanceOverviewMetrics.tsx`; `src/util/helpers.tsx` |
| `22f119fb16` | feature | HIGH | 6 | `src/api/instances.tsx`; `src/pages/instances/InstanceOverview.tsx`; `src/sass/_instance_detail_overview.scss`; `src/util/helpers.tsx`; `src/util/queryKeys.tsx` |
| `da2f7d83ac` | bugfix | HIGH | 5 | `src/api/instances.tsx`; `src/pages/instances/InstanceConsole.tsx`; `src/pages/instances/InstanceGraphicConsole.tsx`; `src/pages/instances/InstanceTextConsole.tsx` |
| `7f31334f57` | core-api | HIGH | 1 | `src/pages/storage/CreateStoragePool.tsx` |
| `4c6b9774e5` | feature | HIGH | 8 | `src/components/forms/DiskDeviceFormCustom.tsx`; `src/pages/storage/AttachDiskDeviceModal.tsx`; `src/sass/styles.scss`; `src/util/storageVolume.tsx` |
| `0797c4633b` | bugfix | HIGH | 3 | `src/pages/instances/InstanceConsole.tsx`; `src/pages/instances/InstanceTerminal.tsx`; `src/util/operations.tsx` |
| `1fea197db8` | bugfix | HIGH | 2 | `src/pages/instances/InstanceList.tsx`; `src/util/instances.tsx` |
| `8afa4b5b73` | feature | HIGH | 3 | `src/pages/instances/InstanceOverview.tsx`; `src/util/networks.tsx` |
| `af7c742f3c` | feature | HIGH | 4 | `src/pages/instances/MigrateInstanceModal.tsx` |
| `5f3db15de1` | bugfix | LOW | 1 | _(none)_ |
| `b069024684` | feature | HIGH | 7 | `package.json`; `src/api/instances.tsx`; `src/context/useInstances.tsx`; `src/pages/instances/InstanceList.tsx`; `src/pages/instances/InstanceSearchFilter.tsx`; `yarn.lock` |
| `5b06c2baaf` | feature | HIGH | 7 | `src/sass/styles.scss` |
| `191e471466` | feature | HIGH | 6 | `src/api/storage-volumes.tsx`; `src/pages/storage/CustomVolumeCreateModal.tsx`; `src/pages/storage/forms/StorageVolumeFormMain.tsx`; `src/util/storagePool.tsx` |
| `53bd336367` | feature | HIGH | 2 | `src/pages/instances/InstanceList.tsx` |
| `0fb788cd4b` | bugfix | HIGH | 2 | `src/pages/networks/forms/NetworkStatistics.tsx` |
| `0266ac82d4` | bugfix | HIGH | 3 | `src/api/storage-pools.tsx`; `src/pages/instances/forms/UploadInstanceBackupFileForm.tsx`; `src/pages/storage/UploadCustomIso.tsx` |
| `45804b1b63` | core-api | HIGH | 1 | `src/context/auth.tsx` |
| `556e92840c` | rebrand | HIGH | 3 | `src/components/ConfigurationRow.tsx` |
| `59c2b142c0` | bugfix | HIGH | 1 | `src/components/forms/CpuLimitSelector.tsx` |
| `238da71e47` | bugfix | LOW | 1 | _(none)_ |
| `be9d57d8c3` | bugfix | LOW | 1 | _(none)_ |
| `405316ea62` | upstreamed-since | HIGH | 15 | `src/App.tsx`; `src/pages/networks/NetworkDetail.tsx`; `src/sass/styles.scss`; `src/util/queryKeys.tsx` |
| `2c93d09287` | feature | HIGH | 10 | `src/components/forms/NetworkDevicesForm/NetworkDevicesForm.tsx`; `src/components/forms/NetworkDevicesForm/edit/NetworkDevicePanel.tsx`; `src/util/devices.tsx`; `src/util/instanceAndProfilePayloads.tsx` |
| `0cda2be95c` | bugfix | HIGH | 4 | `src/pages/storage/StoragePoolSelector.tsx` |
| `c1eef038a1` | bugfix | HIGH | 2 | `src/api/storage-volumes.tsx`; `src/pages/storage/StorageVolumes.tsx` |
| `40727871f3` | bugfix | LOW | 1 | _(none)_ |
| `c633f59e9a` | feature | HIGH | 9 | `src/pages/instances/EditInstance.tsx`; `src/pages/instances/InstanceOverview.tsx`; `src/pages/instances/forms/InstanceFormMenu.tsx`; `src/sass/_instance_detail_overview.scss`; `src/util/formChangeCount.tsx`; `src/util/instanceAndProfilePayloads.tsx` |
| `e5e5b29283` | feature | HIGH | 21 | `src/App.tsx`; `src/components/Navigation.tsx`; `src/sass/styles.scss`; `src/util/queryKeys.tsx` |
| `f3b108edc0` | bugfix | HIGH | 2 | `src/pages/instances/forms/CopyInstanceForm.tsx`; `src/util/instances.tsx` |
| `c344855342` | bugfix | HIGH | 3 | `src/pages/instances/forms/CopyInstanceForm.tsx`; `src/pages/instances/forms/CreateInstanceFromSnapshotForm.tsx`; `src/pages/storage/StorageVolumeNameLink.tsx` |
| `e603670991` | bugfix | HIGH | 1 | `src/pages/storage/forms/StoragePoolForm.tsx` |
| `820872e709` | core-api | HIGH | 13 | `src/api/storage-pools.tsx`; `src/components/forms/DiskDeviceFormRoot.tsx`; `src/context/useStoragePools.tsx`; `src/pages/instances/forms/CopyInstanceForm.tsx`; `src/pages/instances/forms/CreateInstanceFromSnapshotForm.tsx`; `src/pages/storage/CustomVolumeCreateModal.tsx`; `src/pages/storage/StoragePoolSelector.tsx`; `src/pages/storage/forms/StorageVolumeForm.tsx`; `src/pages/storage/forms/StorageVolumeFormMain.tsx`; `src/pages/storage/forms/UploadVolumeBackupFileForm.tsx` |
| `1801bd9534` | bugfix | HIGH | 1 | `src/util/networks.tsx` |
| `b4a2bdbf11` | core-api | LOW | 1 | _(none)_ |
| `789fb3a9af` | core-api | LOW | 1 | _(none)_ |
| `6cf28fdc66` | core-api | HIGH | 5 | `src/components/Navigation.tsx`; `src/pages/instances/InstanceOverview.tsx`; `src/pages/profiles/ProfileDetailOverview.tsx` |
| `e7ecc4b0e8` | feature | HIGH | 4 | `src/components/Navigation.tsx`; `src/pages/projects/NavigationProjectSelector.tsx`; `src/util/permissions.tsx` |
| `57186d5127` | feature | HIGH | 6 | `src/pages/instances/InstanceList.tsx`; `src/pages/instances/InstanceOverview.tsx`; `src/util/instances.tsx` |
| `590a745dc9` | core-api | HIGH | 1 | `src/util/devices.tsx` |
| `19b50960be` | feature | HIGH | 6 | `src/pages/instances/InstanceList.tsx` |
| `470319f8cc` | feature | HIGH | 6 | `src/App.tsx`; `src/api/projects.tsx`; `src/components/Navigation.tsx`; `src/types/project.d.ts`; `src/util/queryKeys.tsx` |
| `ef27c110db` | feature | LOW | 2 | _(none)_ |
| `fb5b808557` | feature | HIGH | 7 | `src/api/instances.tsx`; `src/pages/instances/InstanceConsole.tsx`; `src/pages/instances/InstanceGraphicConsole.tsx`; `src/pages/instances/InstanceOverview.tsx`; `src/pages/instances/InstanceTextConsole.tsx` |
| `8aff2944e0` | feature | HIGH | 7 | `src/Root.tsx`; `src/pages/instances/InstanceConsole.tsx`; `src/sass/styles.scss` |
| `d0f583e980` | bugfix | HIGH | 1 | `src/pages/instances/InstanceConsole.tsx` |
| `d7fda0212b` | feature | HIGH | 9 | `src/context/useImages.tsx`; `src/pages/images/ImageSelector.tsx`; `src/pages/settings/SettingForm.tsx`; `src/util/settings.tsx` |
| `78a193b81e` | feature | HIGH | 19 | `src/util/queryKeys.tsx` |
| `78aca61b10` | core-api | HIGH | 6 | `src/pages/settings/SettingForm.tsx`; `src/util/settings.tsx`; `tests/server.spec.ts` |
| `168b1e61d3` | feature | HIGH | 10 | `src/api/instances.tsx`; `src/pages/instances/InstanceList.tsx`; `src/pages/instances/MigrateInstanceModal.tsx` |
| `4719cd6d03` | bugfix | HIGH | 1 | `src/pages/instances/InstanceTerminal.tsx` |
| `00d4413225` | bugfix | HIGH | 2 | `src/pages/instances/InstanceTerminal.tsx` |
| `808853ae70` | bugfix | HIGH | 3 | `src/pages/storage/CustomVolumeCreateModal.tsx`; `src/pages/storage/forms/StorageVolumeForm.tsx`; `src/pages/storage/forms/StorageVolumeFormMain.tsx` |
| `e5cabac53d` | feature | HIGH | 3 | `src/components/forms/NetworkDevicesForm/edit/NetworkDevicePanel.tsx`; `src/util/networks.tsx` |
| `46ab43c3cf` | bugfix | HIGH | 1 | `src/components/forms/NetworkDevicesForm/edit/NetworkDevicePanel.tsx` |
| `216ad454c0` | bugfix | HIGH | 2 | `src/util/instanceAndProfilePayloads.tsx` |
| `597745400b` | feature | HIGH | 8 | `src/api/instances.tsx`; `src/pages/instances/InstanceList.tsx` |
| `f8fd1eb3b7` | feature | HIGH | 1 | `src/pages/storage/forms/UploadVolumeBackupFileForm.tsx` |
| `85dfa6bc4c` | core-api | HIGH | 18 | `src/pages/storage/CreateStoragePool.tsx`; `src/pages/storage/forms/StorageDriverSelect.tsx`; `src/pages/storage/forms/StoragePoolForm.tsx`; `src/pages/storage/forms/StoragePoolFormAlletra.tsx`; `src/pages/storage/forms/StoragePoolFormMain.tsx`; `src/pages/storage/forms/StoragePoolFormMenu.tsx`; `src/pages/storage/forms/StoragePoolFormPowerStore.tsx`; `src/pages/storage/forms/StoragePoolFormPowerflex.tsx`; `src/pages/storage/forms/StoragePoolFormPure.tsx`; `src/pages/storage/forms/StorageVolumeForm.tsx`; `src/types/forms/storagePool.d.ts`; `src/util/instanceOptions.tsx`; `src/util/storagePool.tsx`; `src/util/storagePoolForm.tsx` |
| `9dadd77904` | bugfix | LOW | 1 | _(none)_ |
| `8116826a8a` | bugfix | HIGH | 2 | `src/components/Navigation.tsx`; `src/context/auth.tsx` |
| `e21923904b` | feature | HIGH | 2 | `src/api/storage-volumes.tsx`; `src/pages/storage/StorageVolumes.tsx` |
| `a9bd9ddafd` | bugfix | HIGH | 3 | `src/util/formChangeCount.tsx` |
| `08a7a77d7f` | feature | HIGH | 5 | `src/api/instances.tsx`; `src/pages/instances/InstanceTerminal.tsx`; `src/util/instances.tsx` |
| `8768089a8d` | feature | HIGH | 7 | `src/components/forms/DiskDeviceFormCustom.tsx`; `src/pages/instances/CreateInstance.tsx`; `src/pages/instances/actions/AttachIsoBtn.tsx`; `src/pages/storage/AttachDiskDeviceModal.tsx`; `src/util/devices.tsx` |
| `cd232b4892` | bugfix | HIGH | 1 | `src/util/storagePool.tsx` |
| `a146799d6a` | core-api | HIGH | 2 | `src/pages/networks/NetworkDetailHeader.tsx`; `src/util/networkForm.tsx` |
| `731fc27ef1` | bugfix | HIGH | 5 | `src/pages/instances/CreateInstance.tsx`; `src/pages/instances/EditInstance.tsx` |
| `89e0dbafd3` | feature | HIGH | 3 | `src/components/DeviceDetails.tsx`; `src/components/forms/GPUDeviceInput.tsx` |
