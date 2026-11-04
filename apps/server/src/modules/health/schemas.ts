import { z } from '@hono/zod-openapi';

/** The API contract version; bumped only on a breaking change to `/api`. */
export const API_VERSION = 1;

export const HealthSchema = z
  .object({ status: z.literal('ok'), version: z.string().openapi({ example: '0.0.0' }) })
  .openapi('Health');

/** The jobs loop of the process that answered: shown for information, it never makes the server not ready. */
export const JobsReadySchema = z
  .object({
    enabled: z.boolean().openapi({ description: 'MWC_JOBS: this process runs the jobs loop' }),
    holdsLock: z
      .boolean()
      .openapi({ description: 'This process holds the jobs lock (one runner per database)' }),
    lastTickAt: z.iso.datetime().nullable().openapi({ description: "The end of this process's last tick" }),
    outbox: z
      .object({ due: z.number().int(), failed: z.number().int() })
      .nullable()
      .openapi({ description: 'Identity outbox rows due now and failed for good; null when unreadable' }),
  })
  .openapi('JobsReady');

export const ReadySchema = z
  .object({
    status: z.literal('ready'),
    version: z.string(),
    db: z.literal('ok'),
    migrations: z.object({
      applied: z.number().int(),
      expected: z.number().int(),
      last: z.string().nullable().openapi({ example: '0000_init' }),
    }),
    jobs: JobsReadySchema,
  })
  .openapi('Ready');

export const NotReadySchema = z
  .object({
    status: z.literal('not_ready'),
    reason: z.string().openapi({ example: 'migrations behind: 0 of 1 applied' }),
  })
  .openapi('NotReady');

export const VersionSchema = z
  .object({
    version: z.string().openapi({ example: '0.0.0' }),
    apiVersion: z.literal(API_VERSION),
  })
  .openapi('Version');
