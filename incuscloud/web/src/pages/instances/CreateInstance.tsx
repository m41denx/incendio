import { type FC, type FormEvent, type ReactNode, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ActionButton, Button, CheckboxInput, Form, Input, RadioInput, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loading } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { CreateInstanceRequest, ImageChoice, Job, Tenant, TenantPlacement, TenantRole, TenantUsage } from "../../api/types";

const NAME = /^[a-zA-Z][a-zA-Z0-9-]{0,62}$/;
const OTHER = "__other";
const CREATORS: TenantRole[] = ["owner", "admin", "member"];
const GIB = 1024 ** 3;

/** Whole numbers from lo to hi, written as digits. */
const whole = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && +s >= lo && +s <= hi;
/** Numbers from lo to hi, as typed. */
const decimal = (s: string, lo: number, hi: number) => s.trim() !== "" && Number.isFinite(+s) && +s >= lo && +s <= hi;

/** "key=value, key=value" as labels; null when a part has no key or no "=". */
function parseLabels(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    const key = part.slice(0, Math.max(eq, 0)).trim();
    if (eq < 0 || !key) return null;
    out[key] = part.slice(eq + 1).trim();
  }
  return out;
}

const page = (children: ReactNode) => <PageLayout title="Create instance">{children}</PageLayout>;

