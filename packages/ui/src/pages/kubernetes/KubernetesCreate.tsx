import { useMemo, useState, type FC, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ActionButton,
  Button,
  CodeSnippet,
  CodeSnippetBlockAppearance,
  Col,
  Icon,
  Input,
  MultiSelect,
  Notification,
  Row,
  Select,
  Textarea,
  useNotify,
  useToastNotification,
} from "@canonical/react-components";
import BaseLayout from "components/BaseLayout";
import NotificationRow from "components/NotificationRow";
import CopyToClipboard from "components/CopyToClipboard";
import FormMenuItem from "components/forms/FormMenuItem";
import FormFooterLayout from "components/forms/FormFooterLayout";
import { useProfiles } from "context/useProfiles";
import { useClusterMembers } from "context/useClusterMembers";
import { useClusterGroups } from "context/useClusterGroups";
import { useIncusCredentials } from "pages/kubernetes/useIncusCredentials";
import {
  useCreateK8sCluster,
  useK8sMetalLBHint,
} from "pages/kubernetes/useK8sClusters";
import MetalLBAddressInput from "pages/kubernetes/MetalLBAddressInput";
import { metallbAddressesError } from "util/k8s/metallb";
import { useK8sManagement } from "pages/kubernetes/useK8sManagement";
import { ROOT_PATH } from "util/rootPath";
import { downloadText } from "util/k8s/download";
import {
  CUSTOM_VERSION,
  defaultK8sClusterConfig,
  generateClusterctlCommand,
  generateEnvExports,
  generatePrerequisites,
  generateSecretYaml,
  isPresetKubeadmVersion,
  kubeadmVersionSelectOptions,
  loadBalancerOptions,
  machineTypeOptions,
  memoryUnitOptions,
  controlPlaneSizeIssue,
  type K8sClusterConfig,
  type SizeIssue,
  type LoadBalancerType,
  type MachineType,
  type MemoryUnit,
} from "util/k8s/capn";

const CAPN_DOCS = "https://capn.linuxcontainers.org/";

