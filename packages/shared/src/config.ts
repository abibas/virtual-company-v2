import { z } from 'zod';
import { PORTS } from './ports.ts';

/**
 * Process configuration, 12-factor style: everything comes from the environment,
 * is validated once at startup, and a missing or malformed value fails fast.
 */
export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  MWC_PORT: z.coerce.number().int().min(1).max(65535).default(PORTS.api),
  MWC_PUBLIC_URL: z.url().default(`http://localhost:${PORTS.api}`),
  MWC_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
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
