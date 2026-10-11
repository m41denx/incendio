import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input, Select } from "@canonical/react-components";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { request } from "../../api/client";
import type { Tenant, User } from "../../api/types";
import { QuotaFields, type QuotaDraft, draftOf, draftValid, quotasOf } from "./quotas";

const SLUG = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

const CreateTenant: FC<{ onClose: () => void }> = ({ onClose }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const users = useQuery({ queryKey: ["users"], queryFn: () => request<User[]>("GET", "/api/v1/users") });
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [quotas, setQuotas] = useState<QuotaDraft>(draftOf({}));
  const submit = async () => {
    const t = await request<Tenant>("POST", "/api/v1/tenants", { slug, name, quotas: quotasOf(quotas), ...(owner && { ownerId: owner }) });
    await qc.invalidateQueries({ queryKey: ["tenants"] });
    navigate(`/tenants/${t.id}`);
  };
  return (
    <FormModal title="Create tenant" submitLabel="Create" onSubmit={submit} onClose={onClose} submitDisabled={!SLUG.test(slug) || !name || !draftValid(quotas)}>
      <Input
        id="tenant-slug"
        label="Slug"
        type="text"
        required
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        help="Its project name on every cluster. Lowercase letters, digits and dashes; cannot be changed."
        error={slug && !SLUG.test(slug) ? "3–32 lowercase letters, digits and dashes, starting with a letter" : undefined}
      />
      <Input id="tenant-name" label="Name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
      <Select
        id="tenant-owner"
        label="Owner"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        options={[{ value: "", label: "Nobody yet" }, ...(users.data ?? []).filter((u) => !u.disabled).map((u) => ({ value: u.id, label: `${u.name} <${u.email}>` }))]}
        help="Owners manage the tenant's members and service accounts."
      />
      <h3 className="p-heading--5">Quotas</h3>
      <QuotaFields value={quotas} onChange={setQuotas} />
    </FormModal>
  );
};

export default CreateTenant;
