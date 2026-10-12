import { createContext, useContext, type ReactNode } from "react";

/** Navigation sections a host may leave out (they belong to it, or mean nothing there). */
export type NavigationSection =
  | "kubernetes"
  | "permissions"
  | "settings"
  | "os";

/**
 * What a host application embedding Incendio adds to or changes in its
 * navigation. Standalone Incendio provides none of it.
 */
export interface NavigationExtension {
  /** Replaces Incendio's logo. */
  logo?: ReactNode;
  /** Items before the project selector; `close` closes the menu on small screens. */
  before?: (close: () => void) => ReactNode;
  /** Items after Incendio's own sections. */
  after?: (close: () => void) => ReactNode;
  /** Replaces the account, help and log-out items at the bottom. */
  account?: (close: () => void) => ReactNode;
  /** Where "Instances" leads for the selected project. */
  instancesPath?: (project: string) => string;
  hide?: NavigationSection[];
}

export const NavigationExtensionContext = createContext<NavigationExtension>(
  {},
);

export const useNavigationExtension = () =>
  useContext(NavigationExtensionContext);
