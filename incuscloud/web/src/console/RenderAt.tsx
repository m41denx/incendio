import type { FC, ReactNode } from "react";
import { Route, Routes, UNSAFE_RouteContext } from "react-router-dom";
import IncendioApp from "@incendio/ui/App";

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

/** One of Incendio's pages, at its own path, inside a console tab. */
export const IncendioAt: FC<{ path: string }> = ({ path }) => (
  <RenderAt path={path}>
    <Route path="*" element={<IncendioApp />} />
  </RenderAt>
);
