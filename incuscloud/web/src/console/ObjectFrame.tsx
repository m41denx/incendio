import { type FC, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ContextualMenu } from "@canonical/react-components";
import { can, useMe } from "../api/hooks";
import { crumbsOf, objectOf, subsOf, tabsOf, type Tab } from "./object";
import SideMenu from "./SideMenu";

/**
 * How many tabs fit in `available` pixels: all of them, or as many as fit
 * beside a "More" menu `moreWidth` wide. Unknown space (0) fits everything.
 */
export function fitTabs(widths: number[], available: number, moreWidth: number): number {
  const total = widths.reduce((a, b) => a + b, 0);
  if (available <= 0 || total <= available) return widths.length;
  let used = moreWidth;
  let n = 0;
  for (const w of widths) {
    if (used + w > available) break;
    used += w;
    n++;
  }
  return Math.max(1, n);
}

const MORE_WIDTH = 96;

/** The selected object's one row of tabs; what does not fit goes into More. */
const TabRow: FC<{ tabs: Tab[] }> = ({ tabs }) => {
  const row = useRef<HTMLDivElement>(null);
  const widths = useRef<number[]>([]);
  const [shown, setShown] = useState(tabs.length);
  const key = tabs.map((t) => t.label).join("|");

  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    // Measured once, with every tab shown.
    widths.current = [...el.querySelectorAll<HTMLElement>(".p-tabs__item")].map((li) => li.offsetWidth);
    const fit = () => setShown(fitTabs(widths.current, el.clientWidth, MORE_WIDTH));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // Re-measure when the object (its tabs) changes.
  }, [key]);

  const visible = tabs.slice(0, shown);
  const more = tabs.slice(shown);
  return (
    <div className="ic-tabs" ref={row}>
      <nav className="p-tabs" aria-label="Sections">
        <ul className="p-tabs__list u-no-margin--bottom">
          {visible.map((t) => (
            <li key={t.label} className="p-tabs__item">
              <Link className="p-tabs__link" to={t.to} aria-current={t.active ? "page" : undefined}>
                {t.label}
              </Link>
            </li>
          ))}
          {more.length ? (
            <li className="p-tabs__item">
              <ContextualMenu
                toggleLabel={more.some((t) => t.active) ? `${more.find((t) => t.active)!.label} ▾` : "More ▾"}
                toggleAppearance="base"
                toggleClassName="p-tabs__link ic-tabs__more u-no-margin--bottom"
                position="right"
                links={more.map((t) => ({ children: t.label, element: Link, to: t.to, "aria-current": t.active ? ("page" as const) : undefined }))}
              />
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
};

/**
 * Above the page: where the selected object sits (a breadcrumb back up the
 * tree) and its one row of tabs. Objects whose page has its own row of tabs
 * (instances, nodes, networks, pools, profiles) get only the breadcrumb.
 * Pages that are no inventory object (platform pages) are left as they are.
 */
const ObjectFrame: FC<{ children: ReactNode }> = ({ children }) => {
  const { pathname } = useLocation();
  const { data: me } = useMe();
  const obj = objectOf(pathname);
  if (obj.kind === "none") return <>{children}</>;
  const crumbs = crumbsOf(obj);
  const who = { operator: can(me, "operator"), viewer: can(me, "viewer") };
  const tabs = tabsOf(obj, who);
  const subs = subsOf(obj, who);
  const tab = tabs.find((t) => t.active);
  return (
    <div className="l-main ic-object">
      <div className="ic-object__head">
        <nav className="p-breadcrumbs ic-breadcrumbs" aria-label="Breadcrumbs">
          <ol className="p-breadcrumbs__items u-no-margin--bottom">
            {crumbs.map((c, i) => (
              <li key={`${i}:${c.to}`} className="p-breadcrumbs__item">
                {c.to ? (
                  <Link to={c.to} aria-current={i === crumbs.length - 1 ? "location" : undefined}>
                    {c.label}
                  </Link>
                ) : (
                  <span aria-current="location">{c.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {tabs.length ? <TabRow key={tabs.map((t) => t.label).join("|")} tabs={tabs} /> : null}
      </div>
      <div className="ic-object__body">
        {subs.length && tab ? (
          <SideMenu label={tab.label} items={subs}>
            {children}
          </SideMenu>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

export default ObjectFrame;
