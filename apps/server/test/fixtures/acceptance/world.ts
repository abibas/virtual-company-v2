/**
 * The S1 acceptance scenario's world: the API on a fresh test database (PGlite, or Postgres in `--full`) with the
 * target's identity provider, one fixed clock a day ahead of real time (so the rows the database stamps with its own
 * `now()` are due at once, as in jobs.ts), the jobs loop's tick composed as `start` composes it, and requests over
 * HTTP as a signed-in person or with an API key, each with a request id the audit rows can be matched to.
 */
import { randomBytes } from 'node:crypto';
import type { Config } from '@mwc/shared/config';
import {
  createTestApp,
  fixedClock,
  type JsonResponse,
  requestJson,
  type TestApp,
  type TestClock,
  testConfig,
} from '@mwc/testkit';
import { moduleJobs } from '../../../src/app.ts';
import { type JobsDeps, type JobsTick, runJobsOnce } from '../../../src/platform/jobs/run.ts';
import { HOUR_MS, MINUTE_MS } from '../platform/jobs.ts';
import type { AcceptanceTarget, SignedIn } from './target.ts';

/** MWC_RECONCILE_MINUTES' default: how far the clock moves for the periodic reconcile to come round. */
export const RECONCILE_MS = 10 * MINUTE_MS;

/** One request over HTTP, returning the status, the parsed body and the headers. */
export type Caller = (method: string, path: string, body?: unknown) => Promise<JsonResponse>;

export interface AcceptanceWorld<T extends AcceptanceTarget = AcceptanceTarget> {
  readonly target: T;
  readonly t: TestApp;
  readonly clock: TestClock;
  readonly jobs: JobsDeps;
  /** One tick of the jobs loop: the outbox, the webhook retry and the periodic reconcile. */
  tick(): Promise<JobsTick>;
  /** The request id a request labelled `label` is sent with (`x-request-id`). */
  requestId(label: string): string;
  /** Requests as this person (their session token) or with this API key; labelled ones carry their request id. */
  as(who: SignedIn | string, label?: string): Caller;
  close(): Promise<void>;
}

/** A fixed clock on the next whole hour a day from now. */
export function aDayAhead(): TestClock {
  const clock = fixedClock();
  clock.set(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS + 24 * HOUR_MS);
  return clock;
}

export async function acceptanceWorld<T extends AcceptanceTarget>(
  target: T,
  clock: TestClock,
): Promise<AcceptanceWorld<T>> {
  const config: Config = { ...testConfig, MWC_WEB_ORIGIN: target.webOrigin };
  const t = await createTestApp({ clock, identity: target.provider, config });
  const server = { db: t.db, config, logger: t.logger, version: 'test', clock, identity: target.provider };
  const jobs: JobsDeps = { ...server, work: moduleJobs(server), reconcileIntervalMs: RECONCILE_MS };
  const run = randomBytes(3).toString('hex');
  const requestId = (label: string) => `s1-${run}-${label}`;
  let unlabelled = 0;
  return {
    target,
    t,
    clock,
    jobs,
    tick: () => runJobsOnce(jobs),
    requestId,
    as(who, label) {
      return async (method, path, body) => {
        const credential = typeof who === 'string' ? who : await who.token();
        const headers = {
          authorization: `Bearer ${credential}`,
          'x-request-id': requestId(label ?? `read-${++unlabelled}`),
        };
        return requestJson(t.app, method, path, { body, headers });
      };
    },
    close: () => t.close(),
  };
}
