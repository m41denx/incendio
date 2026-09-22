# CAPN reference (pinned for Phase 0)

Resolves the TODO in [`README.md`](./README.md) §2. Captured from the upstream
cluster-api-provider-incus book on 2026-09-22:

- Quick start: <https://capn.linuxcontainers.org/tutorial/quick-start.html>
- Default template: <https://capn.linuxcontainers.org/reference/templates/default.html>
- OVN template: <https://capn.linuxcontainers.org/reference/templates/ovn.html>

This is the source of truth for the Phase 0 generator (menu + pure-UI artifact
generator). Everything here is rendered client-side; no agent required.

> Incendio targets CAPI 0.9.x+ and the current Incus provider, and generates the
> **default (ClusterClass) template only**. OVN is offered as one of the four
> `LOAD_BALANCER` strategies rather than as a separate `--flavor ovn` template,
> and machine type is limited to `container` / `virtual-machine` (no `kind`).

---

## 1. Credentials Secret (`LXC_SECRET_NAME`)

CAPN reads infrastructure credentials from a plain Kubernetes `Secret` in the
management cluster. For **Incus** the documented keys are:

| Key          | Value                                                        |
| ------------ | ----------------------------------------------------------- |
| `server`     | `https://<incus-host>:8443` (the Incus HTTPS API address)   |
| `server-crt` | Incus **server** certificate PEM (for TLS verification)     |
| `client-crt` | **client** certificate PEM (trusted on the Incus server)    |
| `client-key` | client private key PEM                                       |
| `project`    | Incus project the clusters live in (e.g. `default`)         |

Equivalent to:

```sh
kubectl create secret generic lxc-secret \
  --from-literal=server="https://<host>:8443" \
  --from-literal=server-crt="$(cat servercert.crt)" \
  --from-literal=client-crt="$(cat client.crt)" \
  --from-literal=client-key="$(cat client.key)" \
  --from-literal=project="default"
```

The UI renders this as a `Secret` manifest with `stringData` so the values stay
human-readable. The client cert/key pair is minted by Incendio (we already do
certificate + trust-token creation) and the `client-crt` must be trusted on the
Incus server (`incus config trust add-certificate`). The `server-crt` is the
remote's server certificate (what `incus remote add ... --accept-certificate`
pins).

> LXD variant differs only in cert paths and can use a trust **token** flow
> (`lxc config trust add --name`), but the resulting Secret keys are identical.

---

## 2. Management-cluster prerequisites (`clusterctl init`)

The generator surfaces these as copy-paste prerequisites; they run on the user's
management cluster, not in Incendio.

1. A management Kubernetes cluster (e.g. `kind`) + `kubectl` + `clusterctl`.
2. Register the provider so `clusterctl` knows about incus — either write
   `~/.cluster-api/clusterctl.yaml`:
   ```yaml
   providers:
   - name: incus
     type: InfrastructureProvider
     url: https://github.com/lxc/cluster-api-provider-incus/releases/latest/infrastructure-components.yaml
   ```
   or fetch the hosted one:
   ```sh
   curl -o ~/.cluster-api/clusterctl.yaml \
     https://capn.linuxcontainers.org/static/v0.1/clusterctl.yaml
   ```
3. Initialize the provider (the **default** template uses a ClusterClass, so the
   ClusterTopology feature gate must be on):
   ```sh
   CLUSTER_TOPOLOGY=true clusterctl init -i incus
   ```
4. Apply the Secret from §1, then apply the generated cluster manifest.

---

## 3. Template variables

### 3.1 default flavor (`-i incus`, ClusterClass `capn-v1beta2`)

**Required:** `KUBERNETES_VERSION`, `LOAD_BALANCER`, `LXC_SECRET_NAME`.

**Optional (defaults):**

