import { z } from '@hono/zod-openapi';
import { IdentityMode } from '@mwc/shared/config';

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

/**
 * What the web reads when it boots (`GET /api/config`): how people sign in here and where. Public by design, so one
 * built image runs in any environment; it never carries a secret (the Clerk publishable key is meant for browsers).
 */
export const PublicConfigSchema = z
  .object({
    identity: z.enum(IdentityMode.options).openapi({
      description: '`clerk`: people sign in with Clerk; `none`: sign-in is off on this server (MWC_IDENTITY)',
    }),
    clerkPublishableKey: z.string().optional().openapi({
      example: 'pk_test_...',
      description: "Clerk's publishable key for the browser, with `identity: clerk` only",
    }),
    webOrigin: z.url().openapi({
      example: 'http://localhost:9951',
      description: 'The web origin whose session tokens the API accepts (MWC_WEB_ORIGIN)',
    }),
    apiUrl: z.url().openapi({
      example: 'http://localhost:9950',
      description:
        "The API's own address, for `mwc login --server` (MWC_PUBLIC_URL, else localhost and its port); its port is " +
        "the one the Airia devbox's tunnel forwards",
    }),
    publicUrl: z
      .url()
      .nullable()
      .openapi({
        example: 'https://corp.example.com',
        description:
          'MWC_PUBLIC_URL when it is set (the address other machines reach), null when the server only knows its ' +
          "local address (the Airia devbox's install needs none: it uses the port of `apiUrl`)",
      }),
  })
  .openapi('PublicConfig');

export type PublicConfig = z.infer<typeof PublicConfigSchema>;
