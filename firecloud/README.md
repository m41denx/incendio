# Firecloud

Firecloud sets up an [Incus](https://linuxcontainers.org/incus/) cluster
across machines in minutes: Incus clustering, OVN networking through
MicroOVN, optional shared storage (MicroCeph, TrueNAS or clustered LVM) and
the [Incendio](../README.md) web UI. Afterwards its daemon keeps the OVN, Ceph
and clustered-LVM settings Incus needs in step as machines come and go.

Firecloud is a fork of [MicroCloud](https://github.com/canonical/microcloud)
3.3, ported from LXD to Incus and packaged as a `.deb` instead of a snap.

## Install

On every machine (Debian 13, Ubuntu 24.04 or newer):

```sh
sudo apt install ./firecloud_<version>_<arch>.deb   # from the GitHub release
sudo firecloud install --ceph                        # see the options below
```

`firecloud install` prepares the machine:

| Option | Installs |
|---|---|
| (always) | Incus from the [Zabbly](https://github.com/zabbly/incus) stable repository |
| (default) | MicroOVN (`--ovn-channel`, default `26.03/stable`); `--no-ovn` to skip |
| `--ceph` | MicroCeph (`--ceph-channel`, default `tentacle/stable`) and `ceph-common` |
| `--truenas` | `open-iscsi` and `truenas_incus_ctl` for TrueNAS pools |
| `--lvmcluster` | `lvm2`, `lvm2-lockd` and `sanlock` for clustered LVM, with `lvmlockd` enabled |
| (default) | the latest Incendio UI in `/opt/incus/ui`; `--no-ui` to skip |

Firecloud only builds new clusters: `install` refuses an Incus that already
has storage pools or managed networks.

## Set up the cluster

```sh
sudo firecloud init     # on one machine
sudo firecloud join     # on each of the others, at the same time
```

The wizard finds the other machines on the local network, and asks about:

- **Local storage:** a ZFS pool per machine, on a whole disk, a free
  partition, or a loop file when a machine has no spare disk.
- **Distributed storage (Ceph):** whole disks, free partitions or loop files
  (`loop,<size>,1` in MicroCeph), plus optional CephFS.
- **Shared storage without Ceph:** a TrueNAS server (host, API key, dataset)
  or a disk every machine sees (iSCSI, FC or NVMe-oF LUN) with clustered
  LVM. Only the drivers Incus supports on every machine are offered.
- **Networking:** an OVN uplink and network, or a Fan bridge without OVN.
- **Incendio login:** a single-use trust token to enter on the UI's login
  page.
- **OpenFGA (optional):** connect Incus to an existing OpenFGA server and
  route OIDC users to it. Trusted TLS certificates keep full access.

`firecloud preseed` takes the same answers from a YAML file (TrueNAS, clustered
LVM and OpenFGA are interactive only for now).

## Keeping settings in sync

Incus from the Zabbly packages does not read MicroOVN's and MicroCeph's
settings itself the way the LXD snap does. The Firecloud daemon on every
member does it, every minute and when members join or leave:

- `network.ovn.northbound_connection`, `network.ovn.ca_cert`,
  `network.ovn.client_cert` and `network.ovn.client_key` from MicroOVN
  (`ovn.env` and its certificates), written by one member;
  `network.ovs.connection` on every member.
- MicroCeph's `ceph.conf` and admin keyring in `/etc/ceph`.
- For clustered LVM: `use_lvmlockd`, the member's sanlock `host_id`
  (recorded in `user.firecloud.lvm_host_ids`, never reused) and the
  `lvmlockd`/`sanlock` services.

`firecloud status` shows each member's last sync and any errors.

## Other commands

- `firecloud add`, `firecloud remove`: grow or shrink the cluster.
- `firecloud ui update [--tag 0.22-pN]`: install an Incendio release on
  every member.
- `firecloud status`, `firecloud cluster list`, `firecloud service list`.

## Building

```sh
packaging/build-deb.sh 0.1.0 dist/   # needs Go, autotools, libuv/lz4/sqlite3 headers
```

The package ships its own dqlite in `/usr/lib/firecloud`. Releases are cut by
pushing a `firecloud-v<version>` tag (`.github/workflows/firecloud.yaml`).

## License

Firecloud is licensed under the GNU Affero General Public License version 3
(see [COPYING](COPYING)), like MicroCloud, MicroOVN, MicroCeph and microcluster
it builds on. This folder is a separate program from the rest of the
repository; nothing outside it imports Firecloud code, so the AGPL does not
extend to Incendio's UI, SDK or Kubernetes agent.
