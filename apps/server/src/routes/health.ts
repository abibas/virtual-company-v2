import { createRoute, z } from '@hono/zod-openapi';
import { type JournalEntry, type MigrationStatus, migrationStatus, pingDb, readJournal } from '@mwc/db';
import type { AppDeps } from '../env.ts';
import { newRouter } from '../http/router.ts';

/** /readyz answers 503 when the database has not answered within this many milliseconds. */
export const READY_TIMEOUT_MS = 2000;

const HealthSchema = z
  .object({ status: z.literal('ok'), version: z.string().openapi({ example: '0.0.0' }) })
  .openapi('Health');

const ReadySchema = z
  .object({
    status: z.literal('ready'),
    version: z.string(),
    db: z.literal('ok'),
    migrations: z.object({
      applied: z.number().int(),
      expected: z.number().int(),
      last: z.string().nullable().openapi({ example: '0000_init' }),
    }),
  })
  .openapi('Ready');

const NotReadySchema = z
  .object({
    status: z.literal('not_ready'),
    reason: z.string().openapi({ example: 'migrations behind: 0 of 1 applied' }),
  })
  .openapi('NotReady');

const healthzRoute = createRoute({
  method: 'get',
  path: '/healthz',
  tags: ['health'],
  summary: 'Liveness: the process is up (never touches the database)',
  responses: {
    200: { description: 'Alive', content: { 'application/json': { schema: HealthSchema } } },
  },
});

const readyzRoute = createRoute({
  method: 'get',
  path: '/readyz',
  tags: ['health'],
  summary: 'Readiness: the database answers and every migration is applied',
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: ReadySchema } } },
    503: { description: 'Not ready', content: { 'application/json': { schema: NotReadySchema } } },
  },
});

class Timeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

type DbCheck = { ok: true; migrations: MigrationStatus } | { ok: false; reason: string };

async function checkDb(deps: AppDeps, journal: readonly JournalEntry[]): Promise<DbCheck> {
  try {
    const migrations = await withTimeout(
      pingDb(deps.db).then(() => migrationStatus(deps.db, { journal })),
      READY_TIMEOUT_MS,
    );
    if (!migrations.current) {
      return {
        ok: false,
        reason: `migrations behind: ${migrations.applied} of ${migrations.expected} applied`,
      };
    }
    return { ok: true, migrations };
  } catch (error) {
    // The driver's message can name hosts and users; it goes to the log, the client gets a summary.
    const timedOut = error instanceof Timeout;
    deps.logger.warn(
      { err: error },
      timedOut ? 'readyz: database timed out' : 'readyz: database unreachable',
    );
    return { ok: false, reason: timedOut ? 'database timed out' : 'database unreachable' };
  }
}

export function healthRoutes(deps: AppDeps) {
  // Read once here, when the app is built: the journal only changes with a new deploy.
  const journal = deps.journal ?? readJournal();
  return newRouter()
    .openapi(healthzRoute, (c) => c.json({ status: 'ok' as const, version: deps.version }, 200))
    .openapi(readyzRoute, async (c) => {
      const check = await checkDb(deps, journal);
      if (!check.ok) {
        return c.json({ status: 'not_ready' as const, reason: check.reason }, 503);
      }
      const { applied, expected, last } = check.migrations;
      return c.json(
        {
          status: 'ready' as const,
          version: deps.version,
          db: 'ok' as const,
          migrations: { applied, expected, last },
        },
        200,
      );
    });
}
