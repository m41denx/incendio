import type { FC } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { ApplicationLayout } from "@canonical/react-components";
import { can, useMe } from "../api/hooks";
import type { Me } from "../api/types";
import Logo from "./Logo";
import { ErrorMessage, Loading } from "./Status";

const tenantAdmin = (me: Me) => me.tenants.some((t) => t.role === "owner" || t.role === "admin");

/** Sections the caller may use; the API still decides on every request. */
export function sections(me: Me) {
  const platformViewer = can(me, "viewer");
  const manages = platformViewer || tenantAdmin(me);
  return [
    { label: "Dashboard", icon: "switcher-dashboard", to: "/", end: true },
    { label: "Instances", icon: "containers", to: "/instances" },
    { label: "Clusters", icon: "cluster-host", to: "/clusters" },
    { label: "Tenants", icon: "switcher-environments", to: "/tenants" },
    { label: "Jobs", icon: "loading-steps", to: "/jobs" },
    { label: "Replication", icon: "restart", to: "/replication" },
    platformViewer && { label: "Users", icon: "user-group", to: "/users" },
    manages && { label: "Service accounts", icon: "applications", to: "/service-accounts" },
    manages && { label: "Audit log", icon: "show", to: "/audit" },
    manages && { label: "Gateway log", icon: "export", to: "/gateway-log" },
  ].filter((x): x is { label: string; icon: string; to: string; end?: boolean } => !!x);
}

/** Navigation and the current page. */
const Shell: FC = () => {
  const me = useMe();
  const navItems = me.data
    ? [
        { items: sections(me.data) },
        {
          items: [
            { label: me.data.name || "Profile", icon: "user", to: "/profile", title: "Profile" },
            <form key="logout" method="post" action="/auth/logout">
              <button type="submit" className="p-side-navigation__link ic-signout">
                <i className="p-icon--export is-light p-side-navigation__icon" />
                <span className="p-side-navigation__label">Sign out</span>
              </button>
            </form>,
          ],
        },
      ]
    : [];
  return (
    <ApplicationLayout logo={<Logo />} navItems={navItems} navLinkComponent={NavLink} dark mainId="main-content">
      {me.error ? <ErrorMessage error={me.error} /> : me.isPending ? <Loading /> : <Outlet />}
    </ApplicationLayout>
  );
};

export default Shell;
