import type { FC, ReactNode } from "react";
import { Icon } from "@canonical/react-components";

/** Failure text with Incendio's failed status icon; the detail shows on hover. */
const Failed: FC<{ title?: string; children: ReactNode }> = ({ title, children }) => (
  <span title={title}>
    <Icon name="status-failed-small" className="status-icon" />
    {children}
  </span>
);

export default Failed;
