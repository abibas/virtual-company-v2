import type { Config } from '@mwc/shared/config';
import pino, { type DestinationStream, type Logger } from 'pino';

export interface LoggerOptions {
  /** Human-readable lines through pino-pretty (a dev dependency) instead of JSON. Default: development. */
  readonly pretty?: boolean;
  /** Where lines go; stdout by default. Tests pass a capture stream. */
  readonly destination?: DestinationStream;
  /** Loads pino-pretty; injectable so the fallback can be tested. */
  readonly loadPretty?: () => Promise<(options: object) => DestinationStream>;
}

const importPretty = async () =>
  (await import('pino-pretty')).default as (options: object) => DestinationStream;

/**
 * The server's pino logger: JSON lines at MWC_LOG_LEVEL in production and compose, pretty lines in
 * development. pino-pretty runs in this process (no transport worker). When it is not installed
 * (a production image started with NODE_ENV=development) the logger stays JSON and says so.
 */
export async function createLogger(
  config: Pick<Config, 'MWC_LOG_LEVEL' | 'NODE_ENV'>,
  options: LoggerOptions = {},
): Promise<Logger> {
  const base = { level: config.MWC_LOG_LEVEL, name: 'mwc-server' };
  const pretty = options.pretty ?? config.NODE_ENV === 'development';
  if (pretty) {
    try {
      const makePretty = await (options.loadPretty ?? importPretty)();
      // sync: the last lines before process.exit() are not lost.
      return pino(
        base,
        makePretty({ destination: options.destination ?? 1, sync: true, ignore: 'pid,hostname,name' }),
      );
    } catch (error) {
      const logger = pino(base, options.destination);
      logger.warn({ err: error }, 'pino-pretty is not available; logging JSON');
      return logger;
    }
  }
  // Without a destination pino writes to stdout synchronously.
  return pino(base, options.destination);
}