const CLUSTER = "Cluster";
const MACHINES = "Machines";
const CREDENTIALS = "Infrastructure credentials";
const ARTIFACTS = "Generated artifacts";
const SECTIONS = [CLUSTER, MACHINES, CREDENTIALS, ARTIFACTS];

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
  const notify = useNotify();
  const toastNotify = useToastNotification();
  const navigate = useNavigate();
  const createCluster = useCreateK8sCluster();
  const { state: management, info } = useK8sManagement();
  const managementReady = management.stage === "ready";
  const hasMetalLB = info?.capabilities.metallb === true;

  const [active, setActive] = useState<string>(CLUSTER);
  const [config, setConfig] = useState<K8sClusterConfig>(
    defaultK8sClusterConfig,
  );
  const controlPlaneIssue = controlPlaneSizeIssue(config);
  const { data: metallbHint } = useK8sMetalLBHint(
    undefined,
    hasMetalLB && config.metallb,
  );
  const metallbError = config.metallb
    ? metallbAddressesError(config.metallbAddresses)
    : null;
  const {
    serverUrl,
    setServerUrl,
    project,
    setProject,
    serverCrt,
    setServerCrt,
    clientCrt,
    setClientCrt,
    clientKey,
    setClientKey,
    isGenerating,
    generateCredential,
  } = useIncusCredentials();

  const { data: profiles = [] } = useProfiles(project);
  const { data: members = [] } = useClusterMembers();
  const { data: groups = [] } = useClusterGroups();

  const profileItems = profiles.map((profile) => ({
    label: profile.name,
    value: profile.name,
  }));
  const targetOptions = [
    { label: "(no override)", value: "" },
    ...members.map((member) => ({
      label: member.server_name,
      value: member.server_name,
    })),
    ...groups.map((group) => ({
      label: `@${group.name}`,
      value: `@${group.name}`,
    })),
  ];

  const update = <K extends keyof K8sClusterConfig>(
    key: K,
    value: K8sClusterConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const secretYaml = useMemo(
    () =>
      generateSecretYaml(config.secretName, {
        server: serverUrl,
        serverCrt,
        clientCrt,
        clientKey,
        project,
      }),
    [config.secretName, serverUrl, serverCrt, clientCrt, clientKey, project],
  );
  const envExports = useMemo(() => generateEnvExports(config), [config]);
  const command = useMemo(() => generateClusterctlCommand(config), [config]);
  const prerequisites = useMemo(() => generatePrerequisites(), []);

  const renderArtifact = (
    title: string,
    code: string,
    filename?: string,
    isYaml?: boolean,
  ): ReactNode => (
    <div className="u-sv3">
      <div className="k8s-artifact-header">
        <h3 className="p-heading--5 u-no-margin--bottom">{title}</h3>
        <div className="k8s-artifact-actions">
          <CopyToClipboard value={code} tooltipMessage="Copy to clipboard" />
          {filename ? (
            <Button
              appearance="base"
              hasIcon
              className="u-no-margin--bottom"
              onClick={() => {
                downloadText(filename, code);
              }}
            >
              <Icon name="begin-downloading" />
              <span>Download</span>
            </Button>
          ) : null}
        </div>
      </div>
      <CodeSnippet
        blocks={[
          {
            code,
            appearance: isYaml
              ? CodeSnippetBlockAppearance.NUMBERED
              : undefined,
          },
        ]}
      />
    </div>
  );

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
    <div className="u-sv3">
      <h3 className="p-heading--5">{title}</h3>
      <Row>
        <Col size={4}>
          <Input
            type="number"
            min={minCount}
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
          placeholder="c2-m4 or t3.medium"
          help="CAPN flavor: c<cores>-m<GiB>, or an AWS-style instance name."
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
            <label className="p-form__label">Memory</label>
            <div className="memory-limit-with-unit">
              <Input
                type="number"
                min={1}
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
        value={target}
        options={targetOptions}
        help="Pin nodes to a specific cluster member or @group."
        onChange={(e) => {
          onTarget(e.target.value);
        }}
      />
    </div>
  );

  const isCustomVersion = !isPresetKubeadmVersion(config.kubernetesVersion);
  const isLxcLoadBalancer =
    config.loadBalancer === "lxc" || config.loadBalancer === "oci";

  return (
    <BaseLayout
      title="Create Kubernetes cluster"
      contentClassName="kubernetes-form"
    >
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
            <NotificationRow />
            <Notification severity="information" title="Cluster generator">
              Generate the credentials and manifests needed to provision
              Kubernetes clusters on Incus with the{" "}
              <a href={CAPN_DOCS} target="_blank" rel="noopener noreferrer">
                Cluster API provider for Incus (CAPN)
              </a>
              . Configure the Kubernetes agent to provision directly, or use the
              generator to produce artifacts you run against your own management
              cluster.
            </Notification>
            {active === CLUSTER ? (
              <>
                <h2 className="p-heading--4">Cluster</h2>
                <Input
                  type="text"
                  label="Cluster name"
                  value={config.clusterName}
                  onChange={(e) => {
                    update("clusterName", e.target.value);
                  }}
                />
                <Select
                  label="Kubernetes version"
                  value={
                    isPresetKubeadmVersion(config.kubernetesVersion)
                      ? config.kubernetesVersion
                      : CUSTOM_VERSION
                  }
                  options={kubeadmVersionSelectOptions}
                  help="Prebuilt kubeadm images (Ubuntu 24.04, amd64/arm64), or Custom to point at your own image."
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_VERSION) {
                      update("kubernetesVersion", "");
                    } else {
                      update("kubernetesVersion", e.target.value);
                      update("imageName", "");
                    }
                  }}
                />
                {isCustomVersion ? (
                  <>
                    <Input
                      type="text"
                      label="Kubernetes version"
                      value={config.kubernetesVersion}
                      placeholder="v1.37.0"
                      help="Must match the kubeadm version baked into your custom image."
                      onChange={(e) => {
                        update("kubernetesVersion", e.target.value);
                      }}
                    />
                    <Input
                      type="text"
                      label="Image name"
                      value={config.imageName}
                      placeholder="kubeadm/v1.37.0/ubuntu/24.04"
                      help="Custom image alias, or <remote>:<image>, for the node image."
                      onChange={(e) => {
                        update("imageName", e.target.value);
                      }}
                    />
                  </>
                ) : null}
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
                {hasMetalLB ? (
                  <>
                    <Input
                      type="checkbox"
                      label="Install MetalLB"
                      checked={config.metallb}
                      help="Gives Services of type LoadBalancer an external IP. Without it they stay pending; NodePort still works. Installed by the Kubernetes agent once the cluster is ready."
                      onChange={(e) => {
                        const enable = e.target.checked;
                        update("metallb", enable);
                        if (
                          enable &&
                          !config.metallbAddresses &&
                          metallbHint?.range
                        ) {
                          update("metallbAddresses", metallbHint.range);
                        }
                      }}
                    />
                    {config.metallb ? (
                      <MetalLBAddressInput
                        id="metallbAddresses"
                        value={config.metallbAddresses}
                        hint={metallbHint}
                        error={metallbError}
                        onChange={(value) => {
                          update("metallbAddresses", value);
                        }}
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="u-text--muted">
                    Update the Kubernetes agent (Kubernetes settings →
                    Management appliance) to install MetalLB with the cluster.
                  </p>
                )}
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

            {active === CREDENTIALS ? (
              <>
                <h2 className="p-heading--4">Infrastructure credentials</h2>
                <p className="u-text--muted">
                  CAPN reads these from a Kubernetes Secret named{" "}
                  <code>{config.secretName}</code>. The client certificate must
                  be trusted on the Incus server.
                </p>
                <Input
                  type="text"
                  label="Secret name"
                  value={config.secretName}
                  onChange={(e) => {
                    update("secretName", e.target.value);
                  }}
                />
                <Input
                  type="text"
                  label="Incus server URL"
                  value={serverUrl}
                  placeholder="https://incus.example.com:8443"
                  onChange={(e) => {
                    setServerUrl(e.target.value);
                  }}
                />
                <Input
                  type="text"
                  label="Incus project"
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value);
                  }}
                />
                <Textarea
                  label="Server certificate (PEM)"
                  rows={4}
                  value={serverCrt}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  onChange={(e) => {
                    setServerCrt(e.target.value);
                  }}
                />
                <Button
                  hasIcon
                  onClick={generateCredential}
                  disabled={isGenerating}
                  aria-label={
                    isGenerating
                      ? "Generating client certificate"
                      : "Generate client certificate"
                  }
                >
                  {isGenerating ? (
                    <Icon className="u-animation--spin" name="spinner" />
                  ) : (
                    <Icon name="security" />
                  )}
                  <span>
                    {isGenerating
                      ? "Generating…"
                      : "Generate client certificate & key"}
                  </span>
                </Button>
                <Textarea
                  label="Client certificate (PEM)"
                  rows={4}
                  value={clientCrt}
                  placeholder="-----BEGIN CERTIFICATE-----"
                  onChange={(e) => {
                    setClientCrt(e.target.value);
                  }}
                />
                <Textarea
                  label="Client key (PEM)"
                  rows={4}
                  value={clientKey}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----"
                  onChange={(e) => {
                    setClientKey(e.target.value);
                  }}
                />
              </>
            ) : null}

            {active === ARTIFACTS ? (
              <>
                <h2 className="p-heading--4">Generated artifacts</h2>
                {renderArtifact(
                  "Infrastructure credentials Secret",
                  secretYaml,
                  "secret.yaml",
                  true,
                )}
                {renderArtifact("Cluster variables", envExports, "cluster.env")}
                {renderArtifact("clusterctl command", command)}
                {renderArtifact("Prerequisites", prerequisites)}
              </>
            ) : null}
          </Col>
        </Row>
      </div>

      <FormFooterLayout>
        <Button
          appearance="base"
          onClick={() => {
            navigate(`${ROOT_PATH}/ui/kubernetes`);
          }}
        >
          Cancel
        </Button>
        <ActionButton
          appearance="positive"
          loading={createCluster.isPending}
          disabled={
            config.clusterName.trim().length === 0 ||
            !managementReady ||
            controlPlaneIssue !== null ||
            metallbError !== null
          }
          title={
            !managementReady
              ? management.title
              : (controlPlaneIssue?.message ?? metallbError ?? undefined)
          }
          onClick={() => {
            createCluster.mutate(config, {
              onSuccess: (result) => {
                toastNotify.success(
                  `Cluster "${result.name}" submitted in project "${result.project}". Cluster API is provisioning its nodes.`,
                );
                navigate(`${ROOT_PATH}/ui/kubernetes`);
              },
              onError: (error) => {
                notify.failure("Failed to create cluster", error);
              },
            });
          }}
        >
          Create cluster
        </ActionButton>
      </FormFooterLayout>
    </BaseLayout>
  );
};

export default KubernetesCreate;
