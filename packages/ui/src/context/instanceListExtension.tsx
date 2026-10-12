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
  /** Where "Create instance" leads for the project instances would be created in. */
  createPath?: (project: string) => string;
}

export const InstanceListExtensionContext =
  createContext<InstanceListExtension>({});

export const useInstanceListExtension = () =>
  useContext(InstanceListExtensionContext);
