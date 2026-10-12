import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, MainTable } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import { ErrorMessage, Loaded } from "../../components/Status";
import { request } from "../../api/client";
import type { BalancingSuggestion, Instance } from "../../api/types";
import { bytes } from "../../lib/format";
import MigrateInstance from "../instances/MigrateInstance";
import EmptyList from "../../components/EmptyList";

const SUGGESTIONS = "/api/v1/balancing/suggestions";

/** Suggested moves from the busiest cluster to the least busy one of a tenant's placements; each row offers to start one. */
const Suggestions: FC = () => {
  const suggestions = useQuery({ queryKey: ["balancing", "suggestions"], queryFn: () => request<BalancingSuggestion[]>("GET", SUGGESTIONS) });
  const [error, setError] = useState<unknown>(null);
  const [opening, setOpening] = useState("");
  const [moving, setMoving] = useState<{ instance: Instance; target: string } | null>(null);

  /** Fetches the instance, then opens the move dialog with the suggested cluster chosen. */
  const openMove = async (s: BalancingSuggestion, key: string) => {
    setOpening(key);
    setError(null);
    try {
      const instance = await request<Instance>("GET", `/api/v1/instances/${s.instanceId}`);
      setMoving({ instance, target: s.toClusterId });
    } catch (e) {
      setError(e);
    } finally {
      setOpening("");
    }
  };

  return (
    <PageLayout title="Balancing">
      <p className="u-text--muted">
        Where one of your clusters is much busier than another (by memory), moving some instances evens them out. Nothing moves until you start it.
      </p>
      {error ? <ErrorMessage error={error} /> : null}
      <Loaded query={suggestions}>
        {(list) =>
          list.length === 0 ? (
            <EmptyList icon="fork" title="No suggestions">No suggestions: your clusters are evenly loaded.</EmptyList>
          ) : (
          <MainTable
            headers={[
              { content: "Instance" },
              { content: "Tenant" },
              { content: "Memory" },
              { content: "Move" },
              { content: "Why" },
              { content: "", className: "u-align--right ic-col-actions" },
            ]}
            rows={list.map((s) => {
              const key = `${s.instanceId}:${s.toClusterId}`;
              return {
                key,
                columns: [
                  { content: <Link to={`/instances/${s.instanceId}`}>{`${s.project}/${s.name}`}</Link> },
                  { content: s.tenantSlug },
                  { content: bytes(s.memoryBytes) },
                  { content: `${s.fromClusterName} → ${s.toClusterName}` },
                  { content: s.reason },
                  {
                    className: "u-align--right ic-col-actions",
                    content: (
                      <ActionButton className="is-small u-no-margin--bottom" loading={opening === key} disabled={!!opening} onClick={() => openMove(s, key)}>
                        Move…
                      </ActionButton>
                    ),
                  },
                ],
              };
            })}
          />
        )}
      </Loaded>
      {moving ? <MigrateInstance instance={moving.instance} initialTarget={moving.target} onClose={() => setMoving(null)} /> : null}
    </PageLayout>
  );
};

export default Suggestions;
