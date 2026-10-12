import { type FC, type FormEvent, type ReactNode, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ActionButton, Button, Col, Form, Input, Row, Select } from "@canonical/react-components";
import FormMenuItem from "@incendio/ui/components/forms/FormMenuItem";
import FormFooterLayout from "@incendio/ui/components/forms/FormFooterLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { request } from "../../api/client";
import { can, useConsoleMembers, useMe } from "../../api/hooks";
import type { Cluster, CreateK8sRequest, K8sCluster, K8sSize, Tenant, TenantPlacement, TenantRole } from "../../api/types";
import { sizeLabel, useK8sOptions } from "./hooks";
import { clusterOf, nameOf } from "../inventory/tree";
import { k8sPath } from "./KubernetesList";

/** The form's sections, as Incendio's create forms: where and what, then the nodes. */
const CLUSTER = "Cluster";
const NODES = "Nodes";

/** A DNS label CAPI can build instance names from. */
const NAME = /^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$/;
const CREATORS: TenantRole[] = ["owner", "admin", "member"];
const MAX_WORKERS = 20;
/** Each node and the load balancer get the default profile's 10 GiB root disk. */
const DISK_GIB = 10;
const LB = { cpu: 1, memoryGiB: 1 };

const whole = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && +s >= lo && +s <= hi;
const page = (children: ReactNode) => <PageLayout title="Create Kubernetes cluster">{children}</PageLayout>;

