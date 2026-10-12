import { useEffect, useMemo, useRef, type FC, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Application, CustomLayout, Icon, SideNavigationItem, SkipLink, applyTheme, loadTheme } from "@canonical/react-components";
import { useProjects } from "@incendio/ui/context/useProjects";
import Navigation from "@incendio/ui/components/Navigation";
import Events from "@incendio/ui/Events";
import StatusBar from "@incendio/ui/components/StatusBar";
import { NavigationExtensionContext, type NavigationExtension } from "@incendio/ui/context/navigationExtension";
import { InstanceListExtensionContext } from "@incendio/ui/context/instanceListExtension";
import { CreateInstanceExtensionContext } from "@incendio/ui/context/createInstanceExtension";
import { useQueryClient } from "@tanstack/react-query";
import { can, useMe } from "../api/hooks";
import type { Me } from "../api/types";
import Logo from "./Logo";
import { ErrorMessage, Loading } from "./Status";
import InventoryTree from "../pages/inventory/InventoryTree";
import InventorySummary from "../pages/inventory/InventorySummary";
import CreateWhere from "../pages/inventory/CreateWhere";
import ClusterSelect from "../pages/inventory/ClusterSelect";
import { listedProject, qualifyPath } from "../pages/inventory/scope";
import { clusterOf, inScope, nameOf, selectionOf } from "../pages/inventory/tree";

/** The cluster a page belongs to: its first qualified path segment (`/ui/project/acme@cluster-b/…`), if any. */
export const pageCluster = (pathname: string) => {
  for (const seg of pathname.split("/")) {
    let s = seg;
    try {
      s = decodeURIComponent(seg);
    } catch {
      // Not encoded: as it is.
    }
    const c = clusterOf(s);
    if (c) return c;
  }
  return "";
};

// Incendio's caches of global lists (members, pools, groups…): the facade answers them for the page's cluster.
const GLOBAL_KEYS = new Set(["cluster", "storage", "network-integrations", "certificates", "resources"]);

const tenantAdmin = (me: Me) => me.tenants.some((t) => t.role === "owner" || t.role === "admin");

interface Section {
  label: string;
  icon: string;
  to: string;
  end?: boolean;
}

/**
 * IncusCloud's own sections, after Incendio's (the project's, then the
 * Incus-wide ones); the API still decides on every request.
 */
export function sections(me: Me): { platform: Section[] } {
  const platformViewer = can(me, "viewer");
  const manages = platformViewer || tenantAdmin(me);
  const only = (xs: Array<Section | false>) => xs.filter((x): x is Section => !!x);
  return {
    platform: only([
      { label: "Dashboard", icon: "switcher-dashboard", to: "/", end: true },
      { label: "Kubernetes", icon: "kubernetes", to: "/kubernetes" },
      { label: "Clusters", icon: "cluster-host", to: "/clusters" },
      { label: "Tenants", icon: "switcher-environments", to: "/tenants" },
      { label: "Jobs", icon: "loading-steps", to: "/jobs" },
      { label: "Replication", icon: "restart", to: "/replication" },
      { label: "Backups", icon: "archive", to: "/backups" },
      { label: "Balancing", icon: "fork", to: "/balancing" },
      platformViewer && { label: "Backup targets", icon: "storage-bucket", to: "/backup-targets" },
      platformViewer && { label: "Users", icon: "user-group", to: "/users" },
      manages && { label: "Service accounts", icon: "applications", to: "/service-accounts" },
      manages && { label: "Audit log", icon: "show", to: "/audit" },
      manages && { label: "Gateway log", icon: "export", to: "/gateway-log" },
    ]),
  };
}

/** Incendio's navigation link markup; `end` matches the path exactly (the dashboard at /). */
const NavItem: FC<{ to: string; title: string; icon: string; end?: boolean; children: ReactNode; onClick?: () => void }> = ({ to, title, icon, end, children, onClick }) => {
  const { pathname } = useLocation();
  const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SideNavigationItem>
      <Link to={to} title={title} className="p-side-navigation__link" aria-current={active ? "page" : undefined} onClick={onClick}>
        <Icon className="is-light p-side-navigation__icon" name={icon} /> {children}
      </Link>
    </SideNavigationItem>
  );
};

const Label: FC<{ children: string }> = ({ children }) => <li className="navigation-section-label">{children}</li>;

const items = (list: Section[], close: () => void) =>
  list.map((s) => (
    <NavItem key={s.to} to={s.to} title={s.label} icon={s.icon} end={s.end} onClick={close}>
      {s.label}
    </NavItem>
  ));

