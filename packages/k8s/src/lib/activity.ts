/**
 * A cluster's provisioning activity, merged from what the management cluster
 * already records about it: Kubernetes Events on its CAPI objects (curated,
 * but kept only an hour) and the provider controllers' logs (verbose, kept
 * until the pod restarts) filtered to lines tagged `Cluster="<ns>/<name>"`.
 * Pure functions over captured output so the parsing is unit-tested.
 */

export type ActivityLevel = "info" | "warning" | "error";

export interface ActivityEntry {
  /** ISO timestamp of the first occurrence. */
  time: string;
  /** ISO timestamp of the latest repeat, when count > 1. */
  lastTime?: string;
  level: ActivityLevel;
  /** Which controller (or "event") reported it. */
  source: string;
  /** Kind/name of the object it is about, when known. */
  object?: string;
  message: string;
  /** Occurrences folded into this entry. */
  count: number;
}

// klog header: I0924 22:11:53.976397       1 file.go:20] "msg" k="v" ...
const KLOG_LINE =
  /^([IWEF])(\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)\s+\d+\s+[^\]]*\]\s+(.*)$/;
const FIELD = /([A-Za-z][\w.]*)=("(?:[^"\\]|\\.)*"|[^\s{]\S*)/g;

export interface KlogLine {
  level: ActivityLevel;
  time: Date;
  message: string;
  fields: Record<string, string>;
}

const unquote = (value: string): string => {
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value) as string;
  } catch {
    return value.slice(1, -1);
  }
};

/**
 * klog omits the year: take `now`'s (UTC, the controllers' clock) and step back
 * a year for a timestamp that would otherwise sit in the future (a log line
 * from late December read in January).
 */
function klogTime(month: number, day: number, hms: number[], micros: string, now: Date): Date {
  const [h = 0, m = 0, s = 0] = hms;
  const ms = Number(micros.slice(0, 3).padEnd(3, "0"));
  const at = (year: number) => new Date(Date.UTC(year, month - 1, day, h, m, s, ms));
  const guess = at(now.getUTCFullYear());
  return guess.getTime() - now.getTime() > 86_400_000
    ? at(now.getUTCFullYear() - 1)
    : guess;
}

export function parseKlogLine(line: string, now: Date = new Date()): KlogLine | null {
  const match = KLOG_LINE.exec(line);
  if (!match) return null;
  const [, sev, mo, dd, hh, mi, ss, micros, rest = ""] = match;
  let message = rest;
  let tail = "";
  if (rest.startsWith('"')) {
    // The message is a quoted Go string; find its closing quote.
    let i = 1;
    while (i < rest.length && rest[i] !== '"') i += rest[i] === "\\" ? 2 : 1;
    message = unquote(rest.slice(0, i + 1));
    tail = rest.slice(i + 1);
  }
  const fields: Record<string, string> = {};
  for (const [, key = "", value = ""] of tail.matchAll(FIELD)) {
    fields[key] = unquote(value);
  }
  return {
    level: sev === "I" ? "info" : sev === "W" ? "warning" : "error",
    time: klogTime(
      Number(mo),
      Number(dd),
      [Number(hh), Number(mi), Number(ss)],
      micros ?? "0",
      now,
    ),
    message,
    fields,
  };
}

// Reconcile chatter that repeats on every resync and says nothing new.
const NOISE = [
  /^Reconcile KubeadmControlPlane$/,
  /^Instance already exists$/,
  /^Instance is already running$/,
  /^Adding watch on external object/,
  /^Could not connect to workload cluster to fetch deprecated v1beta1 status/,
  // API-server deprecation warnings echoed by the controller, not about us.
  /^metadata\.finalizers: /,
];

const shortName = (ref: string): string => ref.slice(ref.indexOf("/") + 1);

/** The object a controller line is about: its reconciled kind, if tagged. */
function lineObject(fields: Record<string, string>): string | undefined {
  const kind = fields.controllerKind;
  if (kind && fields[kind]) return `${kind}/${shortName(fields[kind])}`;
  for (const k of ["Machine", "LXCMachine", "KubeadmControlPlane", "MachineDeployment"]) {
    if (fields[k]) return `${k}/${shortName(fields[k])}`;
  }
  return undefined;
}

/** Controller log lines about one cluster, newer than `since`. */
export function logActivity(
  lines: string[],
  source: string,
  clusterRef: string,
  since: Date,
  now: Date = new Date(),
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const line of lines) {
    if (!line.includes(`Cluster="${clusterRef}"`)) continue;
    const parsed = parseKlogLine(line, now);
    if (!parsed || parsed.fields.Cluster !== clusterRef) continue;
    if (parsed.time < since) continue;
    if (parsed.level === "info" && NOISE.some((re) => re.test(parsed.message))) continue;
    const err = parsed.fields.err ?? parsed.fields.error;
    out.push({
      time: parsed.time.toISOString(),
      level: parsed.level,
      source,
      object: lineObject(parsed.fields),
      message: err ? `${parsed.message}: ${err}` : parsed.message,
      count: 1,
    });
  }
  return out;
}

interface K8sEvent {
  type?: string;
  reason?: string;
  message?: string;
  count?: number;
  series?: { count?: number; lastObservedTime?: string };
  involvedObject?: { kind?: string; name?: string };
  firstTimestamp?: string | null;
  lastTimestamp?: string | null;
  eventTime?: string | null;
  metadata?: { creationTimestamp?: string };
}

export interface K8sEventList {
  items?: K8sEvent[];
}

/** Events on the cluster's own objects (`names`), newer than `since`. */
export function eventActivity(
  events: K8sEventList,
  names: Set<string>,
  since: Date,
): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const e of events.items ?? []) {
    const name = e.involvedObject?.name;
    if (!name || !names.has(name)) continue;
    const stamp =
      e.series?.lastObservedTime ??
      e.lastTimestamp ??
      e.eventTime ??
      e.firstTimestamp ??
      e.metadata?.creationTimestamp;
    if (!stamp) continue;
    const time = new Date(stamp);
    if (Number.isNaN(time.getTime()) || time < since) continue;
    out.push({
      time: time.toISOString(),
      level: e.type === "Warning" ? "warning" : "info",
      source: "event",
      object: `${e.involvedObject?.kind ?? "Object"}/${name}`,
      message: [e.reason, e.message].filter(Boolean).join(": "),
      count: e.series?.count ?? e.count ?? 1,
    });
  }
  return out;
}

/**
 * Oldest-first timeline of the newest `limit` entries. A line that repeats an
 * earlier one from the same source (same object, message and level) is folded
 * into it as a count: controllers re-log the same "waiting for ..." or
 * "creating load balancer" on every resync, interleaved with other lines.
 * Events carry their own repeat count and are kept as-is.
 */
export function mergeActivity(sets: ActivityEntry[][], limit: number): ActivityEntry[] {
  const sorted = sets.flat().sort((a, b) => a.time.localeCompare(b.time));
  const out: ActivityEntry[] = [];
  const seen = new Map<string, ActivityEntry>();
  for (const entry of sorted) {
    if (entry.source === "event") {
      out.push({ ...entry });
      continue;
    }
    const key = [entry.source, entry.object ?? "", entry.level, entry.message].join("\u0000");
    const first = seen.get(key);
    if (first) {
      first.count += entry.count;
      first.lastTime = entry.time;
      continue;
    }
    const copy = { ...entry };
    out.push(copy);
    seen.set(key, copy);
  }
  return out.slice(-limit);
}
