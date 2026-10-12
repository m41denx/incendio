import { type FC, type ReactNode, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import classnames from "classnames";
import { Button, Icon } from "@canonical/react-components";
import { useQuery } from "@tanstack/react-query";
import { useCurrentProject } from "@incendio/ui/context/useCurrentProject";
import { useClusterMembers } from "@incendio/ui/context/useClusterMembers";
import { useInstances } from "@incendio/ui/context/useInstances";
import { getInstanceDetailUrl } from "@incendio/ui/util/instances";
import { request } from "../../api/client";
import type { Cluster } from "../../api/types";
import { buildTree, type Selection, selectionOf, type TreeCluster } from "./tree";

/** Incendio's small status icons, for nodes and instances. */
export const statusIcon = (status: string) =>
  ({
    Online: "status-succeeded-small",
    Running: "status-succeeded-small",
    Ready: "status-waiting-small",
    Evacuated: "status-waiting-small",
    Frozen: "status-in-progress-small",
    Stopped: "status-queued-small",
    Offline: "status-failed-small",
    Error: "status-failed-small",
  })[status] ?? "status-queued-small";

/** The selection as URL parameters (`cluster`, `node`), keeping the page's others. */
export function withSelection(params: URLSearchParams, s: Selection): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("cluster");
  next.delete("node");
  if (s.node) next.set("node", s.node);
  else if (s.cluster) next.set("cluster", s.cluster);
  return next;
}

interface RowProps {
  level: number;
  icon: string;
  label: ReactNode;
  count?: string;
  selected?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect?: () => void;
  to?: string;
  title?: string;
  children?: ReactNode;
}

/** One row of the tree: a toggle when it has children, a label that selects (or links). */
const Row: FC<RowProps> = ({ level, icon, label, count, selected, expanded, onToggle, onSelect, to, title, children }) => (
  <li role="treeitem" aria-level={level} aria-selected={selected ? true : undefined} aria-expanded={onToggle ? !!expanded : undefined} className="ic-tree__item">
    <div className={classnames("ic-tree__row", { "is-selected": selected })} style={{ paddingLeft: `${(level - 1) * 1.25}rem` }}>
      {onToggle ? (
        <Button type="button" appearance="base" dense hasIcon className="ic-tree__toggle u-no-margin" aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`} onClick={onToggle}>
          <Icon name="chevron-down" className={classnames({ "ic-tree__chevron--closed": !expanded })} />
        </Button>
      ) : (
        <span className="ic-tree__toggle" />
      )}
      {to ? (
        <Link to={to} className="ic-tree__label" title={title}>
          <Icon name={icon} /> <span className="u-truncate">{label}</span>
        </Link>
      ) : (
        <button type="button" className="ic-tree__label" title={title} onClick={onSelect}>
          <Icon name={icon} /> <span className="u-truncate">{label}</span>
        </button>
      )}
      {count !== undefined && <span className="ic-tree__count">{count}</span>}
    </div>
    {expanded && children ? (
      <ul role="group" className="ic-tree__group">
        {children}
      </ul>
    ) : null}
  </li>
);

/** The inventory tree, from data already loaded. */
export const InventoryTreeView: FC<{ tree: TreeCluster[]; selection: Selection; onSelect: (s: Selection) => void }> = ({ tree, selection, onSelect }) => {
  // Clusters start open; nodes start open where selected.
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set(selection.node ? [selection.node] : []));
  const toggle = (set: Set<string>, update: (s: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update(next);
  };
  const total = tree.reduce((n, c) => n + c.total, 0);
  const running = tree.reduce((n, c) => n + c.running, 0);
  return (
    <nav aria-label="Inventory" className="ic-tree">
      <ul role="tree" aria-label="Clusters, nodes and instances" className="ic-tree__group">
        <Row level={1} icon="cluster-host" label="All clusters" title="All clusters" count={`${running}/${total}`} selected={!selection.cluster} expanded onSelect={() => onSelect({})}>
          {tree.map((c) => (
            <Row
              key={c.name}
              level={2}
              icon="cluster-host"
              label={c.name}
              title={c.name}
              count={`${c.running}/${c.total}`}
              selected={selection.cluster === c.name && !selection.node}
              expanded={!closed.has(c.name)}
              onToggle={c.nodes.length ? () => toggle(closed, setClosed, c.name) : undefined}
              onSelect={() => onSelect({ cluster: c.name })}
            >
              {c.nodes.map((n) => (
                <Row
                  key={n.name}
                  level={3}
                  icon={statusIcon(n.status)}
                  label={n.label}
                  title={`${n.label} (${n.status})`}
                  count={String(n.instances.length)}
                  selected={selection.node === n.name}
                  expanded={opened.has(n.name)}
                  onToggle={n.instances.length ? () => toggle(opened, setOpened, n.name) : undefined}
                  onSelect={() => onSelect({ cluster: c.name, node: n.name })}
                >
                  {n.instances.map((i) => (
                    <Row key={`${i.project}/${i.name}`} level={4} icon={statusIcon(i.status)} label={i.name} title={`${i.name} (${i.status}, ${i.project})`} to={getInstanceDetailUrl(i.name, i.project)} />
                  ))}
                </Row>
              ))}
            </Row>
          ))}
        </Row>
      </ul>
    </nav>
  );
};

/** The inventory tree of the current project (or all of them), selecting through the URL. */
const InventoryTree: FC = () => {
  const { project, isAllProjects } = useCurrentProject();
  const { data: members = [] } = useClusterMembers();
  const { data: instances = [] } = useInstances(isAllProjects ? null : (project?.name ?? null));
  // Platform viewers also see clusters that answer nothing right now.
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: () => request<Cluster[]>("GET", "/api/v1/clusters"), retry: false });
  const [params, setParams] = useSearchParams();
  const selection = selectionOf(params);
  const tree = buildTree(members, instances, (clusters.data ?? []).map((c) => c.name));
  return <InventoryTreeView tree={tree} selection={selection} onSelect={(s) => setParams(withSelection(params, s))} />;
};

export default InventoryTree;
