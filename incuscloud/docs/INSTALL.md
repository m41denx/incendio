# Installing IncusCloud

> The documentation site in [`../site`](../site) covers the same ground in more depth: requirements, certificates, each install method step by step, first steps, operations and troubleshooting.

IncusCloud is a control plane in front of many [Incus](https://linuxcontainers.org/incus/) clusters. It gives them one sign-in, one UI and one API endpoint per cluster, with tenants, permissions, quotas, backups, migration, balancing and Kubernetes.

This guide installs it in one of two ways, then enrols the first cluster:

- **[Docker Compose](#1-docker-compose)**: one host. This is the simplest way, and enough for most installs.
- **[Kubernetes (Helm)](#2-kubernetes-helm)**: a chart that bundles Hydra and OpenFGA, with an optional Postgres.

Either way, read [Before you start](#before-you-start) first: DNS, certificates and the network paths are the same for both, and they are what most failed installs get wrong.

**Status: beta.** See [Known limits](#known-limits) before you put untrusted tenants on it.

---

## Contents

- [What gets installed](#what-gets-installed)
- [Before you start](#before-you-start)
  - [Requirements](#requirements)
  - [Names and DNS](#names-and-dns)
  - [Network](#network)
  - [Certificates](#certificates)
- [1. Docker Compose](#1-docker-compose)
- [2. Kubernetes (Helm)](#2-kubernetes-helm)
- [3. First sign-in](#3-first-sign-in)
- [4. Enrolling clusters](#4-enrolling-clusters)
- [5. Using a cluster through IncusCloud](#5-using-a-cluster-through-incuscloud)
- [6. Optional: Kubernetes clusters for tenants](#6-optional-kubernetes-clusters-for-tenants)
- [7. Optional: backups](#7-optional-backups)
- [Settings reference](#settings-reference)
- [Backing up IncusCloud](#backing-up-incuscloud)
- [Upgrading](#upgrading)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)

---

## What gets installed

| Component | What it does | Who talks to it |
| --- | --- | --- |
| **IncusCloud** | The platform UI, the REST API, sign-in pages, the gateway to each cluster's API, Incendio (each cluster's UI), and the workers: reconciler, inventory, jobs, backups, balancing and Kubernetes. One process, one HTTPS port. | Browsers, `incus` clients, and the Incus clusters (to sign users in). |
| **Ory Hydra** | Issues the OAuth2/OIDC tokens that both IncusCloud and the Incus clusters accept. Its public endpoints are served on IncusCloud's own origin, so Hydra itself is never exposed. | IncusCloud only. |
| **OpenFGA** | Holds each cluster's grants. Every Incus cluster checks permissions against its own store. | IncusCloud **and every Incus cluster**. |
| **Postgres** | Three databases: `incuscloud`, `hydra` and `openfga`. | IncusCloud, Hydra and OpenFGA. |

Nothing is installed on the Incus clusters. IncusCloud configures them over their API: OIDC, OpenFGA, and a restricted project per tenant.

```
             browsers, incus CLI, Terraform
                         │ 443
                         ▼
 ┌────────────────── IncusCloud ───────────────────┐
 │  https://cloud.example.com         UI, API, sign-in │
 │  https://<cluster>.clusters.example.com  cluster APIs │
 └───┬───────────┬──────────────┬──────────────────┘
     │ internal  │ internal     │ 8443 (each cluster's API)
     ▼           ▼              ▼
   Hydra      OpenFGA ◄──────  Incus clusters ──► https://cloud.example.com (OIDC)
     │           │     8080
     └─ Postgres ┘
```

---

## Before you start

### Requirements

- **Incus clusters**, or standalone servers, with OIDC and OpenFGA support (Incus 6.0 LTS or later). IncusCloud is tested with Incus 7.5. Each needs:
  - its API (`core.https_address`, usually `:8443`) reachable from IncusCloud;
  - nothing else set beforehand. IncusCloud sets `oidc.*` and `authorization.*` itself when it enrols the cluster. It replaces any OIDC or OpenFGA settings already there.
- **A host for IncusCloud**:
  - Docker Compose: Linux, Docker 24 or later with the Compose plugin, `openssl`, 2 CPUs, 4 GiB of memory and 20 GiB of disk.
  - Helm: Kubernetes 1.27 or later, a `LoadBalancer` implementation (MetalLB, a cloud load balancer) or TLS passthrough, and a storage class if you use the bundled Postgres.
  - Do not run it on an Incus server you also enrol. A control plane that runs on what it manages goes down with it.
- **Two DNS names** and **a certificate** for them, described next.
- The image, `ghcr.io/m41denx/incuscloud`, is built for linux/amd64 and linux/arm64.

### Names and DNS

IncusCloud needs a name for itself and a wildcard for the clusters:

| Name | Example | Points at | Used for |
| --- | --- | --- | --- |
| Public host | `cloud.example.com` | IncusCloud | The UI, the API, and sign-in (it is also the OIDC issuer the clusters trust). |
| Cluster domain | `*.clusters.example.com` | IncusCloud (the same address) | Each enrolled cluster's API through the gateway: cluster `prod` is `https://prod.clusters.example.com`. |

Create both records (`A`/`AAAA`, or `CNAME`) before you install. The examples in this guide use these names: replace them with your own.

**The public host is permanent.** It is the OIDC issuer written into every cluster and into every token. Changing it later means re-enrolling the clusters and signing everyone in again.

### Network

| From | To | Port | Why |
| --- | --- | --- | --- |
| Users (browsers, `incus`) | IncusCloud | 443/tcp | UI, API, sign-in, cluster APIs |
| IncusCloud | every cluster member | 8443/tcp (each cluster's `core.https_address`) | Enrolment, reconciling, inventory, the gateway |
| **Every cluster member** | IncusCloud | 443/tcp | OIDC discovery and keys: Incus verifies tokens against the issuer |
| **Every cluster member** | OpenFGA | 8080/tcp | Permission checks. Incus connects to OpenFGA itself |
| IncusCloud | the management cluster's API | 6443/tcp | Only with [Kubernetes](#6-optional-kubernetes-clusters-for-tenants) |
| IncusCloud | S3 endpoints | 443/tcp | Only with [backups](#7-optional-backups) |

The two paths *from* the clusters are the ones people forget. If a cluster cannot reach the public host, sign-in to that cluster fails. If it cannot reach OpenFGA, every request to it is refused.

**Firewall OpenFGA to the cluster networks and IncusCloud.** Its token is written to every cluster, so anyone who can reach it with that token can read and change grants (see [Known limits](#known-limits)).

### Certificates

IncusCloud terminates TLS itself, for the public host and for `*.<cluster domain>`. Put it behind a load balancer or a TLS-passthrough ingress, never behind something that terminates TLS. One certificate has to cover both names:

```
DNS: cloud.example.com, *.clusters.example.com
```

Choose one of two options:

**A. A publicly trusted certificate (recommended).** Browsers, `incus` clients and the clusters trust it with nothing more to do. A wildcard needs a DNS-01 challenge with Let's Encrypt. For example, with certbot and a DNS plugin for your provider:

```sh
certbot certonly --dns-cloudflare --dns-cloudflare-credentials ~/.cloudflare.ini \
  -d cloud.example.com -d '*.clusters.example.com'
# → /etc/letsencrypt/live/cloud.example.com/fullchain.pem and privkey.pem
```

Use `fullchain.pem`, not `cert.pem`: the clusters need the intermediate certificate. Renewals need IncusCloud restarted, or the new files copied in (see the method's section).

**B. The internal CA (simplest; good for labs and private networks).** Both install methods make a CA and sign a certificate with it when you don't give one. Then everything that connects must trust that CA (`ca.crt`):

- **Every Incus cluster member.** This step is required: Incus fetches the OIDC keys from the public host over TLS with the system's trust store. On each member (Debian or Ubuntu):
  ```sh
  sudo cp ca.crt /usr/local/share/ca-certificates/incuscloud.crt
  sudo update-ca-certificates
  sudo systemctl restart incus    # Incus reads the trust store when it starts
  ```
  On Fedora, RHEL or Alpine, use `/etc/pki/ca-trust/source/anchors/` with `update-ca-trust`, or `/usr/local/share/ca-certificates/` with `update-ca-certificates`.
- **Users' machines.** Browsers need the CA imported. The `incus` CLI uses the system store (Linux, macOS) or `SSL_CERT_FILE`.

Hydra always uses a certificate from the internal CA. Only IncusCloud talks to Hydra, so that one is never seen outside.

---

## 1. Docker Compose

### 1.1 Get the bundle

From a release (replace `0.1.0` with the version):

```sh
curl -fsSLO https://github.com/m41denx/incendio/releases/download/incuscloud-v0.1.0/incuscloud-compose-0.1.0.tar.gz
tar xzf incuscloud-compose-0.1.0.tar.gz && cd incuscloud-compose-0.1.0
```

Or from the repository: `git clone https://github.com/m41denx/incendio && cd incendio/incuscloud/deploy/compose`. To build the image from source instead of pulling it, see [1.6](#16-building-the-image-from-source).

The bundle contains:

| File | What it is |
| --- | --- |
| `docker-compose.yml` | Postgres, Hydra (and its migration), OpenFGA (and its migration), IncusCloud |
| `setup.sh` | Writes `.env` and `incuscloud.env` with fresh secrets, and makes the certificates |
| `hydra.yml` | Hydra's settings that IncusCloud relies on: JWT access tokens, the claims, TLS |
| `postgres-init.sh` | Creates the three databases and their owners on first start |
| `management/` | RBAC and a kubeconfig script for [Kubernetes](#6-optional-kubernetes-clusters-for-tenants) |

### 1.2 Run setup

Run it as the user who will own the install. Docker runs the containers as that user, so they can read the keys in `./certs`.

```sh
./setup.sh --host cloud.example.com \
           --cluster-domain clusters.example.com \
           --admin admin@example.com \
           --openfga-host 10.0.0.5
```

- `--host` is the public host and `--cluster-domain` the domain for the cluster APIs (see [Names and DNS](#names-and-dns)).
- `--admin` is the first platform administrator's email.
- `--openfga-host` is the address **the Incus clusters** use to reach this host's port 8080. It defaults to `--host`. Give a private address when the clusters reach this host on a private network.

It writes:

- `.env`: Compose's settings. These are the database passwords, Hydra's secret, OpenFGA's key, the image, and the addresses ports are published on (`IC_BIND`, `OPENFGA_BIND`).
- `incuscloud.env`: IncusCloud's own settings. These include `IC_SECRET_KEY` and the first admin's password (`IC_BOOTSTRAP_ADMIN_PASSWORD`). See the [Settings reference](#settings-reference) for everything you can add there.
- `certs/`: `ca.crt` and `ca.key` (the internal CA), `hydra.crt` and `hydra.key`, and `public/tls.crt` and `tls.key` for IncusCloud.

All are readable by you only. Running it again keeps whatever already exists, so it never rotates a secret by surprise.

**Back up `incuscloud.env` now.** `IC_SECRET_KEY` seals the client keys IncusCloud uses for each cluster. If you lose it, you lose every enrolled cluster.

### 1.3 Your own certificate (option A)

Replace the generated certificate before the first start, or at any time after it, and then restart:

```sh
cp /etc/letsencrypt/live/cloud.example.com/fullchain.pem certs/public/tls.crt
cp /etc/letsencrypt/live/cloud.example.com/privkey.pem   certs/public/tls.key
chmod 600 certs/public/tls.key
docker compose restart incuscloud
```

For renewals, a certbot deploy hook does the same: copy both files, then run `docker compose -f /path/to/docker-compose.yml restart incuscloud`.

### 1.4 Start

```sh
docker compose up -d
docker compose ps        # hydra-migrate and openfga-migrate exit 0; the rest are running
docker compose logs -f incuscloud
```

Wait for `"msg":"listening"`. On the first start, the log also shows `bootstrap admin ready`.

Check it from the host:

```sh
curl --cacert certs/ca.crt https://cloud.example.com/.well-known/openid-configuration
# → {"issuer":"https://cloud.example.com/", ...}
```

Drop `--cacert` with a public certificate. The issuer must be exactly `https://<public host>/`.

### 1.5 Ports and addresses

Compose publishes two ports:

- `443` (IncusCloud), on `IC_BIND`;
- `8080` (OpenFGA), on `OPENFGA_BIND`.

Both default to every address. On a host with a public and a private interface, set `OPENFGA_BIND` to the private address the clusters use, then run `docker compose up -d` again. Hydra and Postgres are never published.

To put IncusCloud behind an existing load balancer on the same host, publish 443 elsewhere (edit `ports` under `incuscloud`). Then forward TCP with TLS passthrough (HAProxy `mode tcp`, nginx `stream`). Don't terminate TLS there.

### 1.6 Building the image from source

From `incuscloud/deploy/compose` in a clone of the repository:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Or build only the image, from the repository root:

```sh
docker build -f incuscloud/Dockerfile --build-arg GIT_HASH=$(git rev-parse --short HEAD) -t incuscloud:local .
```

The build takes a few minutes. The image is about 360 MB.

---

## 2. Kubernetes (Helm)

The chart `incuscloud/deploy/helm/incuscloud`, also published as `oci://ghcr.io/m41denx/charts/incuscloud`, installs:

- IncusCloud, with one replica;
- Hydra;
- OpenFGA;
- optionally a single-instance Postgres for the three databases.

It generates and keeps the secrets and an internal CA. All of them survive `helm upgrade`, and they stay even after `helm uninstall`.

### 2.1 Values

Make a `values.yaml`. Only these four are required:

```yaml
publicHost: cloud.example.com
clusterDomain: clusters.example.com
admin:
  email: admin@example.com
openfga:
  # How the Incus clusters reach OpenFGA: the address of the OpenFGA service (below).
  clusterUrl: http://10.0.0.21:8080
```

Common additions:

```yaml
# Option A: a certificate from cert-manager (or any kubernetes.io/tls secret) covering both names.
tls:
  existingSecret: incuscloud-tls

service:
  type: LoadBalancer
  loadBalancerIP: 10.0.0.20          # where cloud.example.com and *.clusters.example.com point

openfga:
  clusterUrl: http://10.0.0.21:8080
  service:
    type: LoadBalancer
    loadBalancerIP: 10.0.0.21
    loadBalancerSourceRanges: [10.0.0.0/16]   # the cluster networks and IncusCloud

# Your own Postgres instead of the bundled one: a secret with incuscloud-url, hydra-dsn and openfga-uri.
postgres:
  enabled: false
externalDatabase:
  existingSecret: incuscloud-db

# Kubernetes for tenants: a secret with the management cluster's kubeconfig (key "kubeconfig").
kubernetes:
  kubeconfigSecret: incuscloud-mgmt
```

The full list, with comments, is in [`values.yaml`](../deploy/helm/incuscloud/values.yaml).

A cert-manager certificate for option A:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: { name: incuscloud-tls, namespace: incuscloud }
spec:
  secretName: incuscloud-tls
  dnsNames: [cloud.example.com, "*.clusters.example.com"]
  issuerRef: { kind: ClusterIssuer, name: letsencrypt-dns }   # a DNS-01 issuer: wildcards need it
```

With your own Postgres, create the three databases, then the secret:

```sh
kubectl -n incuscloud create secret generic incuscloud-db \
  --from-literal=incuscloud-url='postgres://incuscloud:…@db.example.com:5432/incuscloud' \
  --from-literal=hydra-dsn='postgres://hydra:…@db.example.com:5432/hydra?sslmode=require' \
  --from-literal=openfga-uri='postgres://openfga:…@db.example.com:5432/openfga?sslmode=require'
```

### 2.2 Install

```sh
kubectl create namespace incuscloud
helm install incuscloud oci://ghcr.io/m41denx/charts/incuscloud --version 0.1.0 -n incuscloud -f values.yaml
# or, from a clone: helm install incuscloud incuscloud/deploy/helm/incuscloud -n incuscloud -f values.yaml
kubectl -n incuscloud get pods -w
```

The notes the install prints tell you what to do next:

1. Point both DNS names at the `incuscloud` service's external address.
2. Read the admin password:
   ```sh
   kubectl -n incuscloud get secret incuscloud -o jsonpath='{.data.admin-password}' | base64 -d; echo
   ```
3. With the internal CA (option B), export it, then trust it on every cluster member as described in [Certificates](#certificates):
   ```sh
   kubectl -n incuscloud get secret incuscloud-internal-tls -o jsonpath='{.data.ca\.crt}' | base64 -d > ca.crt
   ```

**Back up the `incuscloud` secret** (its `secret-key` value). Without it, enrolled clusters are lost.

---

## 3. First sign-in

1. Open `https://cloud.example.com` and sign in with the admin email. The password is `IC_BOOTSTRAP_ADMIN_PASSWORD` in `incuscloud.env` (Compose) or the `admin-password` key (Helm).
2. Change the password: your name at the bottom of the side menu (**Profile**).
3. Optional: add people in **Users**, and give them roles in **Permissions**: Administrator, Operator, Auditor and so on.

The bootstrap settings create an administrator only while there is none. They change nothing afterwards, so they are safe to leave in place.

---

## 4. Enrolling clusters

For each Incus cluster or standalone server:

1. **On the cluster**, as an Incus administrator:
   ```sh
   incus config trust add incuscloud --quiet
   ```
   This prints a one-time trust token. It contains the cluster's addresses and certificate fingerprint.
2. **In IncusCloud**, go to **Clusters** › **Enrol cluster**. Give it a name: lowercase, which becomes `https://<name>.clusters.example.com`. Paste the token, and optionally add labels (`key=value`, used by placement). Then **Enrol**.

   IncusCloud then:
   - connects to the cluster on the token's addresses and checks its certificate against the token;
   - adds its own client certificate;
   - sets `oidc.issuer`, `oidc.client.id`, `oidc.audience` and `oidc.claim`, plus `authorization.openfga.*` with the cluster's own store;
   - reads the inventory.

   The cluster shows as ready within a reconcile interval (60 s by default).
3. **With the internal CA**, make sure every member of that cluster trusts `ca.crt` (see [Certificates](#certificates)) before anyone signs in to it.

Through the API, the same is `POST /api/v1/clusters` with `{"name": "prod", "token": "…"}`.

Then create **Tenants** and place them on clusters. Each placement makes a restricted Incus project with the tenant's quota. Add members on the tenant page.

---

## 5. Using a cluster through IncusCloud

- **Browsers.** Pick the cluster in the console's inventory tree: its Incendio pages (instances, storage, networks and so on) open inside IncusCloud. Incendio alone is at `https://cloud.example.com/clusters/<name>/ui/`. Your IncusCloud session works in both; there is no second sign-in.
- **The `incus` CLI and Terraform:**
  ```sh
  incus remote add prod https://prod.clusters.example.com --auth-type=oidc
  incus list prod:
  ```
  The CLI prints a URL and a code. Open it, sign in to IncusCloud, and it's done. Tokens refresh by themselves.
- **Service accounts** for automation are under **Service accounts**. They use the OAuth2 client-credentials flow; their permissions are set like users'.

Requests go to the cluster as you, never as IncusCloud. Each cluster also enforces your permissions itself, so your token has the same limits when used against the cluster directly.

---

## 6. Optional: Kubernetes clusters for tenants

Tenants can create Kubernetes clusters on any Incus cluster they are placed on. Nothing is installed in the Incus clusters. One [Cluster API](https://cluster-api.sigs.k8s.io/) install with the Incus provider ([CAPN](https://github.com/lxc/cluster-api-provider-incus)), in a **management cluster**, drives them all.

1. **A management cluster.** Any Kubernetes cluster works, including the one IncusCloud runs in. It must reach the Incus clusters' APIs (8443) and the workload clusters' API endpoints (`IC_K8S_PORTS`, 16443–16999 by default, on member addresses).
2. **Install Cluster API and CAPN** in it, with `clusterctl` v1.14.3:
   ```sh
   mkdir -p ~/.cluster-api && cp management/clusterctl.yaml ~/.cluster-api/clusterctl.yaml
   CLUSTER_TOPOLOGY=true EXP_CLUSTER_RESOURCE_SET=true clusterctl init \
     --core cluster-api:v1.14.3 --bootstrap kubeadm:v1.14.3 \
     --control-plane kubeadm:v1.14.3 --infrastructure incus:v0.9.1 --wait-providers
   ```
   (`management/` is in the Compose bundle and at `incuscloud/deploy/management` in the repository.)
3. **Give IncusCloud access:**
   ```sh
   kubectl apply -f management/rbac.yaml
   ./management/kubeconfig.sh > mgmt.kubeconfig && chmod 600 mgmt.kubeconfig
   # Pass the API server's URL as IncusCloud reaches it when it differs from your kubectl context's:
   #   ./management/kubeconfig.sh https://10.0.0.30:6443 > mgmt.kubeconfig
   ```
   - **Compose:** copy `mgmt.kubeconfig` to `k8s/mgmt.kubeconfig`. Uncomment `IC_K8S_KUBECONFIG=/etc/incuscloud/k8s/mgmt.kubeconfig` in `incuscloud.env`, then run `docker compose up -d`.
   - **Helm:** run
     ```sh
     kubectl -n incuscloud create secret generic incuscloud-mgmt --from-file=kubeconfig=mgmt.kubeconfig
     ```
     Then set `kubernetes.kubeconfigSecret: incuscloud-mgmt` and run `helm upgrade`.
4. **On every Incus host**, load the kernel modules the nodes need. The nodes are unprivileged containers and cannot load modules themselves:
   ```sh
   printf 'br_netfilter\noverlay\nip_vs\nnf_nat\n' | sudo tee /etc/modules-load.d/incuscloud-k8s.conf
   sudo systemctl restart systemd-modules-load
   ```

**Kubernetes** in IncusCloud's menu then lets tenants create clusters. Without a kubeconfig, it says Kubernetes is off.

---

## 7. Optional: backups

Backups go to S3-compatible storage: AWS S3, MinIO, Ceph RGW, Garage and so on.

1. Under **Backup targets** (platform operators), add a target: a name, an endpoint, a region, a bucket, an optional prefix, and an access key ID and secret key. IncusCloud stores the secret sealed with `IC_SECRET_KEY`.
2. Back up instances from their page, or set schedules with retention under **Backups**.

Restores can go to any cluster.

---

## Settings reference

IncusCloud reads `IC_*` environment variables:

- **Compose:** they live in `incuscloud.env`. Run `docker compose up -d` after changing it.
- **Helm:** the chart sets most of them. Put any other under `settings.extraEnv`.

[`server/.env.example`](../server/.env.example) lists every variable, with comments.

| Variable | Default | What it does |
| --- | --- | --- |
| `IC_PUBLIC_URL` | (required) | `https://<public host>`: where users reach IncusCloud. Hydra's issuer is this plus `/`. |
| `IC_CLUSTER_DOMAIN` | (required) | Clusters' APIs are at `https://<name>.<domain>`. |
| `IC_TLS_CERT`, `IC_TLS_KEY` | (required) | IncusCloud's certificate and key (PEM). |
| `IC_DATABASE_URL` | (required) | `postgres://…` |
| `IC_SECRET_KEY` | (required) | 32+ random bytes, base64. **Never change or lose it.** |
| `IC_HYDRA_PUBLIC_URL`, `IC_HYDRA_ADMIN_URL`, `IC_HYDRA_CA_FILE` | (set by the installers) | Hydra, as IncusCloud reaches it. |
| `IC_OPENFGA_URL`, `IC_OPENFGA_TOKEN` | (set by the installers) | OpenFGA, as IncusCloud reaches it. |
| `IC_OPENFGA_CLUSTER_URL` | `IC_OPENFGA_URL` | OpenFGA, as **the clusters** reach it. |
| `IC_OPENFGA_CLUSTER_TOKEN` | `IC_OPENFGA_TOKEN` | A separate token for the clusters (it must also be one of OpenFGA's preshared keys). |
| `IC_BOOTSTRAP_ADMIN_EMAIL`, `IC_BOOTSTRAP_ADMIN_PASSWORD` | — | The first administrator, created while there is none. The password needs 12 characters or more. |
| `IC_RECONCILE_INTERVAL` | `60` | Seconds; each cluster is reconciled at least this often, and right after any change. |
| `IC_INVENTORY_INTERVAL` | `60` | Seconds; how often the inventory and metrics are read. `0` turns them off. |
| `IC_METRICS_RETENTION` | `24` | Hours of metrics history. |
| `IC_JOB_CONCURRENCY` | `2` | Jobs (migrations, backups, replication) run at once. |
| `IC_IMAGE_SERVER`, `IC_IMAGE_SERVERS` | `https://images.linuxcontainers.org` | Where self-service creates take images from, and extra servers the image picker lists. |
| `IC_K8S_KUBECONFIG`, `IC_K8S_PORTS`, `IC_METALLB_MANIFEST_URL` | off, `16443-16999`, MetalLB v0.16.0 | [Kubernetes](#6-optional-kubernetes-clusters-for-tenants). |
| `IC_GATEWAY_SAMPLE_READS` | `0` | The share of gateway reads to log (0..1); changes are always logged. |
| `IC_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`. Logs are JSON on stdout. |
| `IC_ROLE` | `all` | `api`, `worker` or `all`. Keep `all` with one replica in this release. |

---

## Backing up IncusCloud

Back up three things:

1. **`IC_SECRET_KEY`**:
   - Compose: in `incuscloud.env`;
   - Helm: in the `incuscloud` secret.

   Without it, the database's cluster credentials and backup target secrets can't be opened.
2. **The databases.** Back up all three. For example, with Compose:
   ```sh
   for db in incuscloud hydra openfga; do
     docker compose exec -T postgres pg_dump -U postgres -Fc "$db" > "backup-$db-$(date +%F).dump"
   done
   ```
   OpenFGA's data can be rebuilt: the reconciler rewrites every cluster's grants. Hydra's holds clients and sessions; users only have to sign in again.
3. **The certificates**: `certs/` (Compose) or the `incuscloud-internal-tls` secret (Helm). Losing the internal CA means trusting a new one on every cluster member.

To restore, set the same `IC_SECRET_KEY`, restore the dumps into empty databases, and start.

---

## Upgrading

Database migrations run when IncusCloud starts. Back up first (above).

- **Compose:**
  ```sh
  sed -i 's#^INCUSCLOUD_IMAGE=.*#INCUSCLOUD_IMAGE=ghcr.io/m41denx/incuscloud:0.2.0#' .env
  docker compose pull && docker compose up -d
  ```
- **Helm:**
  ```sh
  helm upgrade incuscloud oci://ghcr.io/m41denx/charts/incuscloud --version 0.2.0 -n incuscloud -f values.yaml
  ```

Read the release notes before upgrading: they say when roles change. For example, from this beta on, tenant members are *Unrestricted users* on their tenant. They can then back up, restore, move instances between clusters and delete Kubernetes clusters there.

---

## Uninstalling

1. Delete the clusters from IncusCloud first: first remove the tenants placed on each one, then on the cluster's page choose **Delete**. This unsets IncusCloud's OIDC and OpenFGA settings on the cluster and removes its certificate. Tenants' projects and instances stay.
   - If IncusCloud is already gone, run this on each cluster:
     ```sh
     for k in oidc.issuer oidc.client.id oidc.audience oidc.claim \
              authorization.openfga.api.url authorization.openfga.api.token authorization.openfga.store.id; do
       incus config unset "$k"
     done
     incus config trust list    # then remove the "incuscloud" certificate
     ```
2. Remove IncusCloud:
   - Compose: `docker compose down`. Add `-v` to delete the database too.
   - Helm: `helm uninstall incuscloud -n incuscloud`. The `incuscloud` and `incuscloud-internal-tls` secrets and the Postgres volume are kept on purpose; delete them by hand.

---

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| `incuscloud` restarts with `Invalid configuration:` | A missing or invalid `IC_*` setting | The log lists each one. |
| Log shows `Hydra not ready, retrying` for long | Hydra failed to start | `docker compose logs hydra hydra-migrate`. A certificate it cannot read is the usual cause: `./certs` must be owned by `IC_UID`. |
| Enrolment fails: `cannot reach` | IncusCloud can't reach the addresses in the token | Check the route and firewall to port 8443. The token lists the cluster's `core.https_address` values. |
| Cluster stays *degraded* with an OpenFGA error | The cluster can't reach `IC_OPENFGA_CLUSTER_URL` | From a member: `curl http://<openfga>:8080/healthz`. |
| `incus remote add … --auth-type=oidc` fails, or the cluster answers `not authorized` after sign-in | The cluster can't fetch the issuer, or doesn't trust its certificate | From a member: `curl https://cloud.example.com/.well-known/openid-configuration`, without `-k`. With the internal CA, install `ca.crt` and restart `incus`. |
| Browser shows a certificate warning | Internal CA not trusted on that machine | Import `ca.crt`, or use a public certificate. |
| Kubernetes is off in the UI | No `IC_K8S_KUBECONFIG` | See [section 6](#6-optional-kubernetes-clusters-for-tenants). |
| Kubernetes nodes never become ready | Kernel modules missing on the Incus hosts, or the endpoint ports are blocked | See section 6, step 4, and `IC_K8S_PORTS`. |

For more detail, set `IC_LOG_LEVEL=debug`.

---

## Known limits

This is a beta. Before production:

- **Hardening still to come:**
  - request body limits and idle timeouts on the front server;
  - a trusted-proxy setting (client addresses are the direct peer's);
  - retention for the audit and gateway logs, which grow without limit;
  - per-token caching in the gateway.

  Keep IncusCloud directly on its own address (or behind TCP passthrough), and watch the database's size.
- **One OpenFGA token for every cluster.** Incus takes one static OpenFGA token, so every cluster has the same one, and OpenFGA accepts it for every store. Root on any enrolled cluster can read it, and with it change other clusters' grants in OpenFGA (not IncusCloud's own permissions). Only enrol clusters whose root users you trust with each other, and firewall OpenFGA. Per-cluster tokens are planned.
- **Cluster owner is root on those hosts.** That role can provision nodes, which is Incus server admin. Never give it to an untrusted tenant. Tenants' roles (Tenant admin, Unrestricted user, User) stay inside restricted projects.
- **One replica.** Run IncusCloud as a single replica (`IC_ROLE=all`). Splitting the API from the worker and running several API replicas is planned.
