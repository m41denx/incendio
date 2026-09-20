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
- Read-only `instance_access`/`project_access` panels: NOT built — deferred to Phase 2 (no upstream to port; low priority given cert page covers trust management).

## Done — LB, lint, smoke
- **zabbly LB view `405316ea` dropped** — never cherry-picked; 0.22's native network-load-balancer (CreateLoadBalancer/EditLoadBalancer/LoadBalancersTab/NetworkList) is in place and compiles.
- **Lint pass** `3a35fe3594` — `yarn lint-js` exit 0 (fixed ~252 issues: prettier/import-type auto-fixes + manual dedup-imports/unused-vars; wired up `InstancePreview` error handling that was an incomplete port).

## Smoke test — live Incus 7.4 (2026-09-20)
Daemon reachable via `sudo incus query` (unix socket); 553 api_extensions. Production `yarn build` → exit 0 (5.6M).
- Core endpoints respond: `/1.0/instances` `/1.0/projects` `/1.0/storage-pools` `/1.0/networks` `/1.0/profiles` `/1.0/certificates` `/1.0/cluster`.
- LXD-only `/1.0/auth/identities` + `/1.0/auth/groups` → **404 (not found)** — confirms gating is correct.
- Gate extensions on live server: `access_management`=False (perms UI hidden ✓), `instance_placement_groups`=False (placement gated ✓), `storage_driver_linstor`=True (driver list ✓), `instances_state`=False (confirms dropping old state-metrics commit was right).
- Not deployed to `/opt/incus/ui` (would overwrite the installed system UI — left for the user to decide). Browser render-test not performed (headless env).

## Phase 2 candidates (reassess with user before starting — per decision)
- Read-only `instance_access`/`project_access` entitlement panels.
- Gate `/ui/permissions/*` routes behind `hasAccessManagement` (nav already hidden; blocks manual URL entry only).
- Incus-only api_extension features (187 incus-only extensions) — new UI surface (placement scriptlets, LINSTOR/TrueNAS pool options, etc.).
- Optional cleanup: unused `util/searchAndFilter` helpers / InstanceSearchFilter param constants left after server-side filtering.
