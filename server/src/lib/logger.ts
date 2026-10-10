import { env } from '../config/env';

const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = Exclude<keyof typeof levels, 'silent'>;

const threshold = levels[env.isTest ? 'silent' : env.LOG_LEVEL];

/** Keys whose values must never reach logs. */
const REDACT = /pass(word)?|secret|token|cookie|authorization|sid/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = REDACT.test(k) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

function log(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (levels[level] < threshold) return;
  const line = { t: new Date().toISOString(), level, msg, ...(meta ? (redact(meta) as object) : {}) };
  const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  out.write(`${JSON.stringify(line)}\n`);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
