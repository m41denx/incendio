import { log } from "./log.ts";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  ok: boolean;
}

export interface ExecOptions {
  /** Written to the child's stdin, e.g. a manifest piped to `kubectl apply -f -`. */
  input?: string;
  /** Extra env merged over the agent's own process env. */
  env?: Record<string, string | undefined>;
  /** Hard timeout; the child is killed and code 124 is returned. */
  timeoutMs?: number;
}

/**
 * Thin wrapper over `Bun.spawn` for the CLI tools the agent brokers
 * (`clusterctl`, `kubectl`). The agent is a thin broker over CAPI/CAPN
 * (docs/k8s/deploy-model.md §4): rather than reimplement the CAPI client we
 * shell out to the same tools an operator would use, capture both streams, and
 * enforce a timeout so a wedged control plane can't hang a request forever.
 */
export async function run(
  cmd: string[],
  opts: ExecOptions = {},
): Promise<ExecResult> {
  log.debug(`exec: ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    stdin: opts.input === undefined ? "ignore" : new TextEncoder().encode(opts.input),
    stdout: "pipe",
    stderr: "pipe",
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });

  let timedOut = false;
  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, opts.timeoutMs);

  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (timer) clearTimeout(timer);

  if (timedOut) {
    return {
      code: 124,
      stdout,
      stderr: `${stderr}\n[timed out after ${String(opts.timeoutMs)}ms]`,
      ok: false,
    };
  }
  return { code, stdout, stderr, ok: code === 0 };
}

/** Compact one-line failure detail from an ExecResult (stderr, then stdout). */
export function execError(result: ExecResult): string {
  const detail = (result.stderr.trim() || result.stdout.trim() || "").replace(
    /\s+/g,
    " ",
  );
  return detail.length > 0 ? detail : `exited with code ${String(result.code)}`;
}
