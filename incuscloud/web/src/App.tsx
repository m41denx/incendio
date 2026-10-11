import type { FC } from "react";
import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import NotFound from "./pages/NotFound";
import PageLayout from "./components/PageLayout";
import UserList from "./pages/users/UserList";
import UserDetail from "./pages/users/UserDetail";

// Filled in by the following tasks of the P4 plan.
const Pending: FC<{ title: string }> = ({ title }) => (
  <PageLayout title={title}>
    <p className="ic-muted">Not built yet.</p>
  </PageLayout>
);

export const AppRoutes: FC = () => (
  <Routes>
    <Route element={<Shell />}>
      <Route index element={<Pending title="Dashboard" />} />
      <Route path="clusters" element={<Pending title="Clusters" />} />
      <Route path="tenants" element={<Pending title="Tenants" />} />
      <Route path="users" element={<UserList />} />
      <Route path="users/:id" element={<UserDetail />} />
      <Route path="service-accounts" element={<Pending title="Service accounts" />} />
      <Route path="audit" element={<Pending title="Audit log" />} />
      <Route path="gateway-log" element={<Pending title="Gateway log" />} />
      <Route path="profile" element={<Pending title="Profile" />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
);
