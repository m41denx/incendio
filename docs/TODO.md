# TODO

Open work for Incendio and Firecloud. Tick items off here when they ship and
note the release.

## Incus 7.5

Release notes: https://discuss.linuxcontainers.org/t/incus-7-5-has-been-released/27273

Gate every item on its API extension so 7.4 servers keep working.

### Worth adding

Done on `incus-port`, not yet released.

- [x] **Security tags** (`instance_security_tags`): `security.tags` field in the
  instance and profile Security policies section (comma-separated). Incus does
  not use the tags itself; each tag becomes a `security_tag` OpenFGA object
  with a `tag` relation to every instance carrying it. Tags have no grantable
  relations, so the Permissions grant dialog already leaves them out.
- [x] **OIDC claims in the authorization scriptlet**
  (`authorization_scriptlet_claims`): the scriptlet's `details` now has
  `Claims` (validated OIDC token claims, empty for other clients), so
  `authorization.client.oidc=scriptlet` is a real alternative to OpenFGA.
  Say so on the Permissions setup page, with an example scriptlet. Same
  wording in Firecloud's OpenFGA question.
- [x] **Bridge `dns.include_hosts`** (`network_bridge_dns_include_hosts`):
  toggle under the bridge DNS settings (dnsmasq serving `/etc/hosts`).
- [x] **Disk `initial.copy`** (`disk_initial_copy`): toggle on custom-volume
  disk devices for containers. On first use, the container's existing files at
  the mount path are copied into the volume (`volatile.initial.copied` records
  it).
- [x] **GPU `nvidia.clique`** (`gpu_physical_clique`): 0–15 field on physical
  GPU devices, advertises NVIDIA GPUDirect P2P to the guest.

### Worth considering

- [ ] **Live move to another project** (`instance_project_move_live`): a
  running instance can change project and cluster member in one live
  migration. The migrate dialog handles live and project moves separately
  today; combine them when the extension is present.
- [ ] **OVN child networks** (`network_ovn_parent`): optional parent OVN
  network when creating an OVN network (shared logical router, own subnets).
  `NetworkParentSelector` only serves physical, macvlan and SR-IOV, so OVN
  needs its own picker.
- [ ] **OCI image labels**: `org.opencontainers.image.*` labels are now
  `oci.*` image properties; show them on the image details.

### Nothing to do in the UI

- Cluster member metrics in `/1.0/metrics` (`metrics_cluster_members`), only
  relevant if a metrics page is added.
- `incus file push/pull --archive`, Windows/NetBSD/FreeBSD agent work,
  `/internal/debug/pprof/` (`internal_debug_pprof`).
- OCI image environment is no longer copied into instance config; nothing in
  the UI reads it.
- 11 security fixes: upgrade servers to 7.5.

### Upgrade warning

When OpenFGA is configured, the first 7.5 start runs the
`auth_openfga_security_tags` patch, which writes the new model to OpenFGA. If
OpenFGA is unreachable, incusd exits ("Failed applying patch") and systemd
keeps restarting it until OpenFGA is back. Make sure OpenFGA is up before
upgrading. To drop OpenFGA while the daemon is down, put
`DELETE FROM config WHERE key LIKE 'authorization.openfga.%';` in
`/var/lib/incus/database/patch.global.sql` and restart Incus.

## Firecloud

- [ ] Live test on real machines or VMs (needs KVM/ZFS; the dev box has
  neither): install, init/join, OVN sync, Ceph with loop files, TrueNAS,
  clustered LVM, OpenFGA step, UI update.
- [ ] First package release: push `firecloud-v0.1.0` after the live test.
- [ ] Preseed support for TrueNAS, clustered LVM and OpenFGA (interactive
  only today).

## Other

- [ ] Backup/PBS feature: on hold while pbs-plus is evaluated.
