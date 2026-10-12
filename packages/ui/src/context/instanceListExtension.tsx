import { createContext, useContext, type ReactNode } from "react";
import type { LxdInstance } from "types/instance";

/**
 * What a host application embedding Incendio adds to the instance list:
 * a pane beside it (an inventory tree), a summary above it, and which
 * instances it shows. Standalone Incendio provides none of it.
 */
export interface InstanceListExtension {
  aside?: ReactNode;
  above?: ReactNode;
  scope?: (instance: LxdInstance) => boolean;
}

export const InstanceListExtensionContext =
  createContext<InstanceListExtension>({});

export const useInstanceListExtension = () =>
  useContext(InstanceListExtensionContext);
