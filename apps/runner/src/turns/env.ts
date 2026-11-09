import { isAbsolute } from 'node:path';
import type { ProcessSpec } from '@mwc/harness-core';
import { pathWithCliDir } from '../system/find-cli.ts';

/**
 * A harness process's environment (docs/harness.md, "The port"): the runner's own, less every `MWC_*` variable (its
 * configuration, a container's enrollment token) and less the variables the driver says the process must not see
 * (`unsetEnv`: another account's key, another gateway), plus the driver's own (`env`) and `extra` (the private folder's
 * variable), with the CLI's own folder first on its PATH (its helpers resolve). Values are never logged.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export function processEnv(
  own: Env,
  spec: Pick<ProcessSpec, 'command' | 'env' | 'unsetEnv'>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const unset = new Set(spec.unsetEnv);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(own)) {
    if (value !== undefined && !key.startsWith('MWC_') && !unset.has(key)) out[key] = value;
  }
  return withCliDir({ ...out, ...spec.env, ...extra }, spec.command);
}

/** `env` with the folder of a CLI started by its full path first on its PATH; a command by name changes nothing. */
export function withCliDir(env: Record<string, string>, command: string): Record<string, string> {
  return isAbsolute(command) ? { ...env, PATH: pathWithCliDir(command, env.PATH) } : env;
}
