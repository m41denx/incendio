import { useRef, useState, type FC, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import classnames from "classnames";
import { AppStatus, Application, Button, CustomLayout, Icon, SideNavigationItem, SkipLink } from "@canonical/react-components";
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
    { label: "Instances", icon: "pods", to: "/instances" },
    { label: "Clusters", icon: "cluster-host", to: "/clusters" },
    { label: "Tenants", icon: "switcher-environments", to: "/tenants" },
    { label: "Jobs", icon: "loading-steps", to: "/jobs" },
    { label: "Replication", icon: "restart", to: "/replication" },
    { label: "Backups", icon: "archive", to: "/backups" },
    { label: "Balancing", icon: "fork", to: "/balancing" },
    platformViewer && { label: "Backup targets", icon: "storage-bucket", to: "/backup-targets" },
    platformViewer && { label: "Users", icon: "user-group", to: "/users" },
    manages && { label: "Service accounts", icon: "applications", to: "/service-accounts" },
    manages && { label: "Audit log", icon: "show", to: "/audit" },
    manages && { label: "Gateway log", icon: "export", to: "/gateway-log" },
  ].filter((x): x is { label: string; icon: string; to: string; end?: boolean } => !!x);
}

/** Incendio's navigation link markup; `end` matches the path exactly (the dashboard at /). */
const NavItem: FC<{ to: string; title: string; icon: string; end?: boolean; children: ReactNode; onClick?: () => void }> = ({ to, title, icon, end, children, onClick }) => {
  const { pathname } = useLocation();
  const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SideNavigationItem>
      <Link to={to} title={title} className="p-side-navigation__link" aria-current={active ? "page" : undefined} onClick={onClick}>
        <Icon className="is-light p-side-navigation__icon" name={icon} /> {children}
      </Link>
    </SideNavigationItem>
  );
};

const COLLAPSED_KEY = "incuscloud.navCollapsed";
const remembered = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
};

/** Incendio's frame: the navigation, the page, and the status bar. */
const Shell: FC = () => {
  const me = useMe();
  const [collapsed, setCollapsed] = useState(remembered);
  const [mobileOpen, setMobileOpen] = useState(false);
  const logout = useRef<HTMLFormElement>(null);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // Not remembered in this browser; the choice still holds for this page.
    }
  };
  const closeMobile = () => setMobileOpen(false);

  return (
    <Application id="l-application">
      <SkipLink mainId="main-content" />
      <header className="l-navigation-bar">
        <div className="p-panel is-dark">
          <div className="p-panel__header">
            <Logo />
            <div className="p-panel__controls">
              <Button dense className="p-panel__toggle" onClick={() => setMobileOpen(true)}>
                Menu
              </Button>
            </div>
          </div>
        </div>
      </header>
      <nav aria-label="main navigation" className={classnames("l-navigation", { "is-collapsed": collapsed && !mobileOpen, "is-pinned": !collapsed || mobileOpen })}>
        <div className="l-navigation__drawer">
          <div className="p-panel is-dark">
            <div className="p-panel__header is-sticky">
              <Logo />
              <div className="p-panel__controls u-hide--medium u-hide--large">
                <Button appearance="base" hasIcon className="u-no-margin" aria-label="close navigation" onClick={closeMobile}>
                  <Icon name="close" />
                </Button>
              </div>
            </div>
            <div className="p-panel__content">
              <div className="p-side-navigation--icons sidenav-top-container">
                <ul className="p-side-navigation__list sidenav-top-ul">
                  {me.data &&
                    sections(me.data).map((s) => (
                      <NavItem key={s.to} to={s.to} title={s.label} icon={s.icon} end={s.end} onClick={closeMobile}>
                        {s.label}
                      </NavItem>
                    ))}
                </ul>
              </div>
              <div className="p-side-navigation--icons sidenav-bottom-container">
                <ul className="p-side-navigation__list sidenav-bottom-ul authenticated-nav">
                  <hr className="navigation-hr" />
                  {me.data && (
                    <>
                      <NavItem to="/profile" title="Profile" icon="user" onClick={closeMobile}>
                        <span className="u-truncate">{me.data.name || me.data.email || "Profile"}</span>
                      </NavItem>
                      <SideNavigationItem>
                        <form ref={logout} method="post" action="/auth/logout" hidden />
                        <a
                          className="p-side-navigation__link"
                          href="/auth/logout"
                          title="Sign out"
                          onClick={(e) => {
                            e.preventDefault();
                            logout.current?.submit();
                          }}
                        >
                          <Icon className="is-light p-side-navigation__icon p-side-logout" name="export" />
                          Sign out
                        </a>
                      </SideNavigationItem>
                    </>
                  )}
                </ul>
                <div className="sidenav-toggle-wrapper authenticated-nav">
                  <Button
                    appearance="base"
                    aria-label={`${collapsed ? "expand" : "collapse"} main navigation`}
                    hasIcon
                    dense
                    className="sidenav-toggle u-no-margin l-navigation-collapse-toggle u-hide--small"
                    onClick={toggle}
                  >
                    <Icon name="sidebar-toggle" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </nav>
      {me.error ? (
        <CustomLayout>
          <ErrorMessage error={me.error} />
        </CustomLayout>
      ) : me.isPending ? (
        <CustomLayout>
          <Loading />
        </CustomLayout>
      ) : (
        <Outlet />
      )}
      <AppStatus className="status-bar" id="status-bar">
        <span className="server-version p-text--small">Version {__APP_VERSION__}</span>
      </AppStatus>
    </Application>
  );
};

export default Shell;
