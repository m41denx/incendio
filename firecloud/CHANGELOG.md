## 0.1.0
First release: a fork of MicroCloud 3.3 for Incus, packaged as a .deb.

- **Incus instead of LXD:** Incus's Go client and API; Incus from the Zabbly stable repository; a single-use Incus trust token for the Incendio UI login instead of LXD's UI link
- **`firecloud install`:** Incus, MicroOVN (26.03/stable), and optionally MicroCeph (tentacle/stable) with ceph-common, the TrueNAS tools, the clustered LVM tools, and the Incendio UI
- **Storage without dedicated disks:** free partitions and loop files for local storage and Ceph
- **Shared storage without Ceph:** TrueNAS or clustered LVM on a shared disk
- **Settings kept in sync:** MicroOVN's connection and certificates in Incus, MicroCeph's configuration in /etc/ceph, sanlock host IDs and lvmlockd for clustered LVM; shown in `firecloud status`
- **OpenFGA during init:** connect Incus to an existing OpenFGA server and route OIDC users to it
- **`firecloud ui update`:** install an Incendio release on every member
- **Removed from MicroCloud:** the snap packaging and the remote cluster manager
