import type { FC } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Shell from "./components/Shell";
import IncendioPages from "./components/IncendioPages";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import KubernetesList from "./pages/kubernetes/KubernetesList";
import CreateKubernetes from "./pages/kubernetes/CreateKubernetes";
import KubernetesDetail from "./pages/kubernetes/KubernetesDetail";
import InstanceDetail from "./pages/instances/InstanceDetail";
import JobList from "./pages/jobs/JobList";
import JobDetail from "./pages/jobs/JobDetail";
import PolicyList from "./pages/replication/PolicyList";
import BackupList from "./pages/backups/BackupList";
import TargetList from "./pages/backups/TargetList";
import Suggestions from "./pages/balancing/Suggestions";
import ClusterList from "./pages/clusters/ClusterList";
import TenantList from "./pages/tenants/TenantList";
import TenantDetail from "./pages/tenants/TenantDetail";
import UserList from "./pages/users/UserList";
import UserDetail from "./pages/users/UserDetail";
import ServiceAccountList from "./pages/service-accounts/ServiceAccountList";
import AuditLog from "./pages/logs/AuditLog";
import GatewayLog from "./pages/logs/GatewayLog";
import { AllWarnings, IncendioAt } from "./console/RenderAt";
import { ClusterIncendio, ClusterProjects, ClusterRedirect, ClusterRename, ClusterSub, ClusterSummary } from "./console/ClusterPages";


export const AppRoutes: FC = () => (
  <Routes>
    <Route element={<Shell />}>
      {/* The tree's root, "All clusters": its Summary is the dashboard. */}
      <Route index element={<Dashboard />} />
      <Route path="all/clusters" element={<ClusterList />} />
      <Route path="all/instances" element={<IncendioAt path="/ui/all-projects/instances" />} />
      <Route path="all/warnings" element={<AllWarnings />} />
      {/* A cluster: its tabs, Incendio's pages for it under the console URL (which tells the facade the cluster). */}
      <Route path="inventory/:cluster" element={<ClusterSummary />} />
      <Route path="inventory/:cluster/members" element={<ClusterIncendio path={() => "/ui/cluster/members"} />} />
      <Route path="inventory/:cluster/nodes" element={<ClusterRename to="members" />} />
      <Route path="inventory/:cluster/projects" element={<ClusterProjects />} />
      <Route path="inventory/:cluster/operations" element={<ClusterIncendio path={() => "/ui/operations"} />} />
      {/* Tabs with a side menu (groups, networks, storage, access, configure): the page it names. */}
      <Route path="inventory/:cluster/:tab" element={<ClusterSub />} />
      <Route path="inventory/:cluster/:tab/:sub" element={<ClusterSub />} />
      {/* Old links. */}
      <Route path="instances" element={<Navigate to="/all/instances" replace />} />
      <Route path="instances/new" element={<Navigate to="/all/instances" replace />} />
      <Route path="ui/all-projects/instances" element={<Navigate to="/all/instances" replace />} />
      <Route path="ui/warnings" element={<Navigate to="/all/warnings" replace />} />
      <Route path="clusters" element={<Navigate to="/all/clusters" replace />} />
      <Route path="clusters/:id" element={<ClusterRedirect />} />
      <Route path="instances/:id" element={<InstanceDetail />} />
      <Route path="kubernetes" element={<KubernetesList />} />
      <Route path="kubernetes/new" element={<CreateKubernetes />} />
      <Route path="kubernetes/:id" element={<KubernetesDetail />} />
      <Route path="jobs" element={<JobList />} />
      <Route path="jobs/:id" element={<JobDetail />} />
      <Route path="replication" element={<PolicyList />} />
      <Route path="backups" element={<BackupList />} />
      <Route path="balancing" element={<Suggestions />} />
      <Route path="backup-targets" element={<TargetList />} />
      <Route path="tenants" element={<TenantList />} />
      <Route path="tenants/:id" element={<TenantDetail />} />
      <Route path="users" element={<UserList />} />
      <Route path="users/:id" element={<UserDetail />} />
      <Route path="service-accounts" element={<ServiceAccountList />} />
      <Route path="audit" element={<AuditLog />} />
      <Route path="gateway-log" element={<GatewayLog />} />
      <Route path="profile" element={<Profile />} />
      <Route path="*" element={<IncendioPages />} />
    </Route>
  </Routes>
);
