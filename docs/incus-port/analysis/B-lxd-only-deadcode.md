# Analyst B — LXD-only / Canonical dead-code audit

**Fork:** `/home/m41den/incendio` @ `incus-port` (HEAD `6d62c339d6`). **Verified authoritatively against incus source** `/home/m41den/refs/incus` `internal/version/api.go` (558 extensions, checkout `09bc08d`), not just the doc-derived seed lists.

## Headline finding: the fork is essentially UNMODIFIED lxd-ui

Despite the branch name `incus-port`, **none of zabbly's incus adaptations have been applied**. `src/context/auth.tsx`, `src/util/imageLegacy.ts`, `src/components/Version.tsx`, `src/context/useLoggedInUser.tsx`, `src/components/Logo.tsx` are all byte-for-byte the Canonical lxd-ui versions (compared against zabbly commits that patch exactly these files). The branch is a *newer* lxd-ui than tag 0.22 — it already contains LXD features that post-date 0.22 and post-date zabbly's fork-point: **replicators, cluster links, network load-balancer pools, placement groups, instance import/conversion, managed cloud-init SSH keys, PowerFlex/PowerStore/Pure/Alletra storage drivers**. Every one of these is an **LXD** feature absent from incus.

So this audit's job is twofold: (1) LXD-only extension gates that never fire on incus, and (2) Canonical/Ubuntu integrations that must be swapped to incus/linuxcontainers equivalents — the same set of changes zabbly made, plus the newer LXD features zabbly never had to deal with.

The single gating helper is **`src/context/useSupportedFeatures.tsx`** (`apiExtensions = new Set(settings.api_extensions)`, `apiExtensions.has("...")`). There is no `hasFeature`/`isSettingsDisabled` abstraction; each capability is a named `has*` boolean.

---

## CATEGORY 1 — LXD-only extension gates

Each `has*` flag below is `apiExtensions.has("<ext>")` where `<ext>` is confirmed **absent from incus** `internal/version/api.go`. Grouped by UI consequence.

### 1a. Whole features that vanish (fail-closed — nav hidden, no crash) — dead weight

