import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import {
  Button,
  CodeSnippet,
  CodeSnippetBlockAppearance,
  Col,
  Icon,
  Input,
  Notification,
  Row,
  Select,
  Textarea,
  useNotify,
} from "@canonical/react-components";
import BaseLayout from "components/BaseLayout";
import NotificationRow from "components/NotificationRow";
import CopyToClipboard from "components/CopyToClipboard";
import FormMenuItem from "components/forms/FormMenuItem";
import { useSettings } from "context/useSettings";
import K8sAgentPanel from "pages/kubernetes/K8sAgentPanel";
import {
  defaultK8sClusterConfig,
  generateClusterctlCommand,
  generateEnvExports,
  generatePrerequisites,
  generateSecretYaml,
  isPresetKubeadmVersion,
  kubeadmVersionSelectOptions,
  loadBalancerOptions,
  CUSTOM_VERSION,
  machineTypeOptions,
  type IncusClientCredential,
  type K8sClusterConfig,
} from "util/k8s/capn";

const CAPN_DOCS = "https://capn.linuxcontainers.org/";

const CLUSTER = "Cluster";
const MACHINES = "Machines";
const CREDENTIALS = "Infrastructure credentials";
const AGENT = "Kubernetes agent";
const ARTIFACTS = "Generated artifacts";
const SECTIONS = [CLUSTER, MACHINES, CREDENTIALS, AGENT, ARTIFACTS];

const downloadText = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const Kubernetes: FC = () => {
  const notify = useNotify();
  const { data: settings } = useSettings();

  const [active, setActive] = useState<string>(CLUSTER);
  const [config, setConfig] = useState<K8sClusterConfig>(
    defaultK8sClusterConfig,
  );
  const [serverUrl, setServerUrl] = useState("");
  const [project, setProject] = useState("default");
  const [serverCrt, setServerCrt] = useState("");
  const [clientCrt, setClientCrt] = useState("");
  const [clientKey, setClientKey] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const environment = settings?.environment;
    if (!environment) {
      return;
    }
    const address = environment.addresses?.[0];
    if (address) {
      setServerUrl((prev) => prev || `https://${address}`);
    }
    if (environment.certificate) {
      setServerCrt((prev) => prev || environment.certificate || "");
    }
  }, [settings]);

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
  const prerequisites = useMemo(() => generatePrerequisites(config), [config]);

  const generateCredential = () => {
    setIsGenerating(true);
    const worker = new Worker(
      new URL("../../util/generateK8sCredential?worker", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<IncusClientCredential>) => {
      setClientCrt(event.data.crt);
      setClientKey(event.data.key);
      setIsGenerating(false);
      worker.terminate();
      notify.success(
        "Client certificate and key generated. Trust the certificate on your Incus server before applying the Secret.",
      );
    };
    worker.onerror = (error) => {
      setIsGenerating(false);
      worker.terminate();
      notify.failure(
        "Failed to generate client certificate",
        new Error(error.message),
      );
    };
    worker.postMessage("");
  };

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

  const isOvn = config.flavor === "ovn";

  return (
    <BaseLayout title="Kubernetes">
      <NotificationRow />
      <Notification severity="information" title="Cluster generator">
        Generate the credentials and manifests needed to provision Kubernetes
        clusters on Incus with the{" "}
        <a href={CAPN_DOCS} target="_blank" rel="noopener noreferrer">
          Cluster API provider for Incus (CAPN)
        </a>
        . Configure the Kubernetes agent to provision directly, or use the
        generator to produce artifacts you run against your own management
        cluster.
      </Notification>

      <Row>
        <Col size={3}>
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
        </Col>

        <Col size={9}>
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
              {!isPresetKubeadmVersion(config.kubernetesVersion) ? (
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
                label="Flavor"
                value={config.flavor}
                options={[
                  {
                    label: "default (configurable load balancer)",
                    value: "default",
                  },
                  { label: "ovn (OVN network load balancer)", value: "ovn" },
                ]}
                onChange={(e) => {
                  update(
                    "flavor",
                    e.target.value as K8sClusterConfig["flavor"],
                  );
                }}
              />
              {isOvn ? (
                <>
                  <Input
                    type="text"
                    label="OVN network"
                    value={config.ovnNetwork}
                    help="Name of the OVN network the instances use."
                    onChange={(e) => {
                      update("ovnNetwork", e.target.value);
                    }}
                  />
                  <Input
                    type="text"
                    label="Load balancer address"
                    value={config.ovnLoadBalancerAddress}
                    help="A free IP address in the OVN uplink network."
                    onChange={(e) => {
                      update("ovnLoadBalancerAddress", e.target.value);
                    }}
                  />
                </>
              ) : (
                <Select
                  label="Load balancer"
                  value={config.loadBalancer}
                  options={loadBalancerOptions}
                  onChange={(e) => {
                    update(
                      "loadBalancer",
                      e.target.value as K8sClusterConfig["loadBalancer"],
                    );
                  }}
                />
              )}
            </>
          ) : null}

          {active === MACHINES ? (
            <>
              <h2 className="p-heading--4">Machines</h2>
              <Row>
                <Col size={4}>
                  <Input
                    type="number"
                    min={1}
                    label="Control plane count"
                    value={config.controlPlaneCount}
                    onChange={(e) => {
                      update("controlPlaneCount", Number(e.target.value));
                    }}
                  />
                </Col>
                <Col size={4}>
                  <Input
                    type="number"
                    min={0}
                    label="Worker count"
                    value={config.workerCount}
                    onChange={(e) => {
                      update("workerCount", Number(e.target.value));
                    }}
                  />
                </Col>
              </Row>
              <Row>
                <Col size={4}>
                  <Select
                    label="Control plane type"
                    value={config.controlPlaneType}
                    options={machineTypeOptions}
                    onChange={(e) => {
                      update(
                        "controlPlaneType",
                        e.target.value as K8sClusterConfig["controlPlaneType"],
                      );
                    }}
                  />
                </Col>
                <Col size={4}>
                  <Select
                    label="Worker type"
                    value={config.workerType}
                    options={machineTypeOptions}
                    onChange={(e) => {
                      update(
                        "workerType",
                        e.target.value as K8sClusterConfig["workerType"],
                      );
                    }}
                  />
                </Col>
              </Row>
              <Row>
                <Col size={4}>
                  <Input
                    type="text"
                    label="Control plane flavor"
                    value={config.controlPlaneFlavor}
                    help="Instance size, e.g. c2-m4."
                    onChange={(e) => {
                      update("controlPlaneFlavor", e.target.value);
                    }}
                  />
                </Col>
                <Col size={4}>
                  <Input
                    type="text"
                    label="Worker flavor"
                    value={config.workerFlavor}
                    help="Instance size, e.g. c2-m4."
                    onChange={(e) => {
                      update("workerFlavor", e.target.value);
                    }}
                  />
                </Col>
              </Row>
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
              {!isOvn ? (
                <>
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
                </>
              ) : null}
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
                <code>{config.secretName}</code>. The client certificate must be
                trusted on the Incus server.
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

          {active === AGENT ? <K8sAgentPanel config={config} /> : null}

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
    </BaseLayout>
  );
};

export default Kubernetes;
