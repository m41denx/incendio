import type { FC, ReactNode } from "react";
import { EmptyState, Icon } from "@canonical/react-components";

/** What Incendio's list pages show when there is nothing yet. */
const EmptyList: FC<{ icon: string; title: string; action?: ReactNode; children: ReactNode }> = ({ icon, title, action, children }) => (
  <EmptyState className="empty-state" image={<Icon name={icon} className="empty-state-icon" />} title={title}>
    <p>{children}</p>
    {action}
  </EmptyState>
);

export default EmptyList;
