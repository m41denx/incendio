import { type FC, useState } from "react";
import { Input, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { request } from "../../api/client";
import { can, tenantRole, useMe } from "../../api/hooks";
import type { Me, PlatformRole, ServiceAccountSecret, Tenant } from "../../api/types";
import { PLATFORM_ROLE_OPTIONS } from "../users/roles";

export const tenantsQuery = { queryKey: ["tenants"], queryFn: () => request<Tenant[]>("GET", "/api/v1/tenants") };

/** Platform admins, and owners or admins of at least one tenant, may create service accounts. */
export const canCreate = (me: Me | undefined) => can(me, "admin") || !!me?.tenants.some((t) => t.role === "owner" || t.role === "admin");

const PLATFORM = "platform";
const ROLE_OPTIONS = PLATFORM_ROLE_OPTIONS.filter((o) => o.value !== "");

interface Props {
  /** The `?tenant=` filter of the list, preselected when it is a tenant the caller may manage. */
  tenant?: string;
  onCreated: (secret: ServiceAccountSecret) => void;
  onClose: () => void;
}

const CreateServiceAccount: FC<Props> = ({ tenant = "", onCreated, onClose }) => {
  const { data: me } = useMe();
  const tenants = useQuery(tenantsQuery);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [platformRole, setPlatformRole] = useState<PlatformRole>("viewer");
  const platformAdmin = can(me, "admin");
  const options = [
    ...(tenants.data ?? [])
      .filter((t) => platformAdmin || tenantRole(me, t.id) === "owner" || tenantRole(me, t.id) === "admin")
      .map((t) => ({ value: t.id, label: t.name })),
    ...(platformAdmin ? [{ value: PLATFORM, label: "Platform (no tenant)" }] : []),
  ];
  const preferred = options.some((o) => o.value === tenant) ? tenant : (options[0]?.value ?? "");
  const chosen = target ?? preferred;

  const submit = async () => {
    const body = chosen === PLATFORM ? { name: name.trim(), platformRole } : { name: name.trim(), tenantId: chosen };
    const secret = await request<ServiceAccountSecret>("POST", "/api/v1/service-accounts", body);
    onCreated(secret);
    await qc.invalidateQueries({ queryKey: ["service-accounts"] });
  };

  return (
    <FormModal title="Create service account" submitLabel="Create" onSubmit={submit} onClose={onClose} submitDisabled={!name.trim() || !chosen}>
      <Input id="sa-name" label="Name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
      <Select id="sa-for" label="For" options={options} value={chosen} onChange={(e) => setTarget(e.target.value)} />
      {chosen === PLATFORM ? (
        <Select
          id="sa-platform-role"
          label="Platform role"
          options={ROLE_OPTIONS}
          value={platformRole}
          onChange={(e) => setPlatformRole(e.target.value as PlatformRole)}
        />
      ) : null}
    </FormModal>
  );
};

export default CreateServiceAccount;
