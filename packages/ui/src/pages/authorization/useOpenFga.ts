import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { AuthorizationModel } from "@openfga/sdk";
import { useSupportedFeatures } from "context/useSupportedFeatures";
import {
  createOpenFgaClient,
  fetchAllTuples,
  fetchLatestModel,
  fetchStoreName,
  writeTuples,
  type OpenFgaSettings,
} from "api/openfga";
import { queryKeys } from "util/queryKeys";
import {
  allRelations,
  classifyTuples,
  grantableRelations,
  type FgaState,
  type FgaTuple,
} from "util/openfga";

/** Optional URL the browser uses when Incus reaches OpenFGA by another one. */
export const BROWSER_URL_KEY = "user.incendio.openfga.url";

export interface OpenFgaKeys {
  url: string;
  token: string;
  storeId: string;
  tlsIdentifier: string;
}

/** Server config keys holding the OpenFGA settings on this Incus version. */
export const useOpenFgaKeys = (): OpenFgaKeys => {
  const { hasAuthorizationConfig } = useSupportedFeatures();
  const prefix = hasAuthorizationConfig ? "authorization.openfga" : "openfga";
  return {
    url: `${prefix}.api.url`,
    token: `${prefix}.api.token`,
    storeId: `${prefix}.store.id`,
    tlsIdentifier: `${prefix}.tls.identifier`,
  };
};

export interface OpenFgaConnection {
  /** The settings, when Incus has an OpenFGA server configured. */
  settings?: OpenFgaSettings;
  /** The URL Incus itself uses. */
  serverUrl?: string;
  isLoading: boolean;
}

export const useOpenFgaSettings = (): OpenFgaConnection => {
  const { settings, isSettingsLoading } = useSupportedFeatures();
  const keys = useOpenFgaKeys();
  const config = settings?.config ?? {};
  const serverUrl = config[keys.url];
  const storeId = config[keys.storeId];
  const token = config[keys.token] ?? "";
  const url = config[BROWSER_URL_KEY] || serverUrl;
  return useMemo(
    () => ({
      settings: url && storeId ? { url, storeId, token } : undefined,
      serverUrl,
      isLoading: isSettingsLoading,
    }),
    [url, storeId, token, serverUrl, isSettingsLoading],
  );
};

export interface OpenFgaData extends FgaState {
  storeName: string;
  model: AuthorizationModel;
  /** Relations users and groups can be granted, by object type. */
  grantable: Record<string, string[]>;
  /** Every relation, by object type, for checks. */
  relations: Record<string, string[]>;
}

const dataKey = (settings?: OpenFgaSettings) => [
  queryKeys.openfga,
  settings?.url,
  settings?.storeId,
];

export const useOpenFgaClient = (settings?: OpenFgaSettings) =>
  useMemo(
    () => (settings ? createOpenFgaClient(settings) : undefined),
    [settings?.url, settings?.storeId, settings?.token],
  );

/** The store's model, grants, groups and the objects Incus synced. */
export const useOpenFgaData = (
  settings?: OpenFgaSettings,
): UseQueryResult<OpenFgaData> => {
  const client = useOpenFgaClient(settings);
  return useQuery({
    queryKey: dataKey(settings),
    enabled: !!client,
    retry: false,
    queryFn: async (): Promise<OpenFgaData> => {
      if (!client) {
        throw new Error("OpenFGA is not configured");
      }
      const [storeName, model, tuples] = await Promise.all([
        fetchStoreName(client),
        fetchLatestModel(client),
        fetchAllTuples(client),
      ]);
      if (!model) {
        throw new Error(
          "The OpenFGA store has no authorization model yet. Incus writes it when it connects; check the Incus logs.",
        );
      }
      const grantable = grantableRelations(model);
      return {
        storeName,
        model,
        grantable,
        relations: allRelations(model),
        ...classifyTuples(tuples, grantable),
      };
    },
  });
};

/** Write and delete tuples, then reload the store. */
export const useWriteTuples = (settings?: OpenFgaSettings) => {
  const client = useOpenFgaClient(settings);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      writes = [],
      deletes = [],
    }: {
      writes?: FgaTuple[];
      deletes?: FgaTuple[];
    }) => {
      if (!client) {
        throw new Error("OpenFGA is not configured");
      }
      await writeTuples(client, writes, deletes);
    },
    onSettled: async () =>
      queryClient.invalidateQueries({ queryKey: dataKey(settings) }),
  });
};
