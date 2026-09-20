# Incus port — progress log

Rebase-port of zabbly's Incus commits onto lxd-ui `0.22` (branch `incus-port`).
Approach: cherry-pick with `-x` (preserve authorship); extract only the Incus-critical
delta when a commit is superseded by 0.22; gate (don't delete) dead LXD features; defer
commits whose dependencies aren't yet ported. `tsc` is clean at HEAD; unit tests have only
the 14 pre-existing `loginProject.spec` failures (Node 26 + jsdom localStorage quirk, present
on the clean 0.22 base — not a regression).

**Status:** ~70 commits on branch, 59 zabbly commits cherry-picked + several `fix(port)` / Incendio commits.

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

## Deferred — need focused work
| Commit(s) | Why deferred |
|---|---|
| `c633f59e` user properties | Big feature; needs type adaptation (UserPropertiesForm module path, EditInstanceFormValues, nameEditable, userProperties form field) |
| `b069024684`+`53bd336367`+`c344855342` server-side filtering | Adds `ip-address` dep; large InstanceList/InstanceSearchFilter rework |
| `191e471466`+`808853ae70`+`820872e709` volume target/project | `showClusterMember`/`getFormProps` + project-scoped pools; entangled cluster |
| `19b50960` column reorder | `useIsClustered` + column-object typing rework |
| `40727871` add-devices fix | Assumes `configs.devices[id]` metadata shape 0.22 lacks |
| `e7ecc4b0` hide-if-no-default-project | Tangled with IncusOS + `isAdmin()` — port after IncusOS |
| `9dadd779` authMethod init | Superseded by 0.22; revisit with access area |
| `ef27c110` journald decode | Touches IncusOS `OSLogs` — port after IncusOS |
| `c1eef038` snapshot count | Superseded by the applied `e21923904` (columns removed) — effectively dropped |

## Re-port needed (parallel workflow used a wrong base = main, not incus-port)
Branches `port/incusos`, `port/image-servers`, `port/usage-page` exist but were built on `main`
(cff017fee1), so their diffs don't apply to the 0.22-based `incus-port`. Their **notes are good
guidance**. Re-port onto incus-port:
- **IncusOS** (`e5e5b29283`+`78a193b81e`) — new `src/pages/os/*`; anchor merges in App/Navigation/queryKeys/styles; surgical fixups: `YamlFormValues` export, `isIncusOS` typing, `fetchOSService` returns `{state,config}`.
- **Custom image servers** (`d7fda021`) — `IMAGE_SERVERS_KEY = "user.ui.image_servers"`; re-add `isImageServers` to SettingForm; keep Incendio default servers, layer user-server override.
- **Project Usage page** (`470319f8`) — new usage components; anchor merges.

## Still to do (Phase 1 completion)
- **Access area** (per decision — Incus has no perms API): disable LXD identity/fine-grained
  (`692f92e4`, `45804b1b`, `8116826a` OIDC logout) + build **Trusted Certificates** page
  (`/1.0/certificates`) + read-only `instance_access`/`project_access` panels. See memory `incus-auth-model`.
- **Drop** `405316ea` (zabbly LB view) — adopt 0.22's native network-load-balancer; verify vs Incus.
- **Lint pass**: `yarn lint-js` cleanup (unused imports / prettier from ported code) before "done".
- Smoke-test against local Incus 7.4 (`incus admin init` first).
