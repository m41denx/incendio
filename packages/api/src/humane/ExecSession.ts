import type { IncusAPIClient } from "../api/client";
import type { ScopeOptions, WebSocketLike } from "../api/base/types";
import type { Operation } from "../api/types/generated";
import { IncusOperation } from "./Operation";

export type ExecStream = "stdout" | "stderr";

const toBytes = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array();
};

const open = (socket: WebSocketLike): Promise<void> =>
  new Promise((resolve, reject) => {
    if (socket.readyState === 1) return resolve();
    socket.onopen = () => resolve();
    socket.onerror = (error) => reject(error);
  });

/**
 * A running command with attached websockets (`wait-for-websocket: true`).
 * Interactive sessions have one PTY stream (reported as `stdout`); others
 * have separate stdout/stderr pipes.
 *
 * @example
 * const session = await instance.execInteractive(["bash"], { width: 120, height: 40 });
 * session.onData((bytes) => terminal.write(bytes));
 * terminal.onData((text) => session.write(text));
 * const exitCode = await session.wait();
 */
export class ExecSession {
  readonly operation: IncusOperation;
  readonly interactive: boolean;
  private readonly stdin: WebSocketLike;
  private readonly control: WebSocketLike;
  private readonly outputs: [ExecStream, WebSocketLike][];
  private readonly listeners = new Set<
    (data: Uint8Array, stream: ExecStream) => void
  >();
  private readonly ended: Promise<void>;

  private constructor(
    operation: IncusOperation,
    interactive: boolean,
    stdin: WebSocketLike,
    control: WebSocketLike,
    outputs: [ExecStream, WebSocketLike][],
  ) {
    this.operation = operation;
    this.interactive = interactive;
    this.stdin = stdin;
    this.control = control;
    this.outputs = outputs;

    const ends = outputs.map(
      ([stream, socket]) =>
        new Promise<void>((resolve) => {
          socket.onmessage = ({ data }) => {
            // A text frame is the end-of-stream barrier; data is binary.
            if (typeof data === "string") return resolve();
            const bytes = toBytes(data);
            for (const listener of this.listeners) listener(bytes, stream);
          };
          socket.onclose = () => resolve();
        }),
    );
    this.ended = Promise.all(ends).then(() => undefined);
  }

  /** Connects to the websockets of an exec operation. */
  static async attach(
    api: IncusAPIClient,
    op: Operation,
    interactive: boolean,
    opts?: ScopeOptions,
  ): Promise<ExecSession> {
    const fds = (op.metadata?.fds ?? {}) as Record<string, string>;
    const connect = async (fd: string) => {
      const socket = await api.operations.websocket(op.id, fds[fd]!, opts);
      await open(socket);
      return socket;
    };
    // Connect data streams before `control`: the command starts once all are attached.
    const stdin = await connect("0");
    const outputs: [ExecStream, WebSocketLike][] = interactive
      ? [["stdout", stdin]]
      : [
          ["stdout", await connect("1")],
          ["stderr", await connect("2")],
        ];
    const control = await connect("control");
    return new ExecSession(
      new IncusOperation(api, op),
      interactive,
      stdin,
      control,
      outputs,
    );
  }

  /** Subscribes to output. Returns an unsubscribe function. */
  onData(listener: (data: Uint8Array, stream: ExecStream) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Writes to the command's stdin. */
  write(data: string | Uint8Array): void {
    this.stdin.send(
      typeof data === "string" ? new TextEncoder().encode(data) : data,
    );
  }

  /** Signals end of input (non-interactive commands reading stdin). */
  closeStdin(): void {
    this.stdin.send("");
  }

  /** Resizes the PTY (interactive only). */
  resize(width: number, height: number): void {
    this.control.send(
      JSON.stringify({
        command: "window-resize",
        args: { width: String(width), height: String(height) },
      }),
    );
  }

  /** Sends a signal to the command, e.g. `15` (SIGTERM). */
  signal(signal: number): void {
    this.control.send(JSON.stringify({ command: "signal", signal }));
  }

  /** Waits for the command to exit and returns its exit code. */
  async wait(): Promise<number> {
    const op = await this.operation.wait();
    await this.ended;
    this.close();
    return Number(op.metadata?.return ?? -1);
  }

  /** Closes all websockets (the command keeps running if still alive). */
  close(): void {
    const sockets = new Set([
      this.stdin,
      this.control,
      ...this.outputs.map(([, s]) => s),
    ]);
    for (const socket of sockets) {
      if (socket.readyState <= 1) socket.close();
    }
  }
}
