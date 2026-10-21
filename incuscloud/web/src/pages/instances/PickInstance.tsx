import { type FC, useState } from "react";
import { ActionButton, Input, MainTable, Modal } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { request, withQuery } from "../../api/client";
import type { Instance } from "../../api/types";
import { ErrorMessage, Loading } from "../../components/Status";

/**
 * Pick one instance from the inventory, searching by name, cluster or project; `onPick` gets its
 * detail, with the caller's privileges on it.
 */
const PickInstance: FC<{ title: string; onPick: (i: Instance) => void; onClose: () => void }> = ({ title, onPick, onClose }) => {
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState("");
  const [error, setError] = useState<unknown>(null);
  const found = useQuery({
    queryKey: ["instances", "pick", q],
    queryFn: () => request<{ items: Instance[]; total: number }>("GET", withQuery("/api/v1/instances", { q: q.trim(), limit: 20 })),
    placeholderData: (prev) => prev,
  });
  const pick = async (i: Instance) => {
    setPicking(i.id);
    setError(null);
    try {
      onPick(await request<Instance>("GET", `/api/v1/instances/${i.id}`));
    } catch (e) {
      setError(e);
      setPicking("");
    }
  };
  return (
    <Modal title={title} close={onClose}>
      <Input id="pick-instance" type="search" label="Instance" placeholder="Search by name, cluster or project" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? <ErrorMessage error={error} /> : null}
      {found.isPending ? (
        <Loading />
      ) : found.error ? (
        <ErrorMessage error={found.error} />
      ) : found.data.items.length === 0 ? (
        <p className="u-text--muted">No instances match.</p>
      ) : (
        <MainTable
          headers={[{ content: "Name" }, { content: "Cluster" }, { content: "Project" }, { content: "Status" }, { content: "", className: "u-align--right" }]}
          rows={found.data.items.map((i) => ({
            key: i.id,
            columns: [
              { content: i.name },
              { content: i.clusterName },
              { content: i.project },
              { content: i.status },
              {
                className: "u-align--right",
                content: (
                  <ActionButton className="is-small u-no-margin--bottom" loading={picking === i.id} disabled={!!picking} onClick={() => void pick(i)}>
                    Choose
                  </ActionButton>
                ),
              },
            ],
          }))}
        />
      )}
      {found.data && found.data.total > found.data.items.length ? <p className="u-text--muted">{found.data.total - found.data.items.length} more: narrow the search.</p> : null}
    </Modal>
  );
};

export default PickInstance;