/** A tenant member creates an instance: IncusCloud picks the cluster, or the caller names one. */
const CreateInstance: FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const { data: me, error: meError } = useMe();
  const operator = can(me, "operator");
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants"), enabled: operator });

  const choices: Array<{ id: string; slug: string; name: string }> = operator
    ? (tenants.data ?? [])
    : (me?.tenants ?? []).filter((t) => CREATORS.includes(t.role));
  const [picked, setPicked] = useState(params.get("tenant") ?? "");
  const tenantId = choices.some((t) => t.id === picked) ? picked : (choices[0]?.id ?? "");

  const usage = useQuery({ queryKey: ["tenants", tenantId, "usage"], queryFn: () => request<TenantUsage>("GET", `/api/v1/tenants/${tenantId}/usage`), enabled: !!tenantId });
  const placements = useQuery({ queryKey: ["tenants", tenantId, "placements"], queryFn: () => request<TenantPlacement[]>("GET", `/api/v1/tenants/${tenantId}/placements`), enabled: !!tenantId });
  const images = useQuery({ queryKey: ["images"], queryFn: () => request<ImageChoice[]>("GET", "/api/v1/images"), enabled: !!tenantId });

  const [name, setName] = useState("");
  const [imagePick, setImagePick] = useState("");
  const [alias, setAlias] = useState("");
  const [kind, setKind] = useState<"container" | "virtual-machine">("container");
  const [cpu, setCpu] = useState("1");
  const [memory, setMemory] = useState("1");
  const [disk, setDisk] = useState("10");
  const [where, setWhere] = useState<"auto" | "cluster">("auto");
  const [clusterPick, setClusterPick] = useState("");
  const [labelText, setLabelText] = useState("");
  const [start, setStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const imageList = images.data ?? [];
  const knownPick = imagePick === OTHER || imageList.some((i) => i.alias === imagePick);
  const image = knownPick ? imagePick : (imageList[0]?.alias ?? OTHER);
  const vmOk = imageList.find((i) => i.alias === image)?.vm ?? true;
  const type = vmOk ? kind : "container";
  const readyPlacements = (placements.data ?? []).filter((p) => p.status === "ready");
  const clusterId = readyPlacements.some((p) => p.clusterId === clusterPick) ? clusterPick : (readyPlacements[0]?.clusterId ?? "");
  const labels = parseLabels(labelText);
  const imageAlias = image === OTHER ? alias.trim() : image;
  const valid =
    NAME.test(name) &&
    imageAlias !== "" &&
    whole(cpu, 1, 64) &&
    decimal(memory, 0.125, 1024) &&
    whole(disk, 1, 4096) &&
    (where === "cluster" ? clusterId !== "" : labels !== null);

  const pickImage = (next: string) => {
    setImagePick(next);
    if (imageList.find((i) => i.alias === next)?.vm === false) setKind("container");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Enter in a field submits even when the button is only aria-disabled.
    if (!valid || busy) return;
    const body: CreateInstanceRequest = {
      name,
      image: imageAlias,
      cpu: Number(cpu),
      memoryGiB: Number(memory),
      diskGiB: Number(disk),
      start,
      ...(type === "virtual-machine" && { type: "virtual-machine" as const }),
      ...(where === "cluster" && { clusterId }),
      ...(where === "auto" && labels && Object.keys(labels).length > 0 && { labels }),
    };
    setBusy(true);
    setError(null);
    try {
      const job = await request<Job>("POST", `/api/v1/tenants/${tenantId}/instances`, body);
      void qc.invalidateQueries({ queryKey: ["tenants", tenantId, "usage"] });
      void qc.invalidateQueries({ queryKey: ["instances"] });
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const loadError = meError ?? (operator ? tenants.error : null) ?? images.error;
  if (loadError) return page(<ErrorMessage error={loadError} />);
  if (!me || (operator && tenants.isPending)) return page(<Loading />);
  if (choices.length === 0) return page(<p>You are not a member of any tenant that can create instances.</p>);
  if (images.isPending) return page(<Loading />);

  const quota = usage.data?.quota ?? {};
  const used = usage.data?.used;
  const left: string[] = [];
  // What is left of each key; past the quota, none, and by how much it is over.
  const leftOf = (n: number, what: string, fmt: (x: number) => string, unit = "") => (n >= 0 ? `${fmt(n)} ${unit}${what}` : `no ${what} (${fmt(-n)}${unit ? ` ${unit.trim()}` : ""} over)`);
  const count = (x: number) => String(x);
  const gib = (x: number) => x.toFixed(1);
  if (used && quota.instances != null) left.push(leftOf(quota.instances - used.instances, "instances", count));
  if (used && quota.cpu != null) left.push(leftOf(quota.cpu - used.cpu, "CPUs", count));
  if (used && quota.memory != null) left.push(leftOf(quota.memory - used.memory / GIB, "memory", gib, "GiB "));
  if (used && quota.disk != null) left.push(leftOf(quota.disk - used.disk / GIB, "disk", gib, "GiB "));

  return page(
    <Form className="ic-form-page" onSubmit={submit}>
      <Select id="create-tenant" label="Tenant" value={tenantId} onChange={(e) => setPicked(e.target.value)} options={choices.map((t) => ({ value: t.id, label: `${t.name} (${t.slug})` }))} />
      <Input
        id="create-name"
        label="Name"
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={name !== "" && !NAME.test(name) ? "Letters, digits and dashes; starts with a letter." : undefined}
      />
      <Select
        id="create-image"
        label="Image"
        value={image}
        onChange={(e) => pickImage(e.target.value)}
        options={[...imageList.map((i) => ({ value: i.alias, label: i.label })), { value: OTHER, label: "Other…" }]}
      />
      {image === OTHER ? (
        <Input id="create-alias" label="Image alias" type="text" required value={alias} onChange={(e) => setAlias(e.target.value)} help="An alias on the image server, e.g. debian/12/cloud." />
      ) : null}
      <fieldset>
        <legend>Type</legend>
        <RadioInput label="Container" name="create-type" checked={type === "container"} onChange={() => setKind("container")} />
        <RadioInput label="Virtual machine" name="create-type" checked={type === "virtual-machine"} disabled={!vmOk} onChange={() => setKind("virtual-machine")} />
      </fieldset>
      <Input
        id="create-cpu"
        label="CPUs"
        type="number"
        min={1}
        max={64}
        step={1}
        required
        value={cpu}
        onChange={(e) => setCpu(e.target.value)}
        error={cpu !== "" && !whole(cpu, 1, 64) ? "Whole number from 1 to 64." : undefined}
      />
      <Input
        id="create-memory"
        label="Memory (GiB)"
        type="number"
        min={0.125}
        max={1024}
        step="any"
        required
        value={memory}
        onChange={(e) => setMemory(e.target.value)}
        error={memory !== "" && !decimal(memory, 0.125, 1024) ? "From 0.125 to 1024." : undefined}
      />
      <Input
        id="create-disk"
        label="Disk (GiB)"
        type="number"
        min={1}
        max={4096}
        step={1}
        required
        value={disk}
        onChange={(e) => setDisk(e.target.value)}
        error={disk !== "" && !whole(disk, 1, 4096) ? "Whole number from 1 to 4096." : undefined}
      />
      <fieldset>
        <legend>Where</legend>
        <RadioInput label="Let IncusCloud choose" name="create-where" checked={where === "auto"} onChange={() => setWhere("auto")} />
        <RadioInput label="On a cluster" name="create-where" checked={where === "cluster"} onChange={() => setWhere("cluster")} />
      </fieldset>
      {where === "cluster" ? (
        <Select
          id="create-cluster"
          label="Cluster"
          value={clusterId}
          onChange={(e) => setClusterPick(e.target.value)}
          options={readyPlacements.map((p) => ({ value: p.clusterId, label: p.clusterName }))}
          help={readyPlacements.length ? undefined : "This tenant has no ready cluster."}
        />
      ) : (
        <Input
          id="create-labels"
          label="Only clusters labelled"
          type="text"
          value={labelText}
          onChange={(e) => setLabelText(e.target.value)}
          help="e.g. region=eu, tier=gold"
          error={labels === null ? "Write key=value pairs separated by commas." : undefined}
        />
      )}
      <CheckboxInput label="Start it once created" checked={start} onChange={() => setStart(!start)} />

      {usage.error ? <ErrorMessage error={usage.error} title="Quota not loaded" /> : null}
      {usage.data && Object.keys(quota).length === 0 ? <p className="u-text--muted">The tenant has no quota.</p> : null}
      {left.length ? <p className="u-text--muted">{`Left in the tenant's quota: ${left.join(", ")}`}</p> : null}
      {error ? <ErrorMessage error={error} title="Not created" /> : null}
      <div>
        <ActionButton type="submit" appearance="positive" loading={busy} disabled={!valid || busy}>
          Create
        </ActionButton>{" "}
        <Button type="button" appearance="base" onClick={() => navigate("/instances")}>
          Cancel
        </Button>
      </div>
    </Form>,
  );
};

export default CreateInstance;
