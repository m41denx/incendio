import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { Button, MainTable } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { Loaded, ago } from "../../components/Status";
import { request } from "../../api/client";
import { can, useMe } from "../../api/hooks";
import type { Cluster } from "../../api/types";
import ClusterStatus from "./ClusterStatus";
import EnrolCluster from "./EnrolCluster";
import EmptyList from "../../components/EmptyList";

export const useClusters = () => useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters") });

const ClusterList: FC = () => {
  const { data: me } = useMe();
  const clusters = useClusters();
  const [enrolling, setEnrolling] = useState(false);
  return (
    <PageLayout
      title="Clusters"
      controls={
        can(me, "admin") ? (
          <Button appearance="positive" onClick={() => setEnrolling(true)}>
            Enrol cluster
          </Button>
        ) : undefined
      }
    >
      <Loaded query={clusters}>
        {(list) =>
          list.length === 0 ? (
            <EmptyList icon="cluster-host" title="No clusters found">{can(me, "admin") ? "No clusters yet. Enrol one to start." : "No clusters are available to you yet."}</EmptyList>
          ) : (
          <MainTable
            sortable
            headers={[
              { content: "Name", sortKey: "name" },
              { content: "Status", sortKey: "status" },
              { content: "Address" },
              { content: "Last seen", sortKey: "seen" },
              { content: "Reconciled", sortKey: "reconciled" },
              { content: "Labels" },
            ]}
            rows={list.map((c) => ({
              key: c.id,
              columns: [
                { content: <Link to={`/clusters/${c.id}`}>{c.name}</Link> },
                { content: <ClusterStatus status={c.status} message={c.statusMessage} /> },
                { content: <span className="mono-font">{c.url.replace(/^https:\/\//, "")}</span> },
                { content: ago(c.lastSeenAt) },
                { content: ago(c.reconciledAt) },
                { content: Object.entries(c.labels).map(([k, v]) => <span key={k} className="p-chip is-dense"><span className="p-chip__value">{`${k}=${v}`}</span></span>) },
              ],
              sortData: { name: c.name, status: c.status, seen: c.lastSeenAt ?? "", reconciled: c.reconciledAt ?? "" },
            }))}
          />
        )}
      </Loaded>
      {enrolling ? <EnrolCluster onClose={() => setEnrolling(false)} /> : null}
    </PageLayout>
  );
};

export default ClusterList;
