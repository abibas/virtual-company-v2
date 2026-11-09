import type { ProcessSpec } from '@mwc/harness-core';

/**
 * A harness process's environment (docs/harness.md, "The port"): the runner's own, less every `MWC_*` variable (its
 * configuration, a container's enrollment token) and less the variables the driver says the process must not see
 * (`unsetEnv`: another account's key, another gateway), plus the driver's own (`env`) and `extra` (the private folder's
 * variable). Values are never logged.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export function processEnv(
  own: Env,
  spec: Pick<ProcessSpec, 'env' | 'unsetEnv'>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const unset = new Set(spec.unsetEnv);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(own)) {
    if (value !== undefined && !key.startsWith('MWC_') && !unset.has(key)) out[key] = value;
  }
  return { ...out, ...spec.env, ...extra };
}
