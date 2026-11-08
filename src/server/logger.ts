const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LEVELS)[number];

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/**
 * Writes one JSON object per line, which log collectors can parse without
 * guessing. Callers pass ids and counts as fields; they never pass tokens,
 * passwords or what a signer typed.
 */
export function createLogger(
  minimum: LogLevel,
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Logger {
  const threshold = LEVELS.indexOf(minimum);
  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVELS.indexOf(level) < threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }));
  };
  return {
    debug: (message, fields) => {
      log('debug', message, fields);
    },
    info: (message, fields) => {
      log('info', message, fields);
    },
    warn: (message, fields) => {
      log('warn', message, fields);
    },
    error: (message, fields) => {
      log('error', message, fields);
    },
  };
}

export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, stack: error.stack };
  }
  return { errorMessage: String(error) };
}
