import { MachinePowerError, type MachinePowerErrorCode } from '@mwc/machines-core';
import type { RunResult } from './run.ts';

/** The longest output excerpt an error carries. */
export const DETAIL_MAX = 200;

/** What gcloud and the airia CLI print for each failure they share with the port, checked in this order. */
const PATTERNS: readonly (readonly [MachinePowerErrorCode, RegExp])[] = [
  ['cli_missing', /command not found|(airia|gcloud): No such file or directory/i],
  [
    'needs_gcloud_login',
    /credentials have expired or are missing|no active gcloud account|gcloud auth login|reauthenticat|refreshing your current auth tokens|invalid_grant|do not currently have an active account/i,
  ],
  [
    'stockout_or_quota',
    /QUOTA_EXCEEDED|Quota .* exceeded|ZONE_RESOURCE_POOL_EXHAUSTED|does not have enough resources|vCPU quota is full|no capacity for it/i,
  ],
  ['not_found', /was not found|no devbox named/i],
];

/** Tokens and anything that looks like one: Google access and refresh tokens, long opaque strings. */
const SECRETS = /ya29\.[\w.-]+|1\/\/[\w.-]+|[A-Za-z0-9_-]{40,}/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the terminal's colour codes
const ANSI = /\u001b\[[0-9;]*m/g;

/** The last line of the output that says something, without colours or token-like strings, at most `DETAIL_MAX`. */
export function detailOf(output: string): string | undefined {
  const lines = output
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const last = lines.at(-1);
  if (last === undefined) return undefined;
  const clean = last.replace(SECRETS, '[redacted]');
  return clean.length > DETAIL_MAX ? `${clean.slice(0, DETAIL_MAX - 1)}…` : clean;
}

/** The port's error code for a failed command's output; `failed` when nothing matches. */
export function codeOf(output: string): MachinePowerErrorCode {
  return PATTERNS.find(([, pattern]) => pattern.test(output))?.[0] ?? 'failed';
}

/** The error for a command that ran and failed: by its timeout, its exit code 127, else its words. */
export function errorOf(result: RunResult, what: string): MachinePowerError {
  const output = `${result.stderr}\n${result.stdout}`;
  const detail = detailOf(result.stderr) ?? detailOf(result.stdout);
  const options = detail === undefined ? {} : { detail };
  if (result.timedOut) return new MachinePowerError('timeout', undefined, options);
  const code = result.exitCode === 127 ? 'cli_missing' : codeOf(output);
  return new MachinePowerError(code, code === 'failed' ? `${what} failed.` : undefined, options);
}

/** The error for a command that could not be started: a missing tool (ENOENT), else `failed`. */
export function spawnErrorOf(error: unknown, command: string): MachinePowerError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOENT') {
    return new MachinePowerError('cli_missing', `${command} is not installed on the controlling machine.`, {
      cause: error,
    });
  }
  return new MachinePowerError('failed', `${command} could not be started.`, { cause: error });
}
