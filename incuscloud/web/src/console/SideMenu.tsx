import type { FC, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Tab } from "./object";

/** A tab's pages beside the chosen one, as vSphere's Configure tab: square rows, the current one marked. */
const SideMenu: FC<{ label: string; items: Tab[]; children: ReactNode }> = ({ label, items, children }) => (
  <div className="ic-sidemenu">
    <nav className="ic-sidemenu__menu" aria-label={label}>
      <ul className="p-list u-no-margin--bottom">
        {items.map((i) => (
          <li key={i.to} className="p-list__item">
            <Link to={i.to} className="ic-sidemenu__link" aria-current={i.active ? "page" : undefined}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
    <div className="ic-sidemenu__body">{children}</div>
  </div>
);

export default SideMenu;
