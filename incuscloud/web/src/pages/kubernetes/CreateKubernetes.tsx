import { type FC, type FormEvent, type ReactNode, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ActionButton, Button, Form, Input, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { request } from "../../api/client";
import { can, useConsoleMembers, useMe } from "../../api/hooks";
import type { CreateK8sRequest, K8sCluster, K8sSize, Tenant, TenantPlacement, TenantRole } from "../../api/types";
import { sizeLabel, useK8sOptions } from "./hooks";
import { clusterOf, nameOf } from "../inventory/tree";

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

  const ready = (placements.data ?? []).filter((p) => p.status === "ready");
  const clusterId = ready.some((p) => p.clusterId === clusterPick) ? clusterPick : (ready[0]?.clusterId ?? "");
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
      navigate(`/kubernetes/${r.cluster.id}`);
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

  return page(
    <Form className="ic-form-page" onSubmit={submit}>
      <Select id="k8s-tenant" label="Tenant" value={tenantId} onChange={(e) => setPicked(e.target.value)} options={choices.map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }))} />
      <Select
        id="k8s-cluster"
        label="Incus cluster"
        value={clusterId}
        onChange={(e) => setClusterPick(e.target.value)}
        options={ready.map((p) => ({ value: p.clusterId, label: p.clusterName }))}
        help={
          placements.isPending
            ? "Loading…"
            : ready.length
              ? "The Incus clusters this tenant is placed on (and ready); its nodes run in the tenant's project there. Place the tenant on more clusters from its page."
              : "This tenant has no ready Incus cluster: place it on one from its page."
        }
      />
      {members.length > 1 ? (
        <Select
          id="k8s-member"
          label="Node"
          value={member}
          onChange={(e) => setMemberPick(e.target.value)}
          options={[
            { value: "", label: "Automatic (most memory free)" },
            ...members.map((m) => ({ value: nameOf(m.server_name), label: m.status === "Online" ? nameOf(m.server_name) : `${nameOf(m.server_name)} (${m.status})`, disabled: m.status !== "Online" })),
          ]}
          help="The load balancer and every node run on this member of the Incus cluster: without OVN networking, each member's bridge is its own network."
        />
      ) : null}
      <Input
        id="k8s-name"
        label="Name"
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={name !== "" && !NAME.test(name) ? "Lowercase letters, digits and dashes; starts with a letter; up to 32." : undefined}
      />
      <Select id="k8s-version" label="Kubernetes version" value={version} onChange={(e) => setVersionPick(e.target.value)} options={versions.map((v) => ({ value: v, label: v }))} />
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
      <Input
        id="k8s-workers"
        label="Worker nodes"
        type="number"
        min={0}
        max={MAX_WORKERS}
        step={1}
        required
        value={workers}
        onChange={(e) => setWorkers(e.target.value)}
        error={workers !== "" && !whole(workers, 0, MAX_WORKERS) ? `Whole number from 0 to ${MAX_WORKERS}.` : undefined}
      />
      <Select
        id="k8s-size"
        label="Node size"
        value={size}
        onChange={(e) => setSize(e.target.value as K8sSize)}
        options={(Object.keys(opts.sizes) as K8sSize[]).map((k) => ({ value: k, label: sizeLabel(opts, k) }))}
      />
      <p className="u-text--muted">{usage}</p>
      {error ? <ErrorMessage error={error} title="Not created" /> : null}
      <div>
        <ActionButton type="submit" appearance="positive" loading={busy} disabled={!valid || busy}>
          Create
        </ActionButton>{" "}
        <Button type="button" appearance="base" onClick={() => navigate("/kubernetes")}>
          Cancel
        </Button>
      </div>
    </Form>,
  );
};

export default CreateKubernetes;
