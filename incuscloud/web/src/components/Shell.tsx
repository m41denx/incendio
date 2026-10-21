import { useEffect, useMemo, useRef, type FC } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Application, CustomLayout, SkipLink, applyTheme, loadTheme } from "@canonical/react-components";
import Events from "@incendio/ui/Events";
import StatusBar from "@incendio/ui/components/StatusBar";
import { CreateInstanceExtensionContext } from "@incendio/ui/context/createInstanceExtension";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { incusAll } from "../api/client";
import { useMe } from "../api/hooks";
import { ErrorMessage, Loading } from "./Status";
import CreateWhere from "../pages/inventory/CreateWhere";
import { qualifyPath } from "../pages/inventory/scope";
import { clusterOf } from "../pages/inventory/tree";
import Sidebar from "../console/Sidebar";
import ObjectFrame from "../console/ObjectFrame";

/** The cluster a page belongs to: a cluster's console page, or its first qualified path segment (`/ui/project/acme@cluster-b/…`). */
export const pageCluster = (pathname: string) => {
  const segs = pathname.split("/").map((seg) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  });
  if (segs[1] === "inventory" && segs[2]) return segs[2];
  for (const s of segs) {
    const c = clusterOf(s);
    if (c) return c;
  }
  return "";
};

// Incendio's caches of global lists: the facade answers them for the page's cluster.
const GLOBAL_KEYS = new Set(["cluster", "storage", "network-integrations", "certificates", "resources", "projects", "operations", "warnings", "settings"]);

/**
 * The console: the inventory sidebar, and the selected object (its
 * breadcrumb and tabs) over the page, Incendio's or IncusCloud's, with
 * Incendio's status bar of running operations and notifications.
 */
const Shell: FC = () => {
  const me = useMe();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const cluster = pageCluster(pathname);
  const lastCluster = useRef(cluster);
  // Every cluster's projects, whatever page asks: for unqualified project links.
  const projects = useQuery({
    queryKey: ["inventory", "projects"],
    queryFn: () => incusAll<Array<{ name: string }>>("/1.0/projects?recursion=1"),
    staleTime: 15_000,
  });
  const projectNames = useMemo(() => (projects.data ?? []).map((p) => p.name), [projects.data]);
  // The cluster last shown, for an unqualified project's next page.
  const preferred = useRef("");
  if (cluster) preferred.current = cluster;

  // Every page in Incendio's theme (its setting, else the system's), not only Incendio's own.
  useEffect(() => applyTheme(loadTheme()), []);

  // A project is one cluster's: an unqualified one (an old link) goes to the project on a cluster that has it.
  useEffect(() => {
    const to = qualifyPath(pathname, projectNames, preferred.current);
    if (to) navigate(to + window.location.search, { replace: true });
  }, [pathname, projectNames]);

  // Another cluster's page: global lists cached for the last one (or for all) are not this one's.
  useEffect(() => {
    if (lastCluster.current === cluster) return;
    lastCluster.current = cluster;
    // Reset, not remove: pages still mounted (and watching them) refetch instead of keeping the last cluster's.
    void queryClient.resetQueries({ predicate: (q) => GLOBAL_KEYS.has(String(q.queryKey[0])) });
  }, [cluster]);

  const target = params.get("target");
  const create = useMemo(() => ({ header: <CreateWhere />, initialValues: target ? { target } : undefined }), [target]);

  return (
    <CreateInstanceExtensionContext.Provider value={create}>
      <Application id="l-application">
        <SkipLink mainId="main-content" />
        <Sidebar />
        {me.error ? (
          <CustomLayout>
            <ErrorMessage error={me.error} />
          </CustomLayout>
        ) : me.isPending ? (
          <CustomLayout>
            <Loading />
          </CustomLayout>
        ) : (
          <ObjectFrame>
            <Outlet />
          </ObjectFrame>
        )}
        <Events />
        <StatusBar />
      </Application>
    </CreateInstanceExtensionContext.Provider>
  );
};

export default Shell;
