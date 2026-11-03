import { z } from 'zod';
import { PORTS, SLOT_COUNT, slotPorts } from './ports.ts';

/** An empty variable (`MWC_PORT_SLOT=` in a .env file) counts as unset, not as 0. */
const emptyAsUnset = (value: unknown) => (value === '' ? undefined : value);

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
});

/**
 * Process configuration, 12-factor style: everything comes from the environment,
 * is validated once at startup, and a missing or malformed value fails fast.
 * Precedence for the API port: MWC_PORT, then MWC_PORT_SLOT's API port, then 9950.
 */
export const ConfigSchema = EnvSchema.transform(({ MWC_PORT_SLOT, MWC_PORT, MWC_PUBLIC_URL, ...rest }) => {
  const port = MWC_PORT ?? (MWC_PORT_SLOT === undefined ? PORTS.api : slotPorts(MWC_PORT_SLOT).api);
  return {
    ...rest,
    ...(MWC_PORT_SLOT === undefined ? {} : { MWC_PORT_SLOT }),
    MWC_PORT: port,
    MWC_PUBLIC_URL: MWC_PUBLIC_URL ?? `http://localhost:${port}`,
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
