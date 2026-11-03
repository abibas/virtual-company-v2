import type { DbHandle, JournalEntry } from '@mwc/db';
import type { Config } from '@mwc/shared/config';
import type { Logger } from 'pino';

/** What `createApp` needs from the outside world; tests pass PGlite, a capture logger and a fixed clock. */
export interface AppDeps {
  readonly db: DbHandle;
  readonly config: Config;
  readonly logger: Logger;
  /** The server's version (apps/server/package.json), shown by /healthz, /readyz and /api/version. */
  readonly version: string;
  /** The current time; defaults to the system clock. Route code reads it as `c.var.clock()`. */
  readonly clock?: () => Date;
  /** The built web UI (apps/web/dist) to serve for `/` and client routes; omitted in dev and tests. */
  readonly webDist?: string;
  /**
   * The migrations the database must have for `/readyz` (`readJournal()` of `@mwc/db`). Omitted, the
   * package's own journal is read once when the app is built, never per request.
   */
  readonly journal?: readonly JournalEntry[];
}

/** Hono's environment for every route: the per-request variables middleware sets. */
export interface AppEnv {
  Variables: {
    /** Set by the request id middleware: the caller's `x-request-id` when it is sane, else a new id. */
    requestId: string;
    clock: () => Date;
  };
}