/**
 * The console's frame is Incendio's: its navigation (with IncusCloud's
 * sections added), its pages over every cluster, its status bar with
 * running operations and notifications.
 */
const Shell: FC = () => {
  const me = useMe();
  const logout = useRef<HTMLFormElement>(null);
  const [params] = useSearchParams();
  const selection = selectionOf(params);
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const cluster = pageCluster(pathname);
  const lastCluster = useRef(cluster);
  const navigate = useNavigate();
  const { data: projectList } = useProjects();
  const projectNames = useMemo(() => (projectList ?? []).map((p) => p.name), [projectList]);
  // The cluster last shown, for a merged project's next per-cluster page.
  const preferred = useRef("");
  if (cluster) preferred.current = cluster;

  // Every page in Incendio's theme (its setting, else the system's), not only Incendio's own.
  useEffect(() => applyTheme(loadTheme()), []);

  // Profiles, networks, storage, images… are one cluster's: a merged project goes to one of them.
  useEffect(() => {
    const to = qualifyPath(pathname, projectNames, preferred.current);
    if (to) navigate(to + window.location.search, { replace: true });
  }, [pathname, projectNames]);

  // Another cluster's page: global lists cached for the last one (or for all) are not this one's.
  useEffect(() => {
    if (lastCluster.current === cluster) return;
    lastCluster.current = cluster;
    queryClient.removeQueries({ predicate: (q) => GLOBAL_KEYS.has(String(q.queryKey[0])) });
  }, [cluster]);

  const navigation = useMemo<NavigationExtension>(() => {
    const s = me.data ? sections(me.data) : { platform: [] };
    return {
      logo: <Logo />,
      serverLabel: "Infrastructure",
      afterProjectSelector: (close) => <ClusterSelect close={close} />,
      projects: { filter: listedProject(projectNames), label: nameOf },
      after: (close) =>
        s.platform.length ? (
          <>
            <hr className="navigation-hr" />
            <Label>Platform</Label>
            {items(s.platform, close)}
          </>
        ) : null,
      account: (close) =>
        me.data ? (
          <>
            <Label>Account</Label>
            <NavItem to="/profile" title="Profile" icon="user" onClick={close}>
              <span className="u-truncate">{me.data.name || me.data.email || "Profile"}</span>
            </NavItem>
            <SideNavigationItem>
              <form ref={logout} method="post" action="/auth/logout" hidden />
              <a
                className="p-side-navigation__link"
                href="/auth/logout"
                title="Sign out"
                onClick={(e) => {
                  e.preventDefault();
                  logout.current?.submit();
                }}
              >
                <Icon className="is-light p-side-navigation__icon p-side-logout" name="export" />
                Sign out
              </a>
            </SideNavigationItem>
          </>
        ) : null,
      // IncusCloud's own, or meaningless across clusters (each cluster's server settings and OpenFGA are IncusCloud's).
      hide: ["kubernetes", "permissions", "settings", "os"],
    };
  }, [me.data, projectNames]);

  // The instance list is the inventory: the tree beside it, the selection's summary above it.
  const inventory = useMemo(
    () => ({
      aside: <InventoryTree />,
      above: <InventorySummary />,
      scope: inScope(selection),
      // "Create instance" on a selected cluster (and node) creates there.
      createPath: (project: string) => {
        if (!selection.cluster) return `/ui/project/${encodeURIComponent(project)}/instances/create`;
        const base = clusterOf(project) ? nameOf(project) : project;
        const target = selection.node ? `?target=${encodeURIComponent(selection.node)}` : "";
        return `/ui/project/${encodeURIComponent(`${base}@${selection.cluster}`)}/instances/create${target}`;
      },
    }),
    [selection.cluster, selection.node],
  );
  const target = params.get("target");
  const create = useMemo(() => ({ header: <CreateWhere />, initialValues: target ? { target } : undefined }), [target]);

  return (
    <NavigationExtensionContext.Provider value={navigation}>
      <InstanceListExtensionContext.Provider value={inventory}>
        <CreateInstanceExtensionContext.Provider value={create}>
        <Application id="l-application">
          <SkipLink mainId="main-content" />
          <Navigation />
          {me.error ? (
            <CustomLayout>
              <ErrorMessage error={me.error} />
            </CustomLayout>
          ) : me.isPending ? (
            <CustomLayout>
              <Loading />
            </CustomLayout>
          ) : (
            <Outlet />
          )}
          <Events />
          <StatusBar />
        </Application>
        </CreateInstanceExtensionContext.Provider>
      </InstanceListExtensionContext.Provider>
    </NavigationExtensionContext.Provider>
  );
};

export default Shell;