| Flag / extension | Files | Incus impact |
|---|---|---|
| `hasReplicators` / `replicators` | `useSupportedFeatures.tsx:62`; `components/Navigation.tsx:573`; `pages/cluster/Server.tsx:59`; `context/auth.tsx:46,86`; `api/replicators.tsx`, `context/useReplicators.tsx`, `pages/cluster/Replicator*.tsx` (whole subtree ~15 files); `pages/projects/forms/ProjectReplicaForm.tsx`, `ProjectFormMenu.tsx`; `api/projects.tsx`, `context/useProjects.tsx` | Entire replicators feature is an LXD-only construct. Nav item hidden on incus; `fetchProjects(..., hasReplicators)` correctly stops requesting the replica field. All of `pages/cluster/Replicator*` + `api/replicators.tsx` is dead code. |
| `hasClusterLinks` / `cluster_links` | `useSupportedFeatures.tsx:61`; `Navigation.tsx:549`; `pages/cluster/Server.tsx`; `ClusterLinkList` route `App.tsx:37,570`; `ReplicatorList.tsx`, `CreateReplicatorBtn.tsx`, `ReplicatorListEmptyState.tsx` | LXD cluster-links UI. Nav hidden on incus; `pages/cluster/ClusterLink*` dead. |
| `hasLoadBalancerPools` / `network_load_balancer_pool` | `useSupportedFeatures.tsx:63`; `components/NetworkListTable.tsx`; `pages/networks/NetworkList.tsx`, `NetworkDetail.tsx`; `LoadBalancerPoolsTable.tsx`, `forms/LoadBalancerPoolForm.tsx` | LXD "load-balancer pool" (distinct from incus's plain `network_load_balancer`). Hidden on incus. |
| `hasLoadBalancerHealthChecks` / `network_load_balancer_pool_health_checks` | `useSupportedFeatures.tsx:65`; `LoadBalancerPoolForm.tsx`, `LoadBalancerPoolsTable.tsx` | Sub-feature of the above (guarded by commit `6d62c339d6`). Doubly dead. |
| `hasAccessManagement` / `access_management` | `useSupportedFeatures.tsx:26`; `Navigation.tsx:636` (gates the **whole Permissions nav section**); `pages/permissions/PermissionIdentities.tsx` | The entire Permissions section (identities, groups, IdP groups) disappears on incus. Incus has its own OpenFGA auth but a different API — this is a real capability gap, not just cosmetic. |
| `hasCloudInitSshKeys` / `cloud_init_ssh_keys` | `useSupportedFeatures.tsx:42`; `components/forms/SshKeyForm.tsx` | LXD 6.x "managed SSH keys" panel. Form fields (`cloud_init_ssh_keys` in `instanceAndProfilePayloads`, CreateInstance/CreateProfile defaults, InstanceFormMenu/ProfileFormMenu menu item) remain but the panel is gated off. Note: `cloud_init_ssh_keys` the *form field* is used unconditionally elsewhere — only the SshKeyForm feature-detect is dead. |
| `hasBackupMetadataVersion` / `backup_metadata_version` | `useSupportedFeatures.tsx:43`; `pages/instances/forms/ExportInstanceModal.tsx:47`; `pages/storage/forms/ExportVolumeModal.tsx:38` | Backup-format-version selector on export dialogs hidden on incus. |
| `hasInstanceBootMode` / `instance_boot_mode` | `useSupportedFeatures.tsx:49`; `components/forms/SecurityPoliciesForm.tsx`, `BootForm.tsx` | Boot-mode (bios/uefi toggle) control hidden. Incus has `instance_uefi_vars`/`instance_boot_mode`-style controls under other names — see Analyst A. |
| `hasInstanceImportConversion` / `instance_import_conversion` | `useSupportedFeatures.tsx:30`; `pages/instances/forms/UploadInstanceBackupFileForm.tsx` | LXD VM import/conversion path hidden. |
| `hasStorageNvmeTcp` / `storage_nvme_tcp` | `useSupportedFeatures.tsx:64`; `pages/storage/forms/StoragePoolFormPowerflex.tsx`, `StoragePoolFormPure.tsx`, `StoragePoolFormAlletra.tsx`; `util/instanceOptions.tsx` | Tied to the LXD-only enterprise storage drivers (below). |

**Recommended action for 1a:** these fail-closed (hidden, no crash), so they are *safe* but pure dead weight and a maintenance/misdirection hazard. Preferred: **remove** the replicators, cluster-links, load-balancer-pool, import-conversion and managed-ssh-key subtrees (as separate, revertable commits). Minimum-viable: **leave gated** — they never activate. Permissions (`access_management`) should be **disabled the way zabbly did** (see Category 2, "fine-grained permissions") and re-ported to incus auth later, not silently dropped.

### 1b. LXD-only enterprise storage drivers — dead forms + a mirror-image GAP

`src/util/storageOptions.tsx:11-14` declares `powerflex`, `powerstore`, `pure`, `alletra`; `src/pages/storage/forms/StoragePoolForm{Powerflex,PowerStore,Pure,Alletra}.tsx` implement their config panels; `src/util/storagePoolForm.tsx:77-80+` maps `powerflex.*` config keys. Extensions `storage_driver_pure|powerflex|alletra|powerstore*` are **all absent from incus**.

**Fail-closed by luck:** `getStorageDriverOptions()` (`storageOptions.tsx:57`) only lists drivers present in `settings.environment.storage_supported_drivers`, so incus (which never reports these) hides the options — the four form files are unreachable dead code.

**Mirror-image GAP (flag to Analyst A):** the same allow-list logic silently DROPS incus's **`linstor`** and **`truenas`** drivers because `storageDriverLabels`/`storageDriverDescriptions` have no entries for them → incus users cannot create Linstor/TrueNAS pools in the UI. zabbly fixed both sides in one commit `85dfa6bc` "Match storage driver list to Incus" (add Linstor+TrueNAS, remove PowerFlex/PowerStore/Pure/Alletra).

**Recommended:** remove the four LXD driver constants/forms/config-mappings; add `linstor` and `truenas` labels+descriptions+forms.

### 1c. Behavior/perf toggles that degrade CORRECTLY (fail-closed, fallback is right for incus)

These gate an LXD API-shape optimization; the `false` branch is the older/simpler behavior that incus still supports. **No action strictly required**, but the flags and the LXD-only branches are dead and could be simplified.

- `hasStorageAndNetworkOperations` / `storage_and_network_operations` — `useSupportedFeatures.tsx:56`; ~28 files (`api/networks.tsx`, `api/storage-pools.tsx`, `api/storage-buckets.tsx`, all `pages/networks/*` and `pages/storage/*` create/edit/delete). Toggles whether storage/network mutations are treated as async operations. Incus returns these synchronously → the `false` path is correct. Largest single gate footprint in the codebase.
- `hasStorageAndProfileOperations` / `storage_and_profile_operations` — `useSupportedFeatures.tsx:44`; 8 files under `pages/storage/*` + `pages/profiles/EditProfile.tsx`. Same shape.
- `hasInstanceStateSelectiveRecursion` / `instances_state_selective_recursion` — `useSupportedFeatures.tsx:50`; `context/useInstances.tsx`. Perf-only; falls back to full recursion.
- `hasBulkOperations` / `bulk_operations` — `useSupportedFeatures.tsx:60`; `Events.tsx`. Event-handling optimization; falls back.
- `hasInstanceForceDelete` / `instance_force_delete` — `useSupportedFeatures.tsx:48`; `pages/instances/actions/DeleteInstanceBtn.tsx`. On incus the "force delete" affordance is suppressed. **Verify** incus honours `?force=1` on instance delete regardless — if so, prefer REPLACE with unconditional, else this is a lost affordance.
- `hasProjectDeleteOperation` / `project_delete_operation` — `useSupportedFeatures.tsx:53`; `pages/projects/actions/DeleteProjectBtn.tsx`. Falls back to sync delete.
- `hasRemoteDropSource` / `storage_remote_drop_source` — `useSupportedFeatures.tsx:54`; `pages/storage/CreateStoragePool.tsx`, `EditStoragePool.tsx`, `StoragePoolFormMain.tsx`, `StoragePoolFormCeph.tsx`, `util/storagePool.tsx`. Ceph pool "drop source" toggle hidden.
- `hasClusteringControlPlane` / `clustering_control_plane` — `useSupportedFeatures.tsx:55`; `pages/cluster/panels/ClusterMemberRolesSelector.tsx`. Extra cluster role hidden.
- `hasEntityTypeMetadata` / `metadata_configuration_entity_types` — `useSupportedFeatures.tsx:33`; `pages/permissions/panels/PermissionSelector.tsx` (already inside the gated Permissions section).
- `hasStorageVolumesAll` / `storage_volumes_all` — `useSupportedFeatures.tsx:19`; `context/useVolumes.tsx`, `loadCustomVolumes.tsx`, `loadIsoVolumes.tsx`. **REPLACE candidate:** incus provides the same "volumes across all projects" capability under **`storage_volumes_all_projects`** (confirmed present in incus source). Re-gate on the incus name to restore the feature instead of losing it.
- `hasEntitiesWithEntitlements` / `entities_with_entitlements` and `hasAccessManagementTLS` / `access_management_tls` — `context/auth.tsx:45,68,78`. Drive the fine-grained-permission path; see Category 2.
- `hasExplicitTrustToken` / `explicit_trust_token` — `useSupportedFeatures.tsx:28`. **Declared but consumed nowhere** (grep of `src` finds zero non-definition hits). Pure dead flag — delete.

---

## CATEGORY 2 — Canonical / Ubuntu integrations (the zabbly-parity work)

### 2a. UNGATED, FAILS OPEN → visibly BROKEN on incus (highest priority)

**Placement groups.** Extension `instance_placement_groups` is **absent from incus**, but the feature is **not gated at all** — no `hasPlacementGroups` flag exists. Nav item `src/components/Navigation.tsx:563` (`key="placement"`) renders unconditionally; route `src/App.tsx:304` (`/ui/project/:project/placement-groups`) is unconditional; `src/api/placement-groups.tsx:18` calls `GET 1.0/placement-groups`, which **404s on incus** → the page errors instead of degrading. Also touches `components/ResourceIcon.tsx`, `context/usePlacementGroups.tsx`, `pages/instances/forms/PlacementGroupSelect.tsx`, `EditInstanceDetails.tsx`, `CreateInstance.tsx`, `pages/placement-groups/*`. zabbly removed it wholesale (commit `6cf28fdc` "Remove placement groups"). **Action: remove** (or, if kept for a future incus feature, gate it — but incus has no equivalent today).

### 2b. Canonical image servers (zabbly `02fce4ad`)

`src/util/imageLegacy.ts:8-19` hardcodes `cloud-images.ubuntu.com/releases` (`canonicalServer`), `cloud-images.ubuntu.com/minimal/releases` (`minimalServer`), `images.lxd.canonical.com` (`imagesLxdServer`), plus their streams JSON URLs; `loadRemoteImagesLegacy()` fetches all three. `src/pages/images/ImageSelector.tsx:32,172-206` labels images "Ubuntu"/"Ubuntu Minimal"/"LXD Images" by matching those hosts. **On incus these servers are wrong** — incus ships the `images:` remote pointing at `images.linuxcontainers.org`. zabbly replaced all three with a single `linuxContainersServer = "https://images.linuxcontainers.org"` (`linuxContainersJson = .../streams/v1/images.json`) and relabels to "Linux Containers". **Action: replace** per zabbly diff. Also update the hardcoded defaults in `pages/images/panels/CreateImageRegistryPanel.tsx:62` (`https://cloud-images.ubuntu.com/daily/`) and `pages/images/ImageRegistryForm.tsx:84` (`cloud-images.ubuntu.com/releases/`).

### 2c. Version check (zabbly `4341bb6c`)

`src/components/Version.tsx` compares `server_version` major against `RECENT_MAJOR_SERVER_VERSION` (from `util/version`) and shows *"You are using an outdated server version. Update your LXD server…"*. incus versioning is unrelated (incus 6.x/7.x vs LXD 5.x/6.x) → **false "outdated" warning on incus**, plus the "LXD" wording. zabbly removed the `isOutdated` branch. **Action: replace** — drop the version-nag and the "LXD" string.

### 2d. LXD identity API + fine-grained permissions (zabbly `692f92e4` + `45804b1b`)

`src/context/auth.tsx:54-69` issues `fetchCurrentIdentity` (`GET 1.0/auth/identities/current`, LXD's access-management API) gated on `access_management_tls`; `:78` derives `isFineGrained` from `entities_with_entitlements`; `:107` builds `serverEntitlements`. All three extensions are **absent from incus** → on incus the query is disabled, `isFineGrained()` returns `false`, `serverEntitlements` is empty. It *degrades* rather than crashes, but the identity query, `authExpiresAt`, and entitlements are dead, and `src/context/useLoggedInUser.tsx` + `Navigation.tsx` still reference the identity path. zabbly explicitly stripped the identity query (`692f92e4`) and hard-forced `isFineGrained=false` / removed `serverEntitlements`,`authMethod`,`authExpiresAt` from context (`45804b1b`). **Action: guard/replace** to match zabbly — disable cleanly now; a proper incus OpenFGA port is future work.

### 2e. Branding & links (misleading "LXD"/Ubuntu strings)

- `src/components/Logo.tsx:16-21` — renders heading **"LXD"** (or "MicroCloud") and `microCloud-logo.svg`. `hasMicroCloudFlag` also drives `src/util/favicon.tsx:8` and `src/util/title.tsx:8` (browser title/favicon say MicroCloud/LXD). MicroCloud is a Canonical product with no incus meaning. **Action: rebrand** to Incus (zabbly ships an Incus logo; also see zabbly `a9eddb35` logo update) and drop the MicroCloud branch.
- `src/context/useDocs.tsx:4` — docs base `https://documentation.ubuntu.com/lxd/en/latest`. **Action: replace** with the incus docs base (`https://linuxcontainers.org/incus/docs/main` or the local `/documentation` served by incus). `hasLocalDocumentation`/`hasDocumentationObject` (`useSupportedFeatures.tsx:20-25`) are version-gated on LXD 5.19/5.20 — re-baseline for incus versions.
- `src/components/Navigation.tsx:775` — support link `https://discourse.ubuntu.com/c/lxd/126`. **Replace** with the incus forum (`https://discuss.linuxcontainers.org`).
- `src/pages/images/ImageRegistryProtocolSelector.tsx:16` — `documentation.ubuntu.com/lxd/v5/...`. **Replace.**
- `src/components/NoMatch.tsx:15` and `src/pages/login/CertificateGenerate.tsx:69` — `github.com/canonical/lxd-ui/issues` / wiki links. **Replace** with the incendio repo.
- `src/pages/storage/forms/StorageDriverSelect.tsx:44` — copy references `microcloud`/`microceph`. **Reword** for incus.
- `src/api/auth-permissions.tsx:17` — comment-only link to an lxd issue; cosmetic.

---

## Summary of recommended actions
- **Remove (fail-open / broken):** placement groups (ungated, 404s on incus).
- **Replace (Canonical→incus):** image servers, version check, docs base + forum/issue/logo links, MicroCloud→Incus branding, storage driver list (drop PowerFlex/PowerStore/Pure/Alletra, add Linstor/TrueNAS), `storage_volumes_all`→`storage_volumes_all_projects`, LXD identity API + fine-grained perms (disable à la zabbly).
- **Remove or leave-gated (fail-closed dead weight):** replicators, cluster links, load-balancer pools + health checks, managed SSH keys, backup-metadata-version, boot-mode, import/conversion, the four LXD storage-driver forms.
- **Delete unused flag:** `hasExplicitTrustToken`.
- **No action (correct degradation):** the async-operation / recursion / bulk perf toggles in §1c.
