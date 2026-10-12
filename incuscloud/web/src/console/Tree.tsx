import { type FC, useState } from "react";
import { Link } from "react-router-dom";
import classnames from "classnames";
import { Button, Icon } from "@canonical/react-components";
import type { TreeItem } from "./views";

/** The keys from the root down to the item that leads to `to` (empty when none does). */
function pathTo(item: TreeItem, to: string): string[] {
  if (item.to === to) return [item.key];
  for (const c of item.children ?? []) {
    const p = pathTo(c, to);
    if (p.length) return [item.key, ...p];
  }
  return [];
}

/** A cluster's own status, when it is not plainly ready. */
const clusterAlert = (status?: string) => (status && !["ready", "Online", "Created", "Running"].includes(status) ? status : null);

/**
 * The inventory tree. Labels select (they are links to the object);
 * chevrons only open and close. The root and the clusters start open, and
 * so does every row above the selected object.
 */
const Tree: FC<{ root: TreeItem; selected: string; onSelect?: () => void }> = ({ root, selected, onSelect }) => {
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const above = new Set(pathTo(root, selected).slice(0, -1));
  const isOpen = (key: string, depth: number) => (depth <= 1 || above.has(key)) !== toggled.has(key);
  const toggle = (key: string) =>
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const row = (item: TreeItem, depth: number) => {
    const kids = item.children ?? [];
    const open = kids.length > 0 && isOpen(item.key, depth);
    const alert = depth === 1 ? clusterAlert(item.status) : null;
    return (
      <li key={item.key} role="treeitem" aria-level={depth + 1} aria-expanded={kids.length ? open : undefined} aria-selected={item.to === selected || undefined} className="ic-tree__item">
        <div className={classnames("ic-tree__row", { "is-selected": item.to === selected })} style={{ paddingLeft: `${depth * 0.75}rem` }}>
          {kids.length ? (
            <Button type="button" appearance="base" dense hasIcon className="ic-tree__toggle u-no-margin" aria-label={`${open ? "Collapse" : "Expand"} ${item.label}`} onClick={() => toggle(item.key)}>
              <Icon name="chevron-down" light className={classnames({ "ic-tree__chevron--closed": !open })} />
            </Button>
          ) : (
            <span className="ic-tree__toggle" />
          )}
          <Link to={item.to} className="ic-tree__label" title={alert ? `${item.label} (${alert})` : item.label} onClick={onSelect}>
            <Icon name={alert ? "status-failed-small" : item.icon} light /> <span className="u-truncate">{item.label}</span>
          </Link>
          {item.count !== undefined && <span className="ic-tree__count">{item.count}</span>}
        </div>
        {open ? (
          <ul role="group" className="ic-tree__group">
            {kids.map((c) => row(c, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <ul role="tree" aria-label="Inventory" className="ic-tree ic-tree__group">
      {row(root, 0)}
    </ul>
  );
};

export default Tree;