| Variable                        | Default            |
| ------------------------------- | ------------------ |
| `CLUSTER_NAME`                  | `c1`               |
| `CONTROL_PLANE_MACHINE_COUNT`   | `1`                |
| `WORKER_MACHINE_COUNT`          | `0`                |
| `CONTROL_PLANE_MACHINE_TYPE`    | `container`        |
| `WORKER_MACHINE_TYPE`           | `container`        |
| `CONTROL_PLANE_MACHINE_FLAVOR`  | `c2-m4`            |
| `WORKER_MACHINE_FLAVOR`         | `c2-m4`            |
| `CONTROL_PLANE_MACHINE_PROFILES`| `[default]`        |
| `WORKER_MACHINE_PROFILES`       | `[default]`        |
| `CONTROL_PLANE_MACHINE_DEVICES` | `[]`               |
| `WORKER_MACHINE_DEVICES`        | `[]`               |
| `CONTROL_PLANE_MACHINE_TARGET`  | `""`               |
| `WORKER_MACHINE_TARGET`         | `""`               |
| `PRIVILEGED`                    | `true`             |
| `DEPLOY_KUBE_FLANNEL`           | `false`            |
| `INSTALL_KUBEADM`               | `false`            |
| `LXC_IMAGE_NAME`                | `""`               |
| `POD_CIDR`                      | `[10.244.0.0/16]`  |
| `SERVICE_CIDR`                  | `[10.96.0.0/12]`   |

`instanceType` (a.k.a. machine type) must be `container`, `virtual-machine` or
`kind`. `FLAVOR` is `cX-mY` (X cores, Y GB RAM). `PROFILES`/`DEVICES` are the
seam where Incendio-built Incus profiles/devices plug in. `DEVICES` entries use
`<device>,<key>=<value>`.

**`LOAD_BALANCER`** is a single-key YAML map choosing the control-plane endpoint
strategy:

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------ |
| `lxc: {}`       | haproxy in an LXC container (1c/1G, default profile). Good for dev. |
| `oci: {}`       | haproxy in an OCI container (1c/1G, default profile).               |
| `kube-vip: {}`  | kube-vip static pods on control-plane nodes; VIP `10.0.42.1`.       |
| `ovn: {...}`    | OVN network load balancer (`10.100.42.1` on `ovn-0`).              |

### 3.2 ovn flavor (`--flavor ovn`, plain manifests, CRDs `v1alpha2`)

Adds two required variables and drops `LOAD_BALANCER`:

| Variable                     | Example        | Meaning                                   |
| ---------------------------- | -------------- | ----------------------------------------- |
| `LXC_LOAD_BALANCER_ADDRESS`  | `10.100.42.1`  | free IP in the OVN uplink network         |
| `LXC_LOAD_BALANCER_NETWORK`  | `ovn0`         | name of the OVN network the instances use |

The `LXCCluster` sets `controlPlaneEndpoint.host` to the LB address (port 6443)
and `loadBalancer.ovn.networkName` to the OVN network.

---

## 4. Generate command

```sh
# default flavor (the only flavor Incendio generates)
clusterctl generate cluster <name> -i incus \
  --kubernetes-version v1.37.0 \
  --control-plane-machine-count 1 \
  --worker-machine-count 1 > cluster.yaml
```

The `LOAD_BALANCER` map carries the fields each strategy needs, e.g.
`lxc: {profiles: [default], flavor: c1-m1}`, `oci: {...}`,
`kube-vip: {host: 10.0.42.1}`, or `ovn: {host: 10.100.42.1, networkName: default}`.
`*_MACHINE_FLAVOR` is CAPN's `c<cores>-m<GiB>` shorthand (or an AWS-style name);
the provider expands it into instance limits at reconcile time.

Variables not passed as flags are read from the environment (see §3).

---

## 5. Rendered CRD kinds (for the discovery phase later)

A generated bundle contains: `Cluster`, `LXCCluster`, `KubeadmControlPlane` +
`LXCMachineTemplate` (control plane), `MachineDeployment` + `LXCMachineTemplate`
+ `KubeadmConfigTemplate` (workers). API groups: `cluster.x-k8s.io/v1beta2`,
`infrastructure.cluster.x-k8s.io/v1alpha2` (`LXCCluster`, `LXCMachineTemplate`),
`controlplane.cluster.x-k8s.io/v1beta2`, `bootstrap.cluster.x-k8s.io/v1beta2`.
Instances get `provider-id: lxc:///{{ v1.local_hostname }}`.
