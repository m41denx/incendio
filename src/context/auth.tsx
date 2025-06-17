import { createContext, useContext, type FC, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "util/queryKeys";
import { fetchCertificates } from "api/certificates";
import { fetchProjects } from "api/projects";
import { useSupportedFeatures } from "./useSupportedFeatures";
import { getLoginProject } from "util/loginProject";
import { AUTH_METHOD, type LXDAuthMethod } from "util/authentication";

interface ContextProps {
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  authError: Error | null;
  isRestricted: boolean;
  defaultProject: string;
  hasNoProjects: boolean;
  isFineGrained: boolean | null;
  serverEntitlements: string[];
  authMethod: LXDAuthMethod | null;
  authExpiresAt: string | null;
}

const initialState: ContextProps = {
  isAuthenticated: false,
  isAuthLoading: true,
  authError: null,
  isRestricted: false,
  defaultProject: "default",
  hasNoProjects: false,
  isFineGrained: null,
  serverEntitlements: [],
  authMethod: null,
  authExpiresAt: null,
};

export const AuthContext = createContext<ContextProps>(initialState);

interface ProviderProps {
  children: ReactNode;
}

export const AuthProvider: FC<ProviderProps> = ({ children }) => {
  const {
    hasReplicators,
    isSettingsLoading,
    settings,
    settingsError,
  } = useSupportedFeatures();

  const authMethod = settings?.auth_user_method ?? null;

  const isFineGrained = () => {
    if (isSettingsLoading) {
      return null;
    }

    return false;
  };

  const { data: projects = [], isLoading: isProjectsLoading } = useQuery({
    queryKey: [queryKeys.projects],
    queryFn: async () => fetchProjects(isFineGrained(), hasReplicators),
    enabled: settings?.auth === "trusted" && isFineGrained() !== null,
  });

  const defaultProject = getLoginProject(projects);
  const isTls = authMethod === AUTH_METHOD.TLS;

  const { data: certificates = [] } = useQuery({
    queryKey: [queryKeys.certificates, 1],
    queryFn: fetchCertificates,
    enabled: isTls,
  });

  const fingerprint = isTls ? settings?.auth_user_name : undefined;
  const certificate = certificates.find(
    (certificate) => certificate.fingerprint === fingerprint,
  );
  // Fine grained permissions are disabled on Incus, so restriction is
  // determined solely by the TLS certificate / default project.
  const isRestricted =
    certificate?.restricted ?? defaultProject !== "default";

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: (settings && settings.auth !== "untrusted") ?? false,
        isAuthLoading: isSettingsLoading || isProjectsLoading,
        authError: settingsError ?? null,
        isRestricted,
        defaultProject,
        hasNoProjects: projects.length === 0 && !isProjectsLoading,
        serverEntitlements: [],
        authExpiresAt: null,
        isFineGrained: isFineGrained(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  return useContext(AuthContext);
}
