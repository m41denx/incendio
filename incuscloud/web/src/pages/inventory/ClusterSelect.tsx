import type { FC } from "react";
import { Link, useLocation } from "react-router-dom";
import { ContextualMenu, Icon } from "@canonical/react-components";
import { useProjects } from "@incendio/ui/context/useProjects";
import { clusterChoices } from "./scope";

/**
 * The Cluster select under Incendio's project selector, in its style: on the
 * instance list every cluster or one, elsewhere the cluster whose profiles,
 * networks, storage and images the page shows.
 */
const ClusterSelect: FC<{ close?: () => void }> = ({ close }) => {
  const { pathname, search } = useLocation();
  const { data: projects = [] } = useProjects();
  const choices = clusterChoices(
    pathname,
    search,
    projects.map((p) => p.name),
  );
  if (!choices || !choices.options.length) return null;
  const current = choices.options.find((o) => o.value === choices.current)?.label ?? choices.current;
  return (
    <li onClick={(e) => e.stopPropagation()}>
      <div className="project-select-label">Cluster</div>
      <ContextualMenu
        key={pathname + search}
        dropdownProps={{ "aria-label": "select cluster" }}
        toggleClassName="toggle is-dark"
        toggleLabel={current}
        hasToggleIcon
        title={`Select cluster (${current})`}
        className="project-select is-dark"
      >
        <div className="list is-dark">
          <div className="projects">
            {choices.options.map((o) => (
              <div key={o.value} className="p-contextual-menu__group">
                <Link to={o.to} className="p-contextual-menu__link link" aria-current={o.value === choices.current ? "true" : undefined} onClick={close}>
                  <Icon name="cluster-host" light /> <span className="name">{o.label}</span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      </ContextualMenu>
    </li>
  );
};

export default ClusterSelect;
