import type { FC } from "react";
import { Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import NotFound from "./pages/NotFound";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import InstanceList from "./pages/instances/InstanceList";
import InstanceDetail from "./pages/instances/InstanceDetail";
import JobList from "./pages/jobs/JobList";
import JobDetail from "./pages/jobs/JobDetail";
import PolicyList from "./pages/replication/PolicyList";
import BackupList from "./pages/backups/BackupList";
import TargetList from "./pages/backups/TargetList";
import Suggestions from "./pages/balancing/Suggestions";
import CreateInstance from "./pages/instances/CreateInstance";
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
      <Route path="instances" element={<InstanceList />} />
      <Route path="instances/new" element={<CreateInstance />} />
      <Route path="instances/:id" element={<InstanceDetail />} />
      <Route path="jobs" element={<JobList />} />
      <Route path="jobs/:id" element={<JobDetail />} />
      <Route path="replication" element={<PolicyList />} />
      <Route path="backups" element={<BackupList />} />
      <Route path="balancing" element={<Suggestions />} />
      <Route path="backup-targets" element={<TargetList />} />
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
