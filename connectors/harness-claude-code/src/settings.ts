import { randomBytes } from 'node:crypto';
import type { PrivateDir, PrivateFile } from '@mwc/harness-core';
import type { HarnessGateway } from '@mwc/shared/harness';

/**
 * Claude Code's private settings file (docs/harness.md, "Claude Code"): the access profile's gateway decides where a turn
 * or a terminal sends its AI requests, whatever the machine's own settings say. A machine's `~/.claude/settings.json`
 * `env` (or a project's) is applied over the process's environment, so the turn's variables alone cannot win; settings
 * given with `--settings` rank above user, project and local settings (only managed settings rank higher), so the driver
 * writes one: the gateway's address and headers, or, without a gateway, Anthropic's own address and no headers. The
 * runner writes it 0600 in the harness's private folder before the process, passes `--settings <path>`, and removes it
 * when the last process using the folder ends. Headers are secrets: never on a command line.
 */

/** The option that names the settings file. */
export const SETTINGS_OPTION = '--settings';

/** Where Claude Code's requests go without a gateway: Anthropic's API itself. */
export const DIRECT_BASE_URL = 'https://api.anthropic.com';

/** `ANTHROPIC_CUSTOM_HEADERS`: one `Name: value` per line. */
export function customHeaders(headers: HarnessGateway['headers']): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

/** The settings' `env`: the gateway's address and headers, or Anthropic's address and no headers. */
export function settingsEnv(gateway: HarnessGateway | null): Record<string, string> {
  return gateway === null
    ? { ANTHROPIC_BASE_URL: DIRECT_BASE_URL, ANTHROPIC_CUSTOM_HEADERS: '' }
    : { ANTHROPIC_BASE_URL: gateway.baseUrl, ANTHROPIC_CUSTOM_HEADERS: customHeaders(gateway.headers) };
}

/**
 * The settings file of one process: a name of its own (two turns in one folder may run on two profiles), 0600, named
 * with `--settings`.
 */
export function settingsFile(gateway: HarnessGateway | null): PrivateFile {
  return {
    name: `settings-${randomBytes(6).toString('hex')}.json`,
    contents: JSON.stringify({ env: settingsEnv(gateway) }),
    mode: 0o600,
    option: SETTINGS_OPTION,
  };
}

/** The private folder a process gets: the runner's own for Claude Code and the agent's folder, no variable. */
export function settingsDir(gateway: HarnessGateway | null): PrivateDir {
  return { path: null, files: [settingsFile(gateway)] };
}
