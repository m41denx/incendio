import { Resource } from "./base/request";
import type { ScopeOptions, WebSocketLike } from "./base/types";
import type {
  Event,
  EventLifecycle,
  EventLogging,
  EventType,
  Operation,
} from "./types/generated";

/** An event with its `metadata` typed by `type`. */
export type IncusEvent =
  | (Event & { type: "lifecycle"; metadata: EventLifecycle })
  | (Event & { type: "logging"; metadata: EventLogging })
  | (Event & { type: "operation"; metadata: Operation })
  | (Event & {
      type: Exclude<EventType, "lifecycle" | "logging" | "operation">;
    });

export type EventOf<K extends EventType> = Extract<IncusEvent, { type: K }>;

export interface EventsOptions<
  K extends EventType = EventType,
> extends ScopeOptions {
  /** Event types to receive (default: all). */
  types?: K[];
  /** Receive events from every project. */
  allProjects?: boolean;
}

export interface EventSubscription {
  /** Closes the websocket. */
  close(): void;
  /** Resolves when the socket is closed (by either side). */
  readonly closed: Promise<void>;
  readonly socket: WebSocketLike;
}

const decode = (data: unknown): string =>
  typeof data === "string"
    ? data
    : new TextDecoder().decode(data as ArrayBuffer);

/** `/1.0/events` — the daemon's event stream (websocket). */
export class Events extends Resource {
  /** Opens the raw event websocket. */
  async connect(opts: EventsOptions = {}): Promise<WebSocketLike> {
    const params = new URLSearchParams();
    if (opts.types?.length) params.set("type", opts.types.join(","));
    if (opts.allProjects) {
      params.set("all-projects", "true");
    } else {
      const project = opts.project ?? this.ctx.project;
      if (project) params.set("project", project);
    }
    const target = opts.target ?? this.ctx.target;
    if (target) params.set("target", target);
    const query = params.toString();
    return this.ctx.connect(`/1.0/events${query ? `?${query}` : ""}`);
  }

  /**
   * Subscribes to events. The handler receives parsed events narrowed to the
   * requested types.
   *
   * @example
   * const sub = await client.events.subscribe({ types: ["lifecycle"] }, (e) => {
   *   console.log(e.metadata.action, e.metadata.source);
   * });
   * sub.close();
   */
  async subscribe<K extends EventType>(
    opts: EventsOptions<K>,
    handler: (event: EventOf<K>) => void,
  ): Promise<EventSubscription> {
    const socket = await this.connect(opts);
    let resolveClosed!: () => void;
    const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
    socket.onmessage = (message) => {
      try {
        handler(JSON.parse(decode(message.data)) as EventOf<K>);
      } catch {
        // Ignore frames that aren't JSON events.
      }
    };
    socket.onclose = () => resolveClosed();
    await new Promise<void>((resolve, reject) => {
      if (socket.readyState === 1) return resolve();
      socket.onopen = () => resolve();
      socket.onerror = (error) => reject(error);
    });
    socket.onerror = null;
    return { close: () => socket.close(), closed, socket };
  }
}