/** A tenant member creates a Kubernetes cluster on one of the tenant's Incus clusters. */
const CreateKubernetes: FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data: me, error: meError } = useMe();
  const options = useK8sOptions();
  const operator = can(me, "operator");
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"), enabled: operator });
  const choices: Array<{ id: string; slug: string; name: string }> = operator ? (tenants.data ?? []) : (me?.tenants ?? []).filter((t) => CREATORS.includes(t.role));
  const [picked, setPicked] = useState(params.get("tenant") ?? "");
  const tenantId = choices.some((t) => t.id === picked) ? picked : (choices[0]?.id ?? "");
  const placements = useQuery({ queryKey: ["tenants", tenantId, "placements"], queryFn: () => request<TenantPlacement[]>("GET", `/api/v1/tenants/${tenantId}/placements`), enabled: !!tenantId });
  // Operators create on any ready cluster; one the tenant is not on places it there first.
  const allClusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters"), enabled: operator });

  const [section, setSection] = useState(CLUSTER);
  const [clusterPick, setClusterPick] = useState("");
  const [memberPick, setMemberPick] = useState("");
  // Every cluster's members, through the console's API (name@cluster).
  const { data: allMembers = [] } = useConsoleMembers();
  const [name, setName] = useState("");
  const [versionPick, setVersionPick] = useState("");
  const [controlPlanes, setControlPlanes] = useState<1 | 3>(1);
  const [workers, setWorkers] = useState("1");
  const [size, setSize] = useState<K8sSize>("small");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
  const members = allMembers.filter((m) => clusterOf(m.server_name) === clusterName).sort((a, b) => a.server_name.localeCompare(b.server_name));
  const member = members.length > 1 && members.some((m) => nameOf(m.server_name) === memberPick && m.status === "Online") ? memberPick : "";
  const versions = options.data?.versions ?? [];
  const version = versions.includes(versionPick) ? versionPick : (versions.at(-1) ?? "");
  const valid = !!tenantId && !!clusterId && NAME.test(name) && !!version && whole(workers, 0, MAX_WORKERS);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    const body: CreateK8sRequest = { tenantId, clusterId, name, version, controlPlanes, workers: Number(workers), size, ...(member ? { member } : {}) };
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ cluster: K8sCluster }>("POST", "/api/v1/kubernetes", body);
      void qc.invalidateQueries({ queryKey: ["kubernetes"] });
      navigate(k8sPath(r.cluster));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const loadError = meError ?? options.error ?? (operator ? tenants.error : null);
  if (loadError) return page(<ErrorMessage error={loadError} />);
  if (!me || !options.data || (operator && tenants.isPending)) return page(<Loading />);
  if (!options.data.enabled) return page(<p>Kubernetes is not enabled on this IncusCloud.</p>);
  if (choices.length === 0) return page(<p>You are not a member of any tenant that can create Kubernetes clusters.</p>);

  // What the cluster takes from the quota: its nodes and its load balancer.
  const opts = options.data;
  const s = opts.sizes[size];
  const nodes = controlPlanes + (whole(workers, 0, MAX_WORKERS) ? Number(workers) : 0);
  const usage = `Uses ${nodes + 1} instances, ${nodes * s.cpu + LB.cpu} CPUs, ${nodes * s.memoryGiB + LB.memoryGiB} GiB of memory and ${(nodes + 1) * DISK_GIB} GiB of disk of the tenant's quota, with its load balancer.`;

  const nameError = name !== "" && !NAME.test(name) ? "Lowercase letters, digits and dashes; starts with a letter; up to 32." : undefined;
  const workersError = workers !== "" && !whole(workers, 0, MAX_WORKERS) ? `Whole number from 0 to ${MAX_WORKERS}.` : undefined;

  return (
    <PageLayout title="Create Kubernetes cluster">
      <Form className="ic-k8s-create" onSubmit={submit}>
        <div className="form">
          <div className="p-side-navigation--accordion form-navigation">
            <nav aria-label="Kubernetes form navigation">
              <ul className="p-side-navigation__list">
                <FormMenuItem label={CLUSTER} active={section} setActive={setSection} hasError={!!nameError || !clusterId} />
                <FormMenuItem label={NODES} active={section} setActive={setSection} hasError={!!workersError} />
              </ul>
            </nav>
          </div>
          <Row className="form-contents">
            <Col size={12}>
              {section === CLUSTER ? (
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
                  {members.length > 1 ? (
                    <Select
                      id="k8s-member"
                      label="Member"
                      value={member}
                      onChange={(e) => setMemberPick(e.target.value)}
                      options={[
                        { value: "", label: "Automatic (most memory free)" },
                        ...members.map((m) => ({ value: nameOf(m.server_name), label: m.status === "Online" ? nameOf(m.server_name) : `${nameOf(m.server_name)} (${m.status})`, disabled: m.status !== "Online" })),
                      ]}
                      help="The load balancer and every node run on this member of the Incus cluster: without OVN networking, each member's bridge is its own network."
                    />
                  ) : null}
                  <Input id="k8s-name" label="Name" type="text" required value={name} onChange={(e) => setName(e.target.value)} error={nameError} />
                  <Select id="k8s-version" label="Kubernetes version" value={version} onChange={(e) => setVersionPick(e.target.value)} options={versions.map((v) => ({ value: v, label: v }))} />
                </>
              ) : (
                <>
                  <h2 className="p-heading--4">Nodes</h2>
                  <Select
                    id="k8s-control-planes"
                    label="Control plane nodes"
                    value={String(controlPlanes)}
                    onChange={(e) => setControlPlanes(e.target.value === "3" ? 3 : 1)}
                    options={[
                      { value: "1", label: "1" },
                      { value: "3", label: "3" },
                    ]}
                    help="3 keeps the control plane available when one node fails."
                  />
                  <Input id="k8s-workers" label="Worker nodes" type="number" min={0} max={MAX_WORKERS} step={1} required value={workers} onChange={(e) => setWorkers(e.target.value)} error={workersError} />
                  <Select
                    id="k8s-size"
                    label="Node size"
                    value={size}
                    onChange={(e) => setSize(e.target.value as K8sSize)}
                    options={(Object.keys(opts.sizes) as K8sSize[]).map((k) => ({ value: k, label: sizeLabel(opts, k) }))}
                  />
                </>
              )}
              <p className="u-text--muted">{usage}</p>
              {error ? <ErrorMessage error={error} title="Not created" /> : null}
            </Col>
          </Row>
        </div>
        <FormFooterLayout>
          <Button type="button" appearance="base" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <ActionButton type="submit" appearance="positive" loading={busy} disabled={!valid || busy}>
            Create
          </ActionButton>
        </FormFooterLayout>
      </Form>
    </PageLayout>
  );
};

export default CreateKubernetes;
