import { useEffect, useRef, useState, type FC, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ActionButton, Button, Col, Input, MultiSelect, Row, Select } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import FormMenuItem from "@incendio/ui/components/forms/FormMenuItem";
import FormFooterLayout from "@incendio/ui/components/forms/FormFooterLayout";
import MetalLBAddressInput from "@incendio/ui/pages/kubernetes/MetalLBAddressInput";
import { metallbAddressesError } from "@incendio/ui/util/k8s/metallb";
import { defaultK8sClusterConfig, loadBalancerOptions, machineTypeOptions, memoryUnitOptions, controlPlaneSizeIssue,
  type K8sClusterConfig, type SizeIssue, type LoadBalancerType, type MachineType, type MemoryUnit } from "@incendio/ui/util/k8s/capn";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { incusAt, request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { Cluster, Tenant, TenantPlacement, TenantRole } from "../../api/types";
import { nameOf } from "../inventory/tree";
import { useCreateK8sCluster, useK8sOptions, clusterUrl } from "./useK8sClusters";
import { specOfConfig, usageOfSpec, specIssue } from "./quota";
const CLUSTER = "Cluster";
const MACHINES = "Machines";
const SECTIONS = [CLUSTER, MACHINES];
const CREATORS: TenantRole[] = ["owner", "admin", "member"];
const NAME = /^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$/;
const splitCsv = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const addCsv = (csv: string, value: string): string =>
  [...splitCsv(csv), value].join(",");

const removeCsv = (csv: string, value: string): string =>
  splitCsv(csv)
    .filter((item) => item !== value)
    .join(",");

interface NodeGroupProps {
  title: string;
  minCount: number;
  count: number;
  onCount: (value: number) => void;
  type: MachineType;
  onType: (value: MachineType) => void;
  custom: boolean;
  onCustom: (value: boolean) => void;
  flavor: string;
  onFlavor: (value: string) => void;
  cpu: number;
  onCpu: (value: number) => void;
  memory: number;
  onMemory: (value: number) => void;
  memoryUnit: MemoryUnit;
  onMemoryUnit: (value: MemoryUnit) => void;
  profiles: string;
  onProfiles: (value: string) => void;
  target: string;
  onTarget: (value: string) => void;
  /** Size validation for this group (control plane only). */
  sizeIssue?: SizeIssue | null;
}

const KubernetesCreate: FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: me, error: meError } = useMe();
  const options = useK8sOptions();
  const createCluster = useCreateK8sCluster();
  const operator = can(me, "operator");
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"), enabled: operator });
  const choices: Array<{ id: string; slug: string; name: string }> = operator ? (tenants.data ?? []) : (me?.tenants ?? []).filter((t) => CREATORS.includes(t.role));
  const [picked, setPicked] = useState(params.get("tenant") ?? "");
  const tenantId = choices.some((t) => t.id === picked) ? picked : (choices[0]?.id ?? "");
  const placements = useQuery({ queryKey: ["tenants", tenantId, "placements"], queryFn: () => request<TenantPlacement[]>("GET", `/api/v1/tenants/${tenantId}/placements`), enabled: !!tenantId });
  // Operators create on any ready cluster; one the tenant is not on places it there first.
  const allClusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters"), enabled: operator });

  const [clusterPick, setClusterPick] = useState("");
  const [active, setActive] = useState(CLUSTER);
  const [config, setConfig] = useState<K8sClusterConfig>({ ...defaultK8sClusterConfig, clusterName: "", privileged: false });
  const [lbTarget, setLbTarget] = useState("");
  const [lbInterface, setLbInterface] = useState("eth0");
  const seeded = useRef(false);
  useEffect(() => {
    if (!options.data || seeded.current) return;
    seeded.current = true;
    const defaults = options.data.defaults;
    setConfig(c => ({ ...c, kubernetesVersion: options.data!.versions.at(-1) ?? "",
      ...(defaults ? { privileged: defaults.privileged, deployKubeFlannel: defaults.flannel, installKubeadm: defaults.installKubeadm,
        podCidr: defaults.podCidr, serviceCidr: defaults.serviceCidr } : {}) }));
  }, [options.data]);
  const placed = placements.data ?? [];
  const ready: Array<{ clusterId: string; clusterName: string; places?: boolean }> = operator
    ? (allClusters.data ?? [])
        .filter((c) => c.status === "ready")
        .map((c) => ({ clusterId: c.id, clusterName: c.name, places: !placed.some((p) => p.clusterId === c.id) }))
        .sort((a, b) => a.clusterName.localeCompare(b.clusterName))
    : placed.filter((p) => p.status === "ready");
  // A cluster's page asks for that cluster (`?cluster=<name>`).
  const asked = ready.find((p) => p.clusterName === params.get("cluster"))?.clusterId;
  const clusterId = ready.some((p) => p.clusterId === clusterPick) ? clusterPick : (asked ?? ready[0]?.clusterId ?? "");
  const places = ready.find((p) => p.clusterId === clusterId)?.places ?? false;
  const tenantName = choices.find((t) => t.id === tenantId)?.name ?? "The tenant";
  const clusterName = ready.find((p) => p.clusterId === clusterId)?.clusterName ?? "";
  const project = `${placed.find(p => p.clusterId === clusterId)?.project ?? choices.find(t => t.id === tenantId)?.slug ?? ""}@${clusterName}`;
  // Profiles and targets belong only to the chosen cluster/project, never the whole fleet.
  const profilesQuery = useQuery({ queryKey: ["profiles", project], queryFn: () => incusAt<Array<{name:string}>>(clusterName, `/1.0/profiles?recursion=1&project=${encodeURIComponent(project)}`), enabled: !!clusterName && !places });
  const membersQuery = useQuery({ queryKey: ["kubernetes-targets", clusterName, "members"], queryFn: () => incusAt<Array<{server_name:string;status:string}>>(clusterName, "/1.0/cluster/members?recursion=1"), enabled: !!clusterName });
  const groupsQuery = useQuery({ queryKey: ["kubernetes-targets", clusterName, "groups"], queryFn: () => incusAt<Array<{name:string}>>(clusterName, "/1.0/cluster/groups?recursion=1"), enabled: !!clusterName });
  const profileItems = (profilesQuery.data ?? []).map(p => ({ label: nameOf(p.name), value: nameOf(p.name) }));
  const targetOptions = [{ label: "(no override)", value: "" },
    ...(membersQuery.data ?? []).filter(m => m.status === "Online").map(m => ({ label: nameOf(m.server_name), value: nameOf(m.server_name) })),
    ...(groupsQuery.data ?? []).map(g => ({ label: `@${nameOf(g.name)}`, value: `@${nameOf(g.name)}` }))];
  const validTarget = (target: string) => targetOptions.some(t => t.value === target) ? target : "";
  const update = <K extends keyof K8sClusterConfig>(key: K, value: K8sClusterConfig[K]) => setConfig(c => ({ ...c, [key]: value }));
  const scopedConfig = { ...config, controlPlaneTarget: validTarget(config.controlPlaneTarget), workerTarget: validTarget(config.workerTarget) };
  const spec = specOfConfig(scopedConfig, validTarget(lbTarget), lbInterface);
  const controlPlaneIssue = controlPlaneSizeIssue(config);
  const metallbError = config.metallb ? metallbAddressesError(config.metallbAddresses) : null;
  const issue = controlPlaneIssue?.message ?? metallbError ?? specIssue(spec);
  const countsValid = [1,3,5].includes(config.controlPlaneCount) && Number.isInteger(config.workerCount) && config.workerCount >= 0 && config.workerCount <= 20;
  const valid = !!tenantId && !!clusterId && NAME.test(config.clusterName) && (options.data?.versions.includes(config.kubernetesVersion) ?? false) && countsValid && !issue;
  const loadError = meError ?? options.error ?? tenants.error ?? placements.error ?? allClusters.error;
  const scopeError = profilesQuery.error ?? membersQuery.error ?? groupsQuery.error;
  const usage = usageOfSpec(spec, config.controlPlaneCount, config.workerCount);
  const renderNodeGroup = ({
    title,
    minCount,
    count,
    onCount,
    type,
    onType,
    custom,
    onCustom,
    flavor,
    onFlavor,
    cpu,
    onCpu,
    memory,
    onMemory,
    memoryUnit,
    onMemoryUnit,
    profiles: nodeProfiles,
    onProfiles,
    target,
    onTarget,
    sizeIssue,
  }: NodeGroupProps): ReactNode => (
    <div className="u-sv3" role="region" aria-label={title}>
      <h3 className="p-heading--5">{title}</h3>
      <Row>
        <Col size={4}>
          <Input
            type="number"
            min={minCount}
            max={title === "Control plane" ? 5 : 20}
            step={title === "Control plane" ? 2 : 1}
            label="Count"
            value={count}
            onChange={(e) => {
              onCount(Number(e.target.value));
            }}
          />
        </Col>
        <Col size={4}>
          <Select
            label="Type"
            value={type}
            options={machineTypeOptions}
            onChange={(e) => {
              onType(e.target.value as MachineType);
            }}
          />
        </Col>
      </Row>
      <Input
        type="checkbox"
        label="Custom flavor"
        checked={custom}
        onChange={(e) => {
          onCustom(e.target.checked);
        }}
      />
      {custom ? (
        <Input
          type="text"
          label="Flavor"
          value={flavor}
          placeholder="c2-m4"
          help="CAPN flavor: c<cores>-m<GiB>. IncusCloud counts quota from this size."
          error={sizeIssue?.message}
          onChange={(e) => {
            onFlavor(e.target.value);
          }}
        />
      ) : (
        <Row>
          <Col size={6}>
            <Input
              type="number"
              min={1}
              label="CPU cores"
              value={cpu}
              error={sizeIssue?.field === "cpu" ? sizeIssue.message : undefined}
              onChange={(e) => {
                onCpu(Number(e.target.value));
              }}
            />
          </Col>
          <Col size={6}>
            <label className="p-form__label" htmlFor={`${title}-memory`}>Memory</label>
            <div className="memory-limit-with-unit">
              <Input
                type="number"
                min={1}
                id={`${title}-memory`}
                value={memory}
                error={
                  sizeIssue?.field === "memory" ? sizeIssue.message : undefined
                }
                onChange={(e) => {
                  onMemory(Number(e.target.value));
                }}
              />
              <Select
                label="Memory unit"
                labelClassName="u-off-screen"
                value={memoryUnit}
                options={memoryUnitOptions}
                onChange={(e) => {
                  onMemoryUnit(e.target.value as MemoryUnit);
                }}
              />
            </div>
          </Col>
        </Row>
      )}
      <div className="p-form__group">
        <label className="p-form__label">Profiles</label>
        <MultiSelect
          items={profileItems}
          selectedItems={splitCsv(nodeProfiles).map((value) => ({
            label: value,
            value,
          }))}
          onSelectItem={(item) => {
            onProfiles(addCsv(nodeProfiles, item.value as string));
          }}
          onDeselectItem={(item) => {
            onProfiles(removeCsv(nodeProfiles, item.value as string));
          }}
          onItemsUpdate={(items) => {
            onProfiles(items.map((i) => i.value as string).join(","));
          }}
          variant="condensed"
        />
      </div>
      <Select
        label="Target"
        value={validTarget(target)}
        options={targetOptions}
        help="Pin nodes to a specific cluster member or @group."
        onChange={(e) => {
          onTarget(e.target.value);
        }}
      />
    </div>
  );

  const isLxcLoadBalancer = config.loadBalancer === "lxc" || config.loadBalancer === "oci";
  if (loadError) return <PageLayout title="Create Kubernetes cluster"><ErrorMessage error={loadError} /></PageLayout>;
  if (!me || !options.data || (operator && tenants.isPending)) return <PageLayout title="Create Kubernetes cluster"><Loading /></PageLayout>;
  if (!options.data.enabled) return <PageLayout title="Create Kubernetes cluster"><p>Kubernetes is not enabled on this IncusCloud.</p></PageLayout>;
  if (!choices.length) return <PageLayout title="Create Kubernetes cluster"><p>You are not a member of any tenant that can create Kubernetes clusters.</p></PageLayout>;
  return (
    <PageLayout title="Create Kubernetes cluster">
    <div className="kubernetes-form">
      <div className="form">
        <div className="p-side-navigation--accordion form-navigation">
          <nav aria-label="Kubernetes form navigation">
            <ul className="p-side-navigation__list">
              {SECTIONS.map((section) => (
                <FormMenuItem
                  key={section}
                  label={section}
                  active={active}
                  setActive={setActive}
                />
              ))}
            </ul>
          </nav>
        </div>

        <Row className="form-contents">
          <Col size={12}>
            {createCluster.error ? <ErrorMessage error={createCluster.error} /> : null}
            {scopeError ? <ErrorMessage error={scopeError} /> : null}
            {active === CLUSTER ? (
              <>
                <h2 className="p-heading--4">Cluster</h2>
                  <Select id="k8s-tenant" label="Tenant" value={tenantId} onChange={(e) => setPicked(e.target.value)} options={choices.map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }))} />
                  <Select
                    id="k8s-cluster"
                    label="Incus cluster"
                    value={clusterId}
                    onChange={(e) => setClusterPick(e.target.value)}
                    options={ready.map((p) => ({ value: p.clusterId, label: p.places ? `${p.clusterName} (places the tenant)` : p.clusterName }))}
                    help={
                      placements.isPending || (operator && allClusters.isPending)
                        ? "Loading…"
                        : places
                          ? `${tenantName} is placed on ${ready.find((p) => p.clusterId === clusterId)?.clusterName} first: its project there is created, then the cluster.`
                          : ready.length
                            ? operator
                              ? "Every ready Incus cluster; its nodes run in the tenant's project there."
                              : "The Incus clusters this tenant is placed on (and ready); its nodes run in the tenant's project there. An operator places it on more."
                            : "This tenant has no ready Incus cluster: an operator places it on one."
                    }
                  />

                <Input
                  type="text"
                  label="Cluster name"
                  value={config.clusterName}
                  onChange={(e) => {
                    update("clusterName", e.target.value);
                  }}
                />
                <Select label="Kubernetes version" value={config.kubernetesVersion} options={options.data.versions.map(v => ({label:v,value:v}))} onChange={e => update("kubernetesVersion",e.target.value)} />
                <Input type="text" label="Image name" value={config.imageName} help="Optional image alias, or <remote>:<image>, for the node image." onChange={e => update("imageName",e.target.value)} />
                <Select
                  label="Load balancer"
                  value={config.loadBalancer}
                  options={loadBalancerOptions}
                  help="Control-plane endpoint strategy."
                  onChange={(e) => {
                    update("loadBalancer", e.target.value as LoadBalancerType);
                  }}
                />
                {isLxcLoadBalancer ? (
                  <Row>
                    <Col size={6}>
                      <Input
                        type="text"
                        label="Load balancer profiles"
                        value={config.lbProfiles}
                        help="Comma-separated Incus profiles for the LB instance."
                        onChange={(e) => {
                          update("lbProfiles", e.target.value);
                        }}
                      />
                    </Col>
                    <Col size={6}>
                      <Input
                        type="text"
                        label="Load balancer flavor"
                        value={config.lbFlavor}
                        help="Instance size, e.g. c1-m1."
                        onChange={(e) => {
                          update("lbFlavor", e.target.value);
                        }}
                      />
                    </Col>
                  </Row>
                ) : null}
                {isLxcLoadBalancer ? <Select label="Load balancer target" value={validTarget(lbTarget)} options={targetOptions} onChange={e => setLbTarget(e.target.value)} /> : null}
                {config.loadBalancer === "kube-vip" ? <Input label="Interface" value={lbInterface} onChange={e => setLbInterface(e.target.value)} /> : null}
                {!isLxcLoadBalancer ? <p className="u-text--muted">The address must be reachable from IncusCloud's management cluster.</p> : null}
                {config.loadBalancer === "kube-vip" ? (
                  <Input
                    type="text"
                    label="Virtual IP address"
                    value={config.lbHost}
                    placeholder="10.0.42.1"
                    help="VIP announced by kube-vip on the control-plane nodes."
                    onChange={(e) => {
                      update("lbHost", e.target.value);
                    }}
                  />
                ) : null}
                {config.loadBalancer === "ovn" ? (
                  <Row>
                    <Col size={6}>
                      <Input
                        type="text"
                        label="Load balancer address"
                        value={config.lbHost}
                        placeholder="10.100.42.1"
                        help="A free IP address in the OVN uplink network."
                        onChange={(e) => {
                          update("lbHost", e.target.value);
                        }}
                      />
                    </Col>
                    <Col size={6}>
                      <Input
                        type="text"
                        label="OVN network"
                        value={config.lbNetworkName}
                        placeholder="default"
                        help="Name of the OVN network the instances use."
                        onChange={(e) => {
                          update("lbNetworkName", e.target.value);
                        }}
                      />
                    </Col>
                  </Row>
                ) : null}

                <h3 className="p-heading--5 u-sv1">Service load balancer</h3>
                <Input type="checkbox" label="Install MetalLB" checked={config.metallb} help="Gives Services of type LoadBalancer an external IP. Installed by IncusCloud once the cluster is ready." onChange={e => update("metallb",e.target.checked)} />
                {config.metallb ? <MetalLBAddressInput id="metallbAddresses" value={config.metallbAddresses} error={metallbError} onChange={v => update("metallbAddresses",v)} /> : null}
              </>
            ) : null}

            {active === MACHINES ? (
              <>
                <h2 className="p-heading--4">Machines</h2>
                {renderNodeGroup({
                  title: "Control plane",
                  minCount: 1,
                  count: config.controlPlaneCount,
                  onCount: (value) => {
                    update("controlPlaneCount", value);
                  },
                  type: config.controlPlaneType,
                  onType: (value) => {
                    update("controlPlaneType", value);
                  },
                  custom: config.controlPlaneCustomFlavor,
                  onCustom: (value) => {
                    update("controlPlaneCustomFlavor", value);
                  },
                  flavor: config.controlPlaneFlavor,
                  onFlavor: (value) => {
                    update("controlPlaneFlavor", value);
                  },
                  cpu: config.controlPlaneCpu,
                  onCpu: (value) => {
                    update("controlPlaneCpu", value);
                  },
                  memory: config.controlPlaneMemory,
                  onMemory: (value) => {
                    update("controlPlaneMemory", value);
                  },
                  memoryUnit: config.controlPlaneMemoryUnit,
                  onMemoryUnit: (value) => {
                    update("controlPlaneMemoryUnit", value);
                  },
                  profiles: config.controlPlaneProfiles,
                  onProfiles: (value) => {
                    update("controlPlaneProfiles", value);
                  },
                  target: config.controlPlaneTarget,
                  onTarget: (value) => {
                    update("controlPlaneTarget", value);
                  },
                  sizeIssue: controlPlaneIssue,
                })}
                {renderNodeGroup({
                  title: "Workers",
                  minCount: 0,
                  count: config.workerCount,
                  onCount: (value) => {
                    update("workerCount", value);
                  },
                  type: config.workerType,
                  onType: (value) => {
                    update("workerType", value);
                  },
                  custom: config.workerCustomFlavor,
                  onCustom: (value) => {
                    update("workerCustomFlavor", value);
                  },
                  flavor: config.workerFlavor,
                  onFlavor: (value) => {
                    update("workerFlavor", value);
                  },
                  cpu: config.workerCpu,
                  onCpu: (value) => {
                    update("workerCpu", value);
                  },
                  memory: config.workerMemory,
                  onMemory: (value) => {
                    update("workerMemory", value);
                  },
                  memoryUnit: config.workerMemoryUnit,
                  onMemoryUnit: (value) => {
                    update("workerMemoryUnit", value);
                  },
                  profiles: config.workerProfiles,
                  onProfiles: (value) => {
                    update("workerProfiles", value);
                  },
                  target: config.workerTarget,
                  onTarget: (value) => {
                    update("workerTarget", value);
                  },
                })}
                <Row>
                  <Col size={4}>
                    <Input
                      type="text"
                      label="Pod CIDR"
                      value={config.podCidr}
                      onChange={(e) => {
                        update("podCidr", e.target.value);
                      }}
                    />
                  </Col>
                  <Col size={4}>
                    <Input
                      type="text"
                      label="Service CIDR"
                      value={config.serviceCidr}
                      onChange={(e) => {
                        update("serviceCidr", e.target.value);
                      }}
                    />
                  </Col>
                </Row>
                <Input
                  type="checkbox"
                  label="Privileged containers"
                  checked={config.privileged}
                  onChange={(e) => {
                    update("privileged", e.target.checked);
                  }}
                />
                <Input
                  type="checkbox"
                  label="Deploy kube-flannel CNI"
                  checked={config.deployKubeFlannel}
                  onChange={(e) => {
                    update("deployKubeFlannel", e.target.checked);
                  }}
                />
                <Input
                  type="checkbox"
                  label="Install kubeadm on boot (for custom images without kubeadm)"
                  checked={config.installKubeadm}
                  onChange={(e) => {
                    update("installKubeadm", e.target.checked);
                  }}
                />
              </>
            ) : null}

          </Col>
        </Row>
      </div>
      <p className="u-text--muted" role="status">Uses {usage.instances} instances, {usage.cpu} CPUs, {usage.memory / 2 ** 30} GiB of memory and {usage.disk / 2 ** 30} GiB of disk of the tenant's quota.</p>
      {issue ? <p className="p-form-validation__message">{issue}</p> : null}
      {!countsValid ? <p>Control planes must be 1, 3 or 5; workers must be a whole number from 0 to 20.</p> : null}
      <FormFooterLayout>
        <Button appearance="base" onClick={() => navigate(`/kubernetes${params.size ? `?${params}` : ""}`)}>Cancel</Button>
        <ActionButton appearance="positive" loading={createCluster.isPending} disabled={!valid || !!scopeError || membersQuery.isPending || groupsQuery.isPending} title={issue ?? undefined}
          onClick={() => createCluster.mutate({ tenantId, clusterId, name: config.clusterName, version: config.kubernetesVersion,
            controlPlanes: config.controlPlaneCount as 1|3|5, workers: config.workerCount, spec }, { onSuccess: r => navigate(clusterUrl(r.cluster.id)) })}>Create cluster</ActionButton>
      </FormFooterLayout>
    </div>
    </PageLayout>
  );
};
export default KubernetesCreate;
