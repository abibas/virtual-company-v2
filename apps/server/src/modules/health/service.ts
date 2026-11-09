import { fileURLToPath } from 'node:url';
import { type JournalEntry, type MigrationStatus, migrationStatus, pingDb, readJournal } from '@mwc/db';
import type { Config } from '@mwc/shared/config';
import type { AppDeps } from '../../platform/env.ts';
import { JOBS_OFF, type JobsStatus, type OutboxBacklog, outboxBacklog } from '../../platform/jobs/status.ts';
import type { PublicConfig } from './schemas.ts';

/** /readyz answers 503 when the database has not answered within this many milliseconds. */
export const READY_TIMEOUT_MS = 2000;

export type Readiness = { ready: true; migrations: MigrationStatus } | { ready: false; reason: string };

/** The jobs block of a ready answer: this process's loop and the outbox backlog (null when it cannot be read). */
export interface JobsReadiness extends JobsStatus {
  readonly outbox: OutboxBacklog | null;
}

export interface HealthService {
  /** The database answers within READY_TIMEOUT_MS and every migration in the journal is applied. */
  readiness(): Promise<Readiness>;
  /** The jobs loop's status and the outbox backlog at `now`; never rejects (jobs off or idle are fine). */
  jobs(now: Date): Promise<JobsReadiness>;
}

class Timeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The health checks of one app. The migration journal is read once here, when the app is built (it only
 * changes with a new deploy), never per request.
 */
export function healthService(deps: Pick<AppDeps, 'db' | 'logger' | 'journal' | 'jobs'>): HealthService {
  const journal: readonly JournalEntry[] = deps.journal ?? readJournal();
  const jobs = deps.jobs ?? JOBS_OFF;
  return {
    async jobs(now) {
      let outbox: OutboxBacklog | null = null;
      try {
        outbox = await withTimeout(outboxBacklog(deps.db, now), READY_TIMEOUT_MS);
      } catch (error) {
        deps.logger.warn({ err: error }, 'readyz: could not count the outbox backlog');
      }
      return { ...jobs.status(), outbox };
    },
    async readiness() {
      try {
        const migrations = await withTimeout(
          pingDb(deps.db).then(() => migrationStatus(deps.db, { journal })),
          READY_TIMEOUT_MS,
        );
        if (!migrations.current) {
          return {
            ready: false,
            reason: `migrations behind: ${migrations.applied} of ${migrations.expected} applied`,
          };
        }
        return { ready: true, migrations };
      } catch (error) {
        // The driver's message can name hosts and users; it goes to the log, the client gets a summary.
        const timedOut = error instanceof Timeout;
        deps.logger.warn(
          { err: error },
          timedOut ? 'readyz: database timed out' : 'readyz: database unreachable',
        );
        return { ready: false, reason: timedOut ? 'database timed out' : 'database unreachable' };
      }
    },
  };
}

/** The repository's deploy/compose.yml, from this file's place (never the working folder). */
export const COMPOSE_FILE = fileURLToPath(new URL('../../../../../deploy/compose.yml', import.meta.url));

/**
 * The public part of the configuration, for the web (`GET /api/config`): the sign-in mode, Clerk's publishable key
 * when Clerk signs people in, the web origin, the API's public URL and whether this server drives the devboxes itself
 * (`localPower`), and outside production the absolute path of deploy/compose.yml (`composeFile`). Picked field by field, so no secret (the Clerk secret key, the JWT key, the webhook secret, the
 * database URL) can reach it.
 */
export function publicConfig(config: Config, localPower: boolean): PublicConfig {
  const clerk = config.MWC_IDENTITY === 'clerk' && config.CLERK_PUBLISHABLE_KEY !== undefined;
  const apiUrl = config.MWC_PUBLIC_URL.replace(/\/+$/, '');
  return {
    identity: clerk ? 'clerk' : 'none',
    ...(clerk ? { clerkPublishableKey: config.CLERK_PUBLISHABLE_KEY } : {}),
    webOrigin: config.MWC_WEB_ORIGIN,
    apiUrl,
    publicUrl: config.MWC_PUBLIC_URL_SET ? apiUrl : null,
    localPower,
    composeFile: config.NODE_ENV === 'production' ? null : COMPOSE_FILE,
  };
}
