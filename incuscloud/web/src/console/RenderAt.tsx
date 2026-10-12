import type { FC, ReactNode } from "react";
import { Route, Routes, UNSAFE_RouteContext } from "react-router-dom";
import IncendioApp from "@incendio/ui/App";
import { ProjectProvider } from "@incendio/ui/context/useCurrentProject";
import { WarningListExtensionContext, type WarningListExtension } from "@incendio/ui/context/warningListExtension";
import { clusterOf } from "../pages/inventory/tree";

/** No parent route: the routes below match from the root, whatever console route renders them. */
const ROOT = { outlet: null, matches: [], isDataRoute: false };

/**
 * Renders `routes` as if the URL were `path`: their `useLocation` and
 * `useParams` see `path`, while the browser stays on the console URL (and
 * its Referer tells the facade which cluster the page is about). Links and
 * navigation inside go to real URLs.
 */
export const RenderAt: FC<{ path: string; children: ReactNode }> = ({ path, children }) => {
  const [pathname, search = ""] = path.split("?");
  return (
    <UNSAFE_RouteContext.Provider value={ROOT}>
      <Routes location={{ pathname: pathname!, search: search ? `?${search}` : "", hash: "", state: null, key: `at:${path}` }}>{children}</Routes>
    </UNSAFE_RouteContext.Provider>
  );
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
