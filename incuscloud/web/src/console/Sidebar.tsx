import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import classnames from "classnames";
import { Button, Icon, SideNavigationItem } from "@canonical/react-components";
import { useMenuCollapsed } from "@incendio/ui/context/menuCollapsed";
import { can, canAtRoot, useMe } from "../api/hooks";
import type { Me } from "../api/types";
import Logo from "../components/Logo";
import { crumbsOf, objectOf } from "./object";
import Tree from "./Tree";
import KindIcon, { type Kind } from "./KindIcon";
import { useInventory } from "./useInventory";
import { VIEWS, type View } from "./views";

interface Section {
  label: string;
  icon: string;
  to: string;
}

const tenantAdmin = (me: Me) => me.tenants.some((t) => t.role === "owner" || t.role === "admin");

/** The platform's own pages; the API still decides on every request. The dashboard and the cluster list are the tree root's tabs. */
export function platformSections(me: Me): Section[] {
  const platformViewer = can(me, "viewer");
  const manages = platformViewer || tenantAdmin(me);
  const only = (xs: Array<Section | false>) => xs.filter((x): x is Section => !!x);
  return only([
    { label: "Tenants", icon: "switcher-environments", to: "/tenants" },
    { label: "Kubernetes", icon: "pods", to: "/kubernetes" },
    { label: "Jobs", icon: "loading-steps", to: "/jobs" },
    { label: "Replication", icon: "restart", to: "/replication" },
    { label: "Backups", icon: "archive", to: "/backups" },
    { label: "Balancing", icon: "fork", to: "/balancing" },
    platformViewer && { label: "Backup targets", icon: "storage-bucket", to: "/backup-targets" },
    platformViewer && { label: "Users", icon: "user-group", to: "/users" },
    platformViewer && { label: "Groups", icon: "user-group", to: "/groups" },
    canAtRoot(me, "acl.view") && { label: "Permissions", icon: "lock-locked", to: "/permissions" },
    manages && { label: "Service accounts", icon: "applications", to: "/service-accounts" },
    manages && { label: "Audit log", icon: "show", to: "/audit" },
    manages && { label: "Gateway log", icon: "export", to: "/gateway-log" },
  ]);
}

const VIEW_ICONS: Record<View, Kind> = { instances: "container", projects: "project", members: "member", networks: "network", storage: "pool" };
const MIN_WIDTH = 240;
const MAX_WIDTH = 360;

const stored = <T,>(key: string, fallback: T, parse: (s: string) => T | null): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (parse(v) ?? fallback);
  } catch {
    return fallback;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: a private window.
  }
};

const NavItem: FC<{ to: string; title: string; icon: string; children: ReactNode; onClick?: () => void }> = ({ to, title, icon, children, onClick }) => {
  const { pathname } = useLocation();
  const active = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <SideNavigationItem>
      <Link to={to} title={title} className="p-side-navigation__link" aria-current={active ? "page" : undefined} onClick={onClick}>
        <Icon className="is-light p-side-navigation__icon" name={icon} /> {children}
      </Link>
    </SideNavigationItem>
  );
};

/**
 * The console's sidebar, in Incendio's navigation style: the inventory
 * (a view, and the tree of every cluster), then the platform's pages and
 * the account, pinned below it. Its width can be dragged.
 */
const Sidebar: FC = () => {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const { menuCollapsed, updateMenuCollapsed } = useMenuCollapsed();
  const [view, setView] = useState<View>(() => stored("ic.view", "instances", (s) => (VIEWS.some((v) => v.view === s) ? (s as View) : null)));
  const [width, setWidth] = useState(() => stored("ic.sidebar", MIN_WIDTH, (s) => (Number.isFinite(+s) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, +s)) : null)));
  const { root, errors } = useInventory(view);
  const logout = useRef<HTMLFormElement>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const selected = crumbsOf(objectOf(pathname)).at(-1)?.to ?? "";
  const isSmall = typeof window !== "undefined" && window.matchMedia?.("(max-width: 619px)").matches;
  const close = () => {
    if (isSmall) updateMenuCollapsed(true);
  };

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.current.w + e.clientX - drag.current.x)));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.classList.remove("ic-resizing");
      setWidth((w) => {
        store("ic.sidebar", String(w));
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const choose = (v: View) => {
    setView(v);
    store("ic.view", v);
  };
  const toggle = () => updateMenuCollapsed(!menuCollapsed);

  return (
    <>
      <header className="l-navigation-bar">
        <div className="p-panel is-dark">
          <div className="p-panel__header">
            <Logo />
            <div className="p-panel__controls">
              <Button dense className="p-panel__toggle" onClick={toggle}>
                Menu
              </Button>
            </div>
          </div>
        </div>
      </header>
      <nav
        aria-label="main navigation"
        className={classnames("l-navigation ic-sidebar", { "is-collapsed": menuCollapsed, "is-pinned": !menuCollapsed })}
        style={{ ["--ic-sidebar-width" as string]: `${width}px` }}
      >
        <div className="l-navigation__drawer">
          <div className="p-panel is-dark">
            <div className="p-panel__header is-sticky">
              <Logo />
              <div className="p-panel__controls u-hide--medium u-hide--large">
                <Button appearance="base" hasIcon className="u-no-margin" aria-label="close navigation" onClick={toggle}>
                  <Icon name="close" />
                </Button>
              </div>
            </div>
            <div className="p-panel__content ic-sidebar__content">
              <div className="ic-sidebar__inventory">
                <div className="ic-sidebar__views" role="group" aria-label="Tree view">
                  {VIEWS.map((v) => (
                    <button key={v.view} type="button" className={classnames("ic-sidebar__view", { "is-active": v.view === view })} aria-label={v.label} aria-pressed={v.view === view} title={v.label} onClick={() => choose(v.view)}>
                      <KindIcon kind={VIEW_ICONS[v.view]} />
                    </button>
                  ))}
                </div>
                <div className="ic-sidebar__tree">
                  <Tree root={root} selected={selected} onSelect={close} />
                  {errors.length ? (
                    <p className="p-text--small ic-sidebar__error" title={errors.join("\n")}>
                      Some clusters did not answer.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="p-side-navigation--icons is-dark ic-sidebar__bottom">
                <ul className="p-side-navigation__list">
                  {me ? (
                    <>
                      <li className="ic-section-label">Platform</li>
                      {platformSections(me).map((s) => (
                        <NavItem key={s.to} to={s.to} title={s.label} icon={s.icon} onClick={close}>
                          {s.label}
                        </NavItem>
                      ))}
                      <li className="ic-section-label">Account</li>
                      <NavItem to="/profile" title="Profile" icon="user" onClick={close}>
                        <span className="u-truncate">{me.name || me.email || "Profile"}</span>
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
                  ) : null}
                </ul>
                <div className="sidenav-toggle-wrapper authenticated-nav">
                  <Button appearance="base" aria-label={`${menuCollapsed ? "expand" : "collapse"} main navigation`} hasIcon dense className="sidenav-toggle u-no-margin l-navigation-collapse-toggle u-hide--small" onClick={toggle}>
                    <Icon name="sidebar-toggle" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation"
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            aria-valuenow={width}
            className="ic-sidebar__handle"
            onMouseDown={(e) => {
              drag.current = { x: e.clientX, w: width };
              document.body.classList.add("ic-resizing");
            }}
          />
        </div>
      </nav>
    </>
  );
};

export default Sidebar;
