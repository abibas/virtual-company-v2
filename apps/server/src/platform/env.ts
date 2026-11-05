import type { DbHandle, JournalEntry } from '@mwc/db';
import type { IdentityProvider } from '@mwc/identity-core';
import type { Config } from '@mwc/shared/config';
import type { Logger } from 'pino';
import type { JobsView } from './jobs/status.ts';
import type { Keyring } from './secrets/keyring.ts';

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
  /**
   * The identity provider that signs people in (tests pass `FakeIdentityProvider`). Omitted, it comes from
   * the configuration (`platform/identity.ts`): the Clerk connector for MWC_IDENTITY=clerk, none for `none`.
   */
  readonly identity?: IdentityProvider | undefined;
  /** The process's jobs loop, for `/readyz` (`platform/start.ts` passes it). Omitted, the jobs are off (`JOBS_OFF`). */
  readonly jobs?: JobsView;
  /**
   * The master keys that seal people's subscriptions (`platform/start.ts` loads them). Omitted, MWC_MASTER_KEY's, or
   * a key in memory (tests and demos: what it sealed opens only in this process).
   */
  readonly keyring?: Keyring;
  /**
   * How the server calls AI providers (the subscriptions' usage checks, S3.3); tests pass a fake provider. Omitted,
   * the platform's `fetch`, except under NODE_ENV=test, where every call is refused so no test reaches a provider.
   */
  readonly providerFetch?: typeof fetch;
}

/** What the modules and the auth middleware get from `createApp`: the deps with their defaults applied. */
export interface ServerDeps extends Omit<AppDeps, 'clock' | 'identity'> {
  readonly clock: () => Date;
  /** Undefined when sign-in is off (MWC_IDENTITY=none): routes behind `authn()` answer 503. */
  readonly identity: IdentityProvider | undefined;
}

/** Hono's environment for every route: the per-request variables middleware sets. */
export interface AppEnv {
  Variables: {
    /** Set by the request id middleware: the caller's `x-request-id` when it is sane, else a new id. */
    requestId: string;
    clock: () => Date;
  };
}
