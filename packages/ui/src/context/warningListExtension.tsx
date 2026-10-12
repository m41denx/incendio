import { createContext, useContext, type ReactNode } from "react";
import type { LxdWarning } from "types/warning";

/**
 * What a host application embedding Incendio adds to the warning list:
 * columns after "Project" (which cluster a warning is from, when the list
 * spans several). Standalone Incendio provides none.
 */
export interface WarningListColumn {
  header: string;
  cell: (warning: LxdWarning) => ReactNode;
  /** What the column sorts by; not sortable without it. */
  sortValue?: (warning: LxdWarning) => string | number;
}

export interface WarningListExtension {
  columns?: WarningListColumn[];
}

export const WarningListExtensionContext = createContext<WarningListExtension>(
  {},
);

export const useWarningListExtension = () =>
  useContext(WarningListExtensionContext);
