/** Structured JSON logs on stdout, one object per line. */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: Level = "info";

export const setLogLevel = (l: Level) => (threshold = l);

const emit = (level: Level, msg: string, fields?: Record<string, unknown>) => {
  if (order[level] < order[threshold]) return;
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
};

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit("error", msg, f),
};
