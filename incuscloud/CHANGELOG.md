## 0.1.0
First release: one sign-in, one API endpoint and one console in front of many Incus clusters.

> Needs Incus 6.0 LTS or later with OIDC and OpenFGA; tested with Incus 7.5. Install with Docker Compose or Helm.

- **One console over every cluster:** an inventory of clusters, members, projects, networks and storage, with Incendio's pages for each object, global instance search, capacity and warnings
- **Sign-in:** users, groups and service accounts; the `incus` CLI signs in with the device flow; OpenID Connect providers, with their groups mapped onto IncusCloud groups
- **Gateway:** every cluster reachable through IncusCloud, always as the caller (`https://<cluster>.<domain>` for API clients, `/clusters/<cluster>/ui/` in the browser), with a request log
- **Tenants:** restricted Incus projects on the clusters they are placed on, one quota across clusters, self-service instance creation with placement, usage
- **Permissions:** privileges, roles and paths resolved as in Proxmox, on the platform, clusters, groups, tenants, projects, instances and Kubernetes clusters; granted in each cluster's OpenFGA store too, so Incus enforces them as well
- **Leases:** a per-tenant time to live for instances, with extensions; an ended lease stops or deletes the instance
- **Mobility:** moves and copies between clusters, cold or live, with a pre-flight check; replication with failover
- **Backups:** S3 targets, schedules with retention, restore to any cluster
- **Balancing:** per-cluster rules, member maintenance (evacuate and restore), suggestions across clusters
- **Kubernetes:** clusters on any enrolled Incus cluster through one Cluster API install, with MetalLB for `LoadBalancer` services
- **Audit log** of every change

### Known issues
- Incus 7.3 to 7.5 drop a VM's boot record on a live move into a restricted project, so a VM with several vCPUs crashes on restore ([lxc/incus#4244](https://github.com/lxc/incus/issues/4244)). The pre-flight refuses such moves. To be fixed in Incus 7.6.
- Incus's own S3 backup upload has no region setting ([lxc/incus#4245](https://github.com/lxc/incus/issues/4245)). Backups to stores whose region Incus doesn't sign for go through IncusCloud instead. To be fixed in Incus 7.6.
- Kubernetes workers need `br_netfilter` loaded on the Incus members.
