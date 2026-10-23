# Known issues

Bugs found while testing IncusCloud on real hardware (2026-10-23, Incus 7.5.1 on Ubuntu 24.04
members, ZFS pools). Open ones first; the fixed ones are kept as a record.

## Open: in Incus

### A restricted project drops a VM's boot record on a live migration in

**Affects:** live moves into any tenant's project (every tenant project is restricted).

Since Incus 7.3 (the fix for CVE-2026-62940, lxc/incus#3750: "Enforce project restrictions on
migration overrides"), a migration into a restricted project without
`restricted.virtual-machines.lowlevel=allow` refuses the VM's `volatile.vm.boot_state`. Incus writes
that key itself; it is not a user override. On the target Incus then restores QEMU with the default
one-vCPU layout:

- A VM with more than one vCPU crashes on restore: `get_pci_config_device: Bad config data ...
  error while loading state for instance 0x0 of device '0000:00:01.1:00.0/virtio-scsi'`
  (virtio-scsi has a queue per vCPU). The source keeps running.
- A VM with one vCPU moves, but without the record; the next live move fails on the source with
  "Live migration requires migration.stateful to be set to true" until the VM is restarted.
- Setting the key by hand fails too: `Changing "volatile.vm.boot_state" ... is forbidden`.

**Reproduce** with plain Incus, between two servers:

```bash
incus project create t -c restricted=true -c features.images=false -c features.profiles=false
incus launch images:ubuntu/24.04 v --vm --project t -c migration.stateful=true -c limits.cpu=2
incus move v other:v --project t --target-project t --mode push    # QEMU crashes on restore
```

With `-c limits.cpu=1` the move works and `incus config get v volatile.vm.boot_state` on the target
shows `"version":-1,"machine_type":""`. With `restricted.virtual-machines.lowlevel=allow` on the
target project both work.

**Workaround:** IncusCloud's pre-flight refuses a live move of a multi-vCPU VM into a restricted
project and warns for one vCPU (`mobility/preflight.ts`, `dropsBootState`). Allowing low-level options
for tenants is not an option: it lets them set `raw.qemu`.

**Fix (upstream):** exempt Incus's own `volatile.*` keys, at least `volatile.vm.boot_state`, from the
restriction check on migration. To report to lxc/incus.

### Incus's own S3 backup upload has no region

**Affects:** direct backup uploads (`backup_s3_upload`) to S3 stores outside `us-east-1`.

`api.BackupTarget` has no region field, and Incus signs its uploads for `us-east-1`. A store in
another region refuses them: Garage answers `AuthorizationHeaderMalformed: ... unexpected scope:
20261023/us-east-1/s3/aws4_request`.

**Workaround:** IncusCloud relays backups to such targets through itself and refuses a forced direct
upload with the reason (`backups/backup-job.ts`).

**Fix (upstream):** a `region` field on `api.BackupTarget`. To request from lxc/incus.

## Fixed in IncusCloud

| Commit | Bug |
| --- | --- |
| `0f76873c43` | Moves dropped the instance's volatile keys (UUID, MACs, vsock id): live restores failed. A move also re-owned the instance to the mover. |
| `83e5b8eb50` | After a live move the source still runs; the job deleted it without stopping it, Incus refused, and the VM ran on both clusters. |
| `198e089c29`, `0a1a1d85cf` | Pre-flight for the Incus issue above. |
| `2dbb74710e` | Backups to a target outside `us-east-1` first made a doomed direct upload. |
| `5a8c42f5fc` | Stopping an instance already stopped (someone stopped it meanwhile) failed moves, leases, replication and restores. |
| `2f7580bb39` | Kubernetes: `kubeadm init` failed SystemVerification in container nodes on hosts without `/proc/config.gz` (most distribution kernels). New ClusterClass `incuscloud-v2`. |
| `040d8ff1a2` | Kubernetes: on ZFS pools the kubelet never started (cAdvisor finds no filesystem for a dataset root). |
| `dd7b5a9fc3` | Docs: a missing `br_netfilter` stops workers from joining (the forward's reply isn't un-NATed) and crash-loops flannel. |
