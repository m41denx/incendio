// First, as Incendio does: component styles (react-components) must come after Vanilla's.
import "./sass/styles.scss";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import AppProviders, { queryClient } from "@incendio/ui/context/appProviders";
import { ApiError } from "./api/client";
import { AppRoutes } from "./App";

// A data router: Incendio's forms block navigation away from unsaved changes.
// Incendio's providers (one query cache, auth, projects, operations, toasts) wrap both apps.
// The platform API's 4xx answers will not change by asking again (Incendio's retries stay for its own).
const incendioRetry = queryClient.getDefaultOptions().queries?.retry;
queryClient.setDefaultOptions({
  queries: {
    ...queryClient.getDefaultOptions().queries,
    retry: (n, e) => (e instanceof ApiError ? e.status >= 500 && n < 2 : typeof incendioRetry === "function" ? incendioRetry(n, e) : n < 3),
  },
});

const router = createBrowserRouter([
  {
    path: "*",
    Component: () => (
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    ),
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
