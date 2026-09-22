import { env } from "../env.ts";

// Minimal leveled logger. Honors LOG_LEVEL from env; writes warn/error to
// stderr and the rest to stdout so operators can see each step the agent takes.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL];

function emit(level: Level, message: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const sink = level === "warn" || level === "error" ? console.error : console.log;
  if (extra !== undefined) sink(line, extra);
  else sink(line);
}

export const log = {
  debug: (message: string, extra?: unknown) => emit("debug", message, extra),
  info: (message: string, extra?: unknown) => emit("info", message, extra),
  warn: (message: string, extra?: unknown) => emit("warn", message, extra),
  error: (message: string, extra?: unknown) => emit("error", message, extra),
};
