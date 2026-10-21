import { useContext, useMemo, type FC, type ReactNode } from "react";
import { Navigate, Route, Routes, UNSAFE_NavigationContext, UNSAFE_RouteContext, useLocation, type To } from "react-router-dom";
import IncendioApp from "@incendio/ui/App";
import { ProjectProvider } from "@incendio/ui/context/useCurrentProject";
import { WarningListExtensionContext, type WarningListExtension } from "@incendio/ui/context/warningListExtension";
import { clusterOf } from "../pages/inventory/tree";

/** No parent route: the routes below match from the root, whatever console route renders them. */
const ROOT = { outlet: null, matches: [], isDataRoute: false };

const decode = (p: string) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};

/** Query parameters of `a`, then of `b` over them. */
const mergeSearch = (a: string, b: string) => {
  const q = new URLSearchParams(a);
  new URLSearchParams(b).forEach((v, k) => q.set(k, v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

/**
 * Renders `routes` as if the URL were `path`: their `useLocation` and
 * `useParams` see `path` (with the console URL's query parameters), while the
 * browser stays on the console URL (and its Referer tells the facade which
 * cluster the page is about). Links and navigation to `path` itself (filters,
 * panels: "?…") go to the console URL; to anywhere else, to that real URL.
 */
export const RenderAt: FC<{ path: string; children: ReactNode }> = ({ path, children }) => {
  const [pathname, search = ""] = path.split("?");
  const real = useLocation();
  const nav = useContext(UNSAFE_NavigationContext);
  const value = useMemo(() => {
    const here = (to: To): To => {
      const target = typeof to === "string" ? new URL(to, "http://x") : { pathname: to.pathname ?? "", search: to.search ?? "", hash: to.hash ?? "" };
      if (decode(target.pathname) !== decode(pathname!)) return to;
      return { pathname: real.pathname, search: target.search, hash: target.hash };
    };
    const { navigator } = nav;
    return {
      ...nav,
      navigator: {
        ...navigator,
        createHref: (to: To) => navigator.createHref(here(to)),
        push: (to: To, state?: unknown, opts?: never) => navigator.push(here(to), state, opts),
        replace: (to: To, state?: unknown, opts?: never) => navigator.replace(here(to), state, opts),
        go: (n: number) => navigator.go(n),
      },
    };
  }, [nav, pathname, real.pathname]);
  return (
    <UNSAFE_NavigationContext.Provider value={value}>
      <UNSAFE_RouteContext.Provider value={ROOT}>
        <Routes location={{ pathname: pathname!, search: mergeSearch(search, real.search), hash: real.hash, state: real.state, key: `at:${path}` }}>{children}</Routes>
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_NavigationContext.Provider>
  );
};

/** A redirect that keeps the query parameters (filters, panels) of the old URL. */
export const Redirect: FC<{ to: string }> = ({ to }) => {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
};

/** One of Incendio's pages, at its own path, inside a console tab; its current project is the one that path names. */
export const IncendioAt: FC<{ path: string }> = ({ path }) => (
  <RenderAt path={path}>
    <Route
      path="*"
      element={
        <ProjectProvider>
          <IncendioApp />
        </ProjectProvider>
      }
    />
  </RenderAt>
);

/** Warnings over every cluster: which cluster each one is from. */
const ALL_WARNINGS: WarningListExtension = {
  columns: [{ header: "Cluster", cell: (w) => clusterOf(w.location ?? ""), sortValue: (w) => clusterOf(w.location ?? "") }],
};

/** The root's Warnings tab: Incendio's warning list over every cluster, with a Cluster column. */
export const AllWarnings: FC = () => (
  <WarningListExtensionContext.Provider value={ALL_WARNINGS}>
    <IncendioAt path="/ui/warnings" />
  </WarningListExtensionContext.Provider>
);
