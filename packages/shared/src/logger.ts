/**
 * Structured JSON logging.
 *
 * Every line is a single JSON object so CloudWatch Logs Insights can query on
 * `syncRunId`, `sourceKey`, `stage`, `durationMs` and friends without regex.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Derive a logger that stamps additional fields onto every line. */
  child(context: LogContext): Logger;
}

/** Keys whose values must never reach the logs. */
const REDACTED_KEYS = [
  "password", "passwd", "secret", "token", "apikey", "api_key", "authorization",
  "auth", "cookie", "sessionid", "session_id", "databaseurl", "database_url",
  "connectionstring", "connection_string", "accesskey", "access_key",
  "secretaccesskey", "secret_access_key", "x-tenant-key", "tenantkey",
  "tenant_key", "phone", "email",
];

function shouldRedact(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z_]/g, "");
  return REDACTED_KEYS.some((candidate) => normalized.includes(candidate.replace(/[^a-z_]/g, "")));
}

/**
 * Redact sensitive values and clamp size. Also scrubs anything that looks like
 * a Postgres URL even when it appears inside an otherwise innocent message.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limited]";
  if (typeof value === "string") return scrubSecretsInString(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubSecretsInString(value.message),
      stack: value.stack ? scrubSecretsInString(value.stack).slice(0, 4000) : undefined,
    };
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = shouldRedact(key) ? "[redacted]" : redact(item, depth + 1);
  }
  return out;
}

export function scrubSecretsInString(input: string): string {
  return input
    .replace(/\b(postgres(?:ql)?:\/\/)[^\s"']*/gi, "$1[redacted]")
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted-aws-key]");
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly base?: LogContext;
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const emit = (logLevel: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_ORDER[logLevel] < LEVEL_ORDER[level]) return;
    const payload = {
      level: logLevel,
      time: now().toISOString(),
      msg: scrubSecretsInString(message),
      ...(redact(base) as LogContext),
      ...(context ? (redact(context) as LogContext) : {}),
    };
    try {
      write(JSON.stringify(payload));
    } catch {
      write(JSON.stringify({ level: "error", time: now().toISOString(), msg: "log-serialize-failed" }));
    }
  };

  return {
    debug: (m, c) => emit("debug", m, c),
    info: (m, c) => emit("info", m, c),
    warn: (m, c) => emit("warn", m, c),
    error: (m, c) => emit("error", m, c),
    child: (context) => createLogger({ ...options, base: { ...base, ...context } }),
  };
}

/** Logger that discards everything; useful in tests. */
export const silentLogger: Logger = createLogger({ level: "error", write: () => {} });
