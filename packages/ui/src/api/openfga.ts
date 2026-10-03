import axios from "axios";
import {
  CredentialsMethod,
  FgaApiAuthenticationError,
  FgaApiError,
  FgaApiNotFoundError,
  OpenFgaClient,
  type AuthorizationModel,
  type TupleKey,
} from "@openfga/sdk";
import type { FgaTuple } from "util/openfga";

/**
 * Talking to the OpenFGA server Incus is configured with, straight from the
 * browser. The URL, store and preshared key come from the server config, which
 * Incus only returns to users allowed to see sensitive settings (admins), so
 * nobody else gets the key. OpenFGA must be reachable from the admin's
 * browser over HTTPS and allow this origin (CORS).
 */

export interface OpenFgaSettings {
  url: string;
  token: string;
  storeId: string;
}

const PAGE_SIZE = 100;

export const createOpenFgaClient = (settings: OpenFgaSettings): OpenFgaClient =>
  new OpenFgaClient(
    {
      apiUrl: settings.url.replace(/\/+$/, ""),
      storeId: settings.storeId,
      credentials: settings.token
        ? {
            method: CredentialsMethod.ApiToken,
            config: { token: settings.token },
          }
        : undefined,
      // An unreachable server should fail fast instead of retrying for long.
      retryParams: { maxRetry: 1, minWaitInMs: 200 },
    },
    // Our own axios instance: the SDK's default one sets up Node http agents,
    // which do not exist in the browser.
    axios.create({ timeout: 15_000 }),
  );

export const fetchStoreName = async (client: OpenFgaClient): Promise<string> =>
  (await client.getStore()).name;

export const fetchLatestModel = async (
  client: OpenFgaClient,
): Promise<AuthorizationModel | undefined> =>
  (await client.readLatestAuthorizationModel()).authorization_model;

/** Every tuple in the store, page by page. */
export const fetchAllTuples = async (
  client: OpenFgaClient,
): Promise<TupleKey[]> => {
  const tuples: TupleKey[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await client.read(
      {},
      { pageSize: PAGE_SIZE, continuationToken },
    );
    tuples.push(...page.tuples.map((t) => t.key));
    continuationToken = page.continuation_token || undefined;
  } while (continuationToken);
  return tuples;
};

/** Add and remove tuples in one transaction. */
export const writeTuples = async (
  client: OpenFgaClient,
  writes: FgaTuple[],
  deletes: FgaTuple[] = [],
): Promise<void> => {
  await client.write({
    writes: writes.length > 0 ? writes : undefined,
    deletes: deletes.length > 0 ? deletes : undefined,
  });
};

export const checkTuple = async (
  client: OpenFgaClient,
  tuple: FgaTuple,
): Promise<boolean> => (await client.check(tuple)).allowed ?? false;

/** A message that says what to fix, for any error the client throws. */
export const describeOpenFgaError = (error: unknown): string => {
  if (error instanceof FgaApiAuthenticationError) {
    return "OpenFGA rejected the API token. Check authorization.openfga.api.token against the server's preshared keys.";
  }
  if (error instanceof FgaApiNotFoundError) {
    return "OpenFGA does not know this store. Check authorization.openfga.store.id.";
  }
  if (error instanceof FgaApiError) {
    return `OpenFGA answered ${error.statusCode ?? "with an error"}: ${
      error.apiErrorMessage ?? error.message
    }`;
  }
  return (
    "OpenFGA could not be reached from this browser. Check that the URL is " +
    "reachable from your machine, uses HTTPS (an http URL is blocked on an " +
    "HTTPS page), and that OpenFGA allows this page's origin in " +
    "--http-cors-allowed-origins."
  );
};
