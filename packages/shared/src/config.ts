import { z } from 'zod';
import { PORTS, SLOT_COUNT, slotPorts } from './ports.ts';

/** An empty variable (`MWC_PORT_SLOT=` in a .env file) counts as unset, not as 0. */
const emptyAsUnset = (value: unknown) => (value === '' ? undefined : value);

/** Which identity provider signs people in; `none` serves health and the UI only (MWC_IDENTITY). */
export const IdentityMode = z.enum(['clerk', 'none']);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  /** Worktree slot 0..9 (docs/ports.md): when set and MWC_PORT is not, the API listens on the slot's port. */
  MWC_PORT_SLOT: z.preprocess(
    emptyAsUnset,
    z.coerce
      .number()
      .int()
      .min(0)
      .max(SLOT_COUNT - 1)
      .optional(),
  ),
  MWC_PORT: z.preprocess(emptyAsUnset, z.coerce.number().int().min(1).max(65535).optional()),
  /** Defaults to http://localhost:<effective MWC_PORT>. */
  MWC_PUBLIC_URL: z.preprocess(emptyAsUnset, z.url().optional()),
  MWC_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** The address the API binds to: loopback by default; the compose image sets 0.0.0.0. */
  MWC_HOST: z.preprocess(emptyAsUnset, z.union([z.ipv4(), z.ipv6(), z.hostname()]).default('127.0.0.1')),
  /** Apply pending migrations when the server starts (true/false, 1/0, yes/no, on/off). Default false. */
  MWC_MIGRATE_ON_START: z.preprocess(emptyAsUnset, z.stringbool().default(false)),
  /** The built web UI (apps/web/dist) the server serves for `/`; the container image sets it. */
  MWC_WEB_DIST: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  /**
   * The web origin whose session tokens the API accepts (Clerk's `azp`, the provider's `authorizedParties`).
   * Defaults to the web dev server (9951, or the slot's web port) and, in production, to MWC_PUBLIC_URL,
   * since the server serves the UI there.
   */
  MWC_WEB_ORIGIN: z.preprocess(emptyAsUnset, z.url({ protocol: /^https?$/ }).optional()),
  /** `clerk` or `none` (sign-in off: identity routes answer 503). Defaults to clerk when CLERK_SECRET_KEY is set. */
  MWC_IDENTITY: z.preprocess(emptyAsUnset, IdentityMode.optional()),
  /** Clerk's keys (docs/clerk-setup.md); their shape is checked by the connector, never echoed. */
  CLERK_SECRET_KEY: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  CLERK_PUBLISHABLE_KEY: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
  CLERK_JWT_KEY: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
});

export type IdentityMode = z.infer<typeof IdentityMode>;

/** MWC_IDENTITY=clerk (set, or implied by the secret key) needs both Clerk keys. */
function requireClerkKeys(env: z.infer<typeof EnvSchema>, ctx: z.RefinementCtx): void {
  const mode = env.MWC_IDENTITY ?? (env.CLERK_SECRET_KEY ? 'clerk' : 'none');
  if (mode !== 'clerk') return;
  for (const key of ['CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY'] as const) {
    if (!env[key])
      ctx.addIssue({ code: 'custom', path: [key], message: 'required when MWC_IDENTITY is clerk' });
  }
}

/** The default web origin: the public URL in production, else the web dev server of the port or slot. */
function defaultWebOrigin(env: z.infer<typeof EnvSchema>, publicUrl: string): string {
  if (env.NODE_ENV === 'production') return new URL(publicUrl).origin;
  const web = env.MWC_PORT_SLOT === undefined ? PORTS.web : slotPorts(env.MWC_PORT_SLOT).web;
  return `http://localhost:${web}`;
}

/**
 * Process configuration, 12-factor style: everything comes from the environment,
 * is validated once at startup, and a missing or malformed value fails fast.
 * Precedence for the API port: MWC_PORT, then MWC_PORT_SLOT's API port, then 9950. The Clerk keys are
 * secrets: nothing logs the configuration, and a problem names the variable, never its value.
 */
export const ConfigSchema = EnvSchema.superRefine(requireClerkKeys).transform((env) => {
  const { MWC_PORT_SLOT, MWC_PORT, MWC_PUBLIC_URL, MWC_WEB_ORIGIN, MWC_IDENTITY, ...rest } = env;
  const port = MWC_PORT ?? (MWC_PORT_SLOT === undefined ? PORTS.api : slotPorts(MWC_PORT_SLOT).api);
  const publicUrl = MWC_PUBLIC_URL ?? `http://localhost:${port}`;
  const identity: IdentityMode = MWC_IDENTITY ?? (env.CLERK_SECRET_KEY ? 'clerk' : 'none');
  return {
    ...rest,
    ...(MWC_PORT_SLOT === undefined ? {} : { MWC_PORT_SLOT }),
    MWC_PORT: port,
    MWC_PUBLIC_URL: publicUrl,
    MWC_WEB_ORIGIN:
      MWC_WEB_ORIGIN === undefined ? defaultWebOrigin(env, publicUrl) : new URL(MWC_WEB_ORIGIN).origin,
    MWC_IDENTITY: identity,
  };
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    const lines = issues.map((issue) => `  ${issue.path}: ${issue.message}`);
    super(`Invalid configuration:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Parse the given environment (defaults to `process.env`); throws `ConfigError` with every problem listed. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return result.data;
}
