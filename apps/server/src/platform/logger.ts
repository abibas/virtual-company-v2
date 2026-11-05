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

/** The keys a secret travels under (tokens, API keys, a gateway's headers, the logins' files, the master key). */
const SECRET_KEYS = [
  'token',
  'apiKey',
  'secret',
  'password',
  'authorization',
  'headers',
  'credentials',
  'auth',
  'ciphertext',
  'masterKey',
  'MWC_MASTER_KEY',
];

/**
 * What the logger blanks out, at the top of a line and one level down: code never logs a secret, and this is the
 * second line of defence if a payload or a request's headers ever reach a log call.
 */
export const REDACTED_PATHS: readonly string[] = SECRET_KEYS.flatMap((key) => [key, `*.${key}`]);

/** What a redacted value is replaced with. */
export const REDACTED = '[redacted]';

/**
 * The server's pino logger: JSON lines at MWC_LOG_LEVEL in production and compose, pretty lines in
 * development. pino-pretty runs in this process (no transport worker). When it is not installed
 * (a production image started with NODE_ENV=development) the logger stays JSON and says so.
 */
export async function createLogger(
  config: Pick<Config, 'MWC_LOG_LEVEL' | 'NODE_ENV'>,
  options: LoggerOptions = {},
): Promise<Logger> {
  const base = {
    level: config.MWC_LOG_LEVEL,
    name: 'mwc-server',
    redact: { paths: [...REDACTED_PATHS], censor: REDACTED },
  };
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
