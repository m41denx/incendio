// Run a non-interactive command inside an Incus instance and collect its
// output — how the UI maintains the management appliance (agent updates)
// without depending on the agent's own API.
import { handleResponse } from "util/helpers";
import { ROOT_PATH } from "util/rootPath";
import type { LxdApiResponse } from "types/apiResponse";
import type { LxdOperationResponse } from "types/operation";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface ExecMetadata {
  return?: number;
  output?: Record<string, string>;
}

interface WaitedOperation {
  status_code: number;
  err: string;
  metadata?: ExecMetadata;
}

const withProject = (path: string, project: string): string =>
  `${ROOT_PATH}${path}?${new URLSearchParams({ project }).toString()}`;

const readOutput = async (
  path: string | undefined,
  project: string,
): Promise<string> => {
  if (!path) return "";
  const res = await fetch(withProject(path, project));
  const text = res.ok ? await res.text() : "";
  // The recorded output stays on the server until deleted.
  await fetch(withProject(path, project), { method: "DELETE" }).catch(
    () => undefined,
  );
  return text;
};

export const execInInstance = async (
  project: string,
  instance: string,
  command: string[],
  timeoutSeconds = 300,
): Promise<ExecResult> => {
  const started = (await fetch(
    withProject(`/1.0/instances/${encodeURIComponent(instance)}/exec`, project),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command,
        environment: {},
        interactive: false,
        "wait-for-websocket": false,
        "record-output": true,
      }),
    },
  ).then(handleResponse)) as LxdOperationResponse;

  const waited = (await fetch(
    `${ROOT_PATH}${started.operation}/wait?timeout=${String(timeoutSeconds)}`,
  ).then(handleResponse)) as LxdApiResponse<WaitedOperation>;
  const operation = waited.metadata;
  if (operation.status_code >= 400) {
    throw new Error(operation.err || "command failed to run");
  }
  if (operation.status_code !== 200) {
    throw new Error(`command did not finish within ${String(timeoutSeconds)}s`);
  }
  const metadata = operation.metadata ?? {};
  const [stdout, stderr] = await Promise.all([
    readOutput(metadata.output?.["1"], project),
    readOutput(metadata.output?.["2"], project),
  ]);
  return { code: metadata.return ?? -1, stdout, stderr };
};
