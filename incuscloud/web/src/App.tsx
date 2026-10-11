import type { FC } from "react";
import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import ClusterList from "./pages/clusters/ClusterList";
import ClusterDetail from "./pages/clusters/ClusterDetail";
import TenantList from "./pages/tenants/TenantList";
import TenantDetail from "./pages/tenants/TenantDetail";
import UserList from "./pages/users/UserList";
import UserDetail from "./pages/users/UserDetail";
import ServiceAccountList from "./pages/service-accounts/ServiceAccountList";
import AuditLog from "./pages/logs/AuditLog";
import GatewayLog from "./pages/logs/GatewayLog";

export const AppRoutes: FC = () => (
  <Routes>
    <Route element={<Shell />}>
      <Route index element={<Dashboard />} />
      <Route path="clusters" element={<ClusterList />} />
      <Route path="clusters/:id" element={<ClusterDetail />} />
      <Route path="tenants" element={<TenantList />} />
      <Route path="tenants/:id" element={<TenantDetail />} />
      <Route path="users" element={<UserList />} />
      <Route path="users/:id" element={<UserDetail />} />
      <Route path="service-accounts" element={<ServiceAccountList />} />
      <Route path="audit" element={<AuditLog />} />
      <Route path="gateway-log" element={<GatewayLog />} />
      <Route path="profile" element={<Profile />} />
      <Route path="*" element={<NotFound />} />
    </Route>
  </Routes>
);
