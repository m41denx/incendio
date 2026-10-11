import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input, Textarea } from "@canonical/react-components";
import { useQueryClient } from "@tanstack/react-query";
import FormModal from "../../components/FormModal";
import { request } from "../../api/client";
import type { Cluster } from "../../api/types";
import { parseLabels } from "./labels";

const NAME = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

const EnrolCluster: FC<{ onClose: () => void }> = ({ onClose }) => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [labels, setLabels] = useState("");
  let labelError: string | undefined;
  try {
    parseLabels(labels);
  } catch (e) {
    labelError = (e as Error).message;
  }
  const submit = async () => {
    const c = await request<Cluster>("POST", "/api/v1/clusters", { name, token: token.trim(), labels: parseLabels(labels) });
    await qc.invalidateQueries({ queryKey: ["clusters"] });
    navigate(`/clusters/${c.id}`);
  };
  return (
    <FormModal title="Enrol a cluster" submitLabel="Enrol" onSubmit={submit} onClose={onClose} submitDisabled={!NAME.test(name) || !token.trim() || !!labelError}>
      <p>On any member of the cluster, create a trust token for IncusCloud and paste it below:</p>
      <pre className="ic-mono">incus config trust add incuscloud --quiet</pre>
      <p className="ic-muted">IncusCloud reaches the cluster on the addresses in the token, checks its certificate against the token, and then configures it (sign-in through IncusCloud, permissions, tenant projects).</p>
      <Input
        id="cluster-name"
        label="Name"
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        help="Lowercase letters, digits and dashes. Also its host name for API clients."
        error={name && !NAME.test(name) ? "Lowercase letters, digits and dashes; starts with a letter" : undefined}
      />
      <Textarea id="cluster-token" label="Trust token" required rows={3} value={token} onChange={(e) => setToken(e.target.value)} className="ic-mono" />
      <Textarea id="cluster-labels" label="Labels" rows={2} value={labels} onChange={(e) => setLabels(e.target.value)} help="Optional, key=value per line." error={labelError} />
    </FormModal>
  );
};

export default EnrolCluster;
