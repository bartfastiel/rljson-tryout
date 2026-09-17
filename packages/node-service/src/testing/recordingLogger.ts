import type { FastifyBaseLogger } from 'fastify';

export type LogRecord = {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  message: string;
  fields: Record<string, unknown>;
};

/**
 * A logger that keeps every record in memory so that a test can assert
 * what a component logged, in the pino call shape `(fields, message)` or
 * `(message)` the code uses.
 */
export const recordingLogger = (): {
  logger: FastifyBaseLogger;
  records: LogRecord[];
} => {
  const records: LogRecord[] = [];
  const record =
    (level: LogRecord['level']) =>
    (first: unknown, second?: unknown): void => {
      if (typeof first === 'string') {
        records.push({ level, message: first, fields: {} });
      } else {
        records.push({
          level,
          message: typeof second === 'string' ? second : '',
          fields: (first ?? {}) as Record<string, unknown>,
        });
      }
    };
  const logger = {
    level: 'trace',
    fatal: record('fatal'),
    error: record('error'),
    warn: record('warn'),
    info: record('info'),
    debug: record('debug'),
    trace: record('trace'),
    silent: (): void => {},
    child: (): FastifyBaseLogger => logger,
  } as unknown as FastifyBaseLogger;
  return { logger, records };
};
