import { type FC, useState } from "react";
import { CheckboxInput, Select } from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "../../api/client";
import FormModal from "../../components/FormModal";
import {
  GIVABLE,
  useAclRoles,
  useClusterNames,
  useSubjects,
  useTenantList,
} from "./usePermissions";

type Kind = "root" | "cluster" | "tenant";

/** Adds an explicit entry. `fixedPath` (a tenant's or cluster's Access tab) skips the path choice. */
const AddEntryModal: FC<{ onClose: () => void; fixedPath?: string }> = ({
  onClose,
  fixedPath,
}) => {
  const qc = useQueryClient();
  const roles = useAclRoles().data ?? [];
  const subjects = useSubjects();
  const clusters = useClusterNames().data ?? [];
  const tenants = useTenantList().data ?? [];
  const [kind, setKind] = useState<Kind>("root");
  const [object, setObject] = useState("");
  const [subject, setSubject] = useState("");
  const [role, setRole] = useState("");
  const [propagate, setPropagate] = useState(true);

  const onTenant = fixedPath ? fixedPath.startsWith("/tenants/") : kind === "tenant";
  const path =
    fixedPath ??
    (kind === "root"
      ? "/"
      : object
        ? `/${kind === "cluster" ? "clusters" : "tenants"}/${object}`
        : "");
  const submit = async () => {
    const [type, id] = subject.split(":");
    await request("POST", "/api/v1/acl/entries", {
      path,
      subject: { type, id },
      role,
      propagate,
    });
    await qc.invalidateQueries({ queryKey: ["acl"] });
  };
  const choose = (label: string) => [{ value: "", label, disabled: true }];

  return (
    <FormModal
      title="Add entry"
      submitLabel="Add"
      onSubmit={submit}
      onClose={onClose}
      submitDisabled={!path || !subject || !role}
    >
      {fixedPath ? null : (
        <>
          <Select
            id="acl-kind"
            label="Applies to"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setObject("");
              if (role === "unrestricted-user") setRole("");
            }}
            options={[
              { value: "root", label: "Everything" },
              { value: "cluster", label: "A cluster" },
              { value: "tenant", label: "A tenant" },
            ]}
          />
          {kind === "cluster" ? (
            <Select
              id="acl-cluster"
              label="Cluster"
              value={object}
              onChange={(e) => setObject(e.target.value)}
              options={[
                ...choose("Choose a cluster"),
                ...clusters.map((c) => ({ value: c.name, label: c.name })),
              ]}
            />
          ) : null}
          {kind === "tenant" ? (
            <Select
              id="acl-tenant"
              label="Tenant"
              value={object}
              onChange={(e) => setObject(e.target.value)}
              options={[
                ...choose("Choose a tenant"),
                ...tenants.map((t) => ({ value: t.slug, label: t.name })),
              ]}
            />
          ) : null}
        </>
      )}
      <Select
        id="acl-subject"
        label="Subject"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        options={[...choose("Choose a user or service account"), ...subjects]}
      />
      <Select
        id="acl-role"
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        options={[
          ...choose("Choose a role"),
          // Unrestricted user on a cluster or / would reach every tenant's projects: tenants only for now.
          ...roles
            .filter((r) => GIVABLE.includes(r.id) && (r.id !== "unrestricted-user" || onTenant))
            .map((r) => ({ value: r.id, label: r.name })),
        ]}
        help="Administrator and Cluster owner can only be given by administrators."
      />
      {role === "cluster-owner" ? (
        <p className="p-form-help-text is-caution">
          Cluster owner is root on that cluster's hosts (Incus server admin). Give it only to people who already run those machines, never to a tenant.
        </p>
      ) : null}
      {!fixedPath && kind === "cluster" ? (
        <p className="p-form-help-text">Tenant roles still apply on the tenant's projects on this cluster: an entry here does not limit a tenant's members there.</p>
      ) : null}
      <CheckboxInput
        label="Also applies below this path"
        checked={propagate}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setPropagate(e.target.checked)
        }
      />
    </FormModal>
  );
};

export default AddEntryModal;
