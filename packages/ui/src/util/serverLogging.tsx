import type { LxdConfigPair } from "types/config";

// A named server logging target, stored as flat `logging.<name>.*` server
// config keys (API extension: server_logging).
export interface LoggingTarget {
  name: string;
  type: string; // loki | syslog | webhook
  address: string;
  caCert: string;
  username: string;
  password: string;
  retry: string;
  facility: string; // syslog only
  instance: string;
  labels: string;
  level: string;
  types: string; // comma-separated event types
  lifecycleProjects: string;
  lifecycleTypes: string;
}

export const emptyLoggingTarget = (): LoggingTarget => ({
  name: "",
  type: "loki",
  address: "",
  caCert: "",
  username: "",
  password: "",
  retry: "",
  facility: "",
  instance: "",
  labels: "",
  level: "",
  types: "",
  lifecycleProjects: "",
  lifecycleTypes: "",
});

// Maps the LoggingTarget fields to the `logging.<name>.<suffix>` config keys.
const FIELD_TO_SUFFIX: Record<keyof Omit<LoggingTarget, "name">, string> = {
  type: "target.type",
  address: "target.address",
  caCert: "target.ca_cert",
  username: "target.username",
  password: "target.password",
  retry: "target.retry",
  facility: "target.facility",
  instance: "target.instance",
  labels: "target.labels",
  level: "logging.level",
  types: "types",
  lifecycleProjects: "lifecycle.projects",
  lifecycleTypes: "lifecycle.types",
};

const SUFFIX_TO_FIELD: Record<string, keyof Omit<LoggingTarget, "name">> =
  Object.fromEntries(
    Object.entries(FIELD_TO_SUFFIX).map(([field, suffix]) => [suffix, field]),
  ) as Record<string, keyof Omit<LoggingTarget, "name">>;

// Parses all `logging.<name>.*` keys from server config into named targets.
export const parseLoggingTargets = (
  config: LxdConfigPair | undefined,
): LoggingTarget[] => {
  const targets: Record<string, LoggingTarget> = {};

  for (const [key, value] of Object.entries(config ?? {})) {
    if (!key.startsWith("logging.")) {
      continue;
    }
    const rest = key.slice("logging.".length);

    let name = "";
    let suffix = "";
    for (const marker of [".target.", ".logging.", ".lifecycle."]) {
      const index = rest.indexOf(marker);
      if (index > 0) {
        name = rest.slice(0, index);
        suffix = rest.slice(index + 1);
        break;
      }
    }
    if (!name && rest.endsWith(".types")) {
      name = rest.slice(0, rest.length - ".types".length);
      suffix = "types";
    }
    if (!name) {
      continue;
    }

    targets[name] ??= { ...emptyLoggingTarget(), name, type: "" };
    const field = SUFFIX_TO_FIELD[suffix];
    if (field) {
      targets[name][field] = value ?? "";
    }
  }

  return Object.values(targets).sort((a, b) => a.name.localeCompare(b.name));
};

// Builds the config patch for a target. Empty values unset the key. When
// `removeAll` is set every key for the target is cleared (used on delete).
export const loggingTargetToConfig = (
  target: LoggingTarget,
  removeAll = false,
): LxdConfigPair => {
  const result: LxdConfigPair = {};
  for (const [field, suffix] of Object.entries(FIELD_TO_SUFFIX)) {
    const value = removeAll
      ? ""
      : target[field as keyof Omit<LoggingTarget, "name">];
    result[`logging.${target.name}.${suffix}`] = value;
  }
  return result;
};
