import { type FC, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Select } from "@canonical/react-components";
import FormModal from "../../components/FormModal";
import { request } from "../../api/client";
import type { Job } from "../../api/types";

type Mode = "auto" | "migrate" | "live-migrate" | "stop";

const MODES: Array<{ value: Mode; label: string }> = [
  { value: "auto", label: "Cluster default (cluster.evacuate)" },
  { value: "migrate", label: "Move instances" },
  { value: "live-migrate", label: "Move instances live (VMs that support it)" },
  { value: "stop", label: "Stop instances" },
];

/** Puts a cluster member into maintenance: its instances move away or stop. */
const EvacuateMember: FC<{ clusterId: string; member: string; onClose: () => void }> = ({ clusterId, member, onClose }) => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("auto");
  const submit = async () => {
    const path = `/api/v1/clusters/${clusterId}/members/${encodeURIComponent(member)}/evacuate`;
    const job = await request<Job>("POST", path, mode === "auto" ? {} : { mode });
    navigate(`/jobs/${job.id}`);
  };
  return (
    <FormModal title={`Evacuate ${member}`} submitLabel="Evacuate" onSubmit={submit} onClose={onClose}>
      <p>Its instances are moved to other members or stopped, and it takes no new ones until it is restored.</p>
      <Select id="evacuate-mode" label="Mode" options={MODES} value={mode} onChange={(e) => setMode(e.target.value as Mode)} />
    </FormModal>
  );
};

export default EvacuateMember;
