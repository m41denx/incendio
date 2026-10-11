import { type FC, useState } from "react";
import { Input } from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { request } from "../../api/client";
import type { BackupTarget } from "../../api/types";

const NAME = /^[a-zA-Z][a-zA-Z0-9-]{0,62}$/;

interface Fields {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretKey: string;
}

/** Add or edit a backup target. The secret key is never shown; on edit, leaving it empty keeps it. */
const TargetForm: FC<{ target?: BackupTarget; onClose: () => void }> = ({ target, onClose }) => {
  const qc = useQueryClient();
  const [f, setF] = useState<Fields>({
    name: "",
    endpoint: target?.endpoint ?? "",
    region: target?.region ?? "",
    bucket: target?.bucket ?? "",
    prefix: target?.prefix ?? "",
    accessKeyId: target?.accessKeyId ?? "",
    secretKey: "",
  });
  const set = (k: keyof Fields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const endpointOk = /^https?:\/\/\S/.test(f.endpoint.trim());
  const bucketOk = f.bucket.trim().length >= 3;
  const nameOk = target !== undefined || NAME.test(f.name.trim());
  const valid = nameOk && endpointOk && bucketOk && !!f.accessKeyId.trim() && (target !== undefined || !!f.secretKey);

  const submit = async () => {
    if (target) {
      // Only what changed; an empty secret key keeps the stored one.
      const body: Record<string, string> = {};
      const trimmed = { endpoint: f.endpoint.trim(), region: f.region.trim(), bucket: f.bucket.trim(), prefix: f.prefix.trim(), accessKeyId: f.accessKeyId.trim() };
      for (const k of Object.keys(trimmed) as (keyof typeof trimmed)[]) {
        if (trimmed[k] !== (target[k] ?? "")) body[k] = trimmed[k];
      }
      if (f.secretKey) body.secretKey = f.secretKey;
      if (Object.keys(body).length) await request("PATCH", `/api/v1/backup-targets/${target.id}`, body);
    } else {
      const body: Record<string, string> = {
        name: f.name.trim(),
        endpoint: f.endpoint.trim(),
        bucket: f.bucket.trim(),
        accessKeyId: f.accessKeyId.trim(),
        secretKey: f.secretKey,
      };
      if (f.region.trim()) body.region = f.region.trim();
      if (f.prefix.trim()) body.prefix = f.prefix.trim();
      await request("POST", "/api/v1/backup-targets", body);
    }
    await qc.invalidateQueries({ queryKey: ["backup-targets"] });
  };

  return (
    <FormModal
      title={target ? `Edit ${target.name}` : "Add a backup target"}
      submitLabel={target ? "Save" : "Add"}
      onSubmit={submit}
      onClose={onClose}
      submitDisabled={!valid}
    >
      {target ? null : (
        <Input
          id="target-name"
          label="Name"
          type="text"
          required
          value={f.name}
          onChange={set("name")}
          help="Letters, digits and dashes. Tenants see it when they choose a target."
          error={f.name && !NAME.test(f.name.trim()) ? "Letters, digits and dashes; starts with a letter" : undefined}
        />
      )}
      <Input
        id="target-endpoint"
        label="Endpoint"
        type="text"
        required
        placeholder="https://s3.example.com"
        value={f.endpoint}
        onChange={set("endpoint")}
        error={f.endpoint && !endpointOk ? "Starts with http:// or https://" : undefined}
      />
      <Input id="target-region" label="Region" type="text" value={f.region} onChange={set("region")} help="Empty for most S3-compatible stores" />
      <Input
        id="target-bucket"
        label="Bucket"
        type="text"
        required
        value={f.bucket}
        onChange={set("bucket")}
        error={f.bucket && !bucketOk ? "At least 3 characters" : undefined}
      />
      <Input id="target-prefix" label="Prefix" type="text" value={f.prefix} onChange={set("prefix")} help="Keys start with this path" />
      <Input id="target-access-key" label="Access key ID" type="text" required value={f.accessKeyId} onChange={set("accessKeyId")} className="ic-mono" />
      <Input
        id="target-secret-key"
        label="Secret key"
        type="password"
        required={target === undefined}
        autoComplete="new-password"
        value={f.secretKey}
        onChange={set("secretKey")}
        help={target ? "Leave empty to keep the current one" : undefined}
      />
    </FormModal>
  );
};

export default TargetForm;
