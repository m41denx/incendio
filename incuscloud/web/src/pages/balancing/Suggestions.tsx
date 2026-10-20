import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import { ActionButton, MainTable } from "@canonical/react-components";
import { useQueries, useQuery } from "@tanstack/react-query";
import PageLayout from "../../components/PageLayout";
import Section from "../../components/Section";
import { ErrorMessage, Loaded, Loading, ago } from "../../components/Status";
import { incusAll, request } from "../../api/client";
import type { BalancingPolicy, BalancingSuggestion, Instance } from "../../api/types";
import { bytes } from "../../lib/format";
import MigrateInstance from "../instances/MigrateInstance";
import { RULE_KEYS } from "../instances/BalancingRules";
import EmptyList from "../../components/EmptyList";
import { useClusters } from "../clusters/ClusterList";
import { clusterOf, nameOf } from "../inventory/tree";
import { projectPath } from "../../console/object";

const SUGGESTIONS = "/api/v1/balancing/suggestions";
const enc = encodeURIComponent;

const BY: Record<BalancingPolicy["method"], string> = { memory: "Memory", cpu: "CPU", disk: "Disk" };
const every = (s: number) => (s % 3600 === 0 ? `every ${s / 3600} h` : `every ${Math.round(s / 60)} min`);

/** Each cluster the caller sees, with its balancing policy and a way to its settings. */
const ClusterPolicies: FC = () => {
  const clusters = useClusters();
  const list = clusters.data ?? [];
  // A cluster whose policy the caller may not read (403/404) is left out.
  const policies = useQueries({
    queries: list.map((c) => ({ queryKey: ["clusters", c.id, "balancing"], queryFn: () => request<BalancingPolicy>("GET", `/api/v1/clusters/${c.id}/balancing`), retry: false })),
  });
  if (clusters.isPending || policies.some((p) => p.isPending)) return <Loading />;
  if (clusters.error) return <ErrorMessage error={clusters.error} />;
  const rows = list.flatMap((c, n) => {
    const p = policies[n]?.data;
    return p ? [{ c, p }] : [];
  });
  if (!rows.length) return <p className="u-text--muted">You can't see the balancing of any cluster.</p>;
  return (
    <MainTable
      headers={[{ content: "Cluster" }, { content: "Balances" }, { content: "By" }, { content: "Last run" }, { content: "", className: "u-align--right ic-col-actions" }]}
      rows={rows.map(({ c, p }) => ({
        key: c.id,
        columns: [
          { content: c.name },
          { content: p.enabled ? `Automatically, ${every(p.intervalS)}` : "When started" },
          { content: `${BY[p.method]}, ${p.mode === "used" ? "used" : "given"}` },
          {
            content: p.lastRunAt ? (
              <>
                {ago(p.lastRunAt)}
                {p.lastError ? <span className="u-text--muted"> · failed</span> : null}
              </>
            ) : (
              "Never"
            ),
          },
          {
            className: "u-align--right ic-col-actions",
            content: (
              <Link className="p-button is-small u-no-margin--bottom" to={`/inventory/${enc(c.name)}/configure/incuscloud#cluster-balancing`}>
                Settings, preview, run
              </Link>
            ),
          },
        ],
      }))}
    />
  );
};

type WithConfig = { name: string; project: string; config?: Record<string, string> };

/** The instances that carry balancing rules, from the console's inventory of every cluster. */
const Rules: FC = () => {
  // The console's own query: the same list as the inventory tree, with each instance's config.
  const instances = useQuery({ queryKey: ["inventory", "instances"], queryFn: () => incusAll<WithConfig[]>("/1.0/instances?all-projects=true&recursion=1") });
  return (
    <Loaded query={instances}>
      {(all) => {
        const ruled = (all as WithConfig[]).filter((i) => Object.values(RULE_KEYS).some((k) => i.config?.[k]));
        if (!ruled.length)
          return (
            <p className="u-text--muted">
              No instance has rules. Open an instance and choose <strong>IncusCloud › Balancing rules…</strong> to keep it with a group, apart from one, on some members only,
              or never moved.
            </p>
          );
        return (
          <MainTable
            headers={[{ content: "Instance" }, { content: "Cluster" }, { content: "Rules" }]}
            rows={ruled.map((i) => {
              const c = i.config ?? {};
              const rules = [
                c[RULE_KEYS.balance] === "false" && "Never moved",
                c[RULE_KEYS.affinity] && `With group ${c[RULE_KEYS.affinity]}`,
                c[RULE_KEYS.antiAffinity] && `Apart from group ${c[RULE_KEYS.antiAffinity]}`,
                c[RULE_KEYS.pin] && `Only on ${c[RULE_KEYS.pin].split(",").join(", ")}`,
              ].filter(Boolean);
              return {
                key: `${i.project}/${i.name}`,
                columns: [
                  { content: <Link to={projectPath(i.project, `instance/${enc(i.name)}`)}>{`${nameOf(i.project)}/${i.name}`}</Link> },
                  { content: clusterOf(i.project) },
                  { content: rules.join(" · ") },
                ],
              };
            })}
          />
        );
      }}
    </Loaded>
  );
};

/** Suggested moves from the busiest cluster to the least busy one of a tenant's placements; each row offers to start one. */
const AcrossClusters: FC = () => {
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
    <>
      <p className="u-text--muted">
        Where one of a tenant's clusters is much busier than another (by memory), moving some instances evens them out. Nothing moves until you start it.
      </p>
      {error ? <ErrorMessage error={error} /> : null}
      <Loaded query={suggestions}>
        {(list) =>
          list.length === 0 ? (
            <EmptyList icon="fork" title="No suggestions">
              No suggestions: your clusters are evenly loaded.
            </EmptyList>
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
                    { content: <Link to={projectPath(`${s.project}@${s.fromClusterName}`, `instance/${enc(s.name)}`)}>{`${s.project}/${s.name}`}</Link> },
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
          )
        }
      </Loaded>
      {moving ? <MigrateInstance instance={moving.instance} initialTarget={moving.target} onClose={() => setMoving(null)} /> : null}
    </>
  );
};

/**
 * Balancing in one place: each cluster's policy (which moves instances between its members), the
 * rules instances carry, and suggested moves across a tenant's clusters.
 */
const Suggestions: FC = () => (
  <PageLayout title="Balancing">
    <Section title="Clusters" id="balancing-clusters">
      <p className="u-text--muted">Each cluster balances its own members by its policy. Preview a run, or start one, from the cluster's settings.</p>
      <ClusterPolicies />
    </Section>
    <Section title="Rules" id="balancing-rules">
      <Rules />
    </Section>
    <Section title="Across clusters" id="balancing-across">
      <AcrossClusters />
    </Section>
  </PageLayout>
);

export default Suggestions;
