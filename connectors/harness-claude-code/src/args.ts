import { HarnessError } from '@mwc/harness-core';
import type { HarnessCredential, HarnessGateway, TerminalSpec } from '@mwc/shared/harness';

/** Claude Code's command line and environment for a turn or a terminal (docs/harness.md, "Claude Code"). */

/** The program, when the runner gives no full path. */
export const CLAUDE_COMMAND = 'claude';

/** The arguments of a turn before the shared ones: print mode, its output streamed as JSON lines. */
export const TURN_ARGS = ['-p', '--output-format', 'stream-json', '--verbose'] as const;

/**
 * The variables that pick Claude Code's account, endpoint and config folder. The ones a turn does not set are removed
 * from the runner's own environment, so the access profile alone decides: an `ANTHROPIC_API_KEY` left on the machine
 * would otherwise win over the profile's subscription.
 */
export const CLAUDE_ACCOUNT_VARS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CONFIG_DIR',
] as const;

/** The resume, model, effort and permission arguments a turn and a terminal share. */
export function sharedArgs(spec: TerminalSpec): string[] {
  return [
    ...(spec.sessionId === null ? [] : ['--resume', spec.sessionId]),
    ...(spec.model === null ? [] : ['--model', spec.model]),
    ...(spec.effort === undefined ? [] : ['--effort', spec.effort]),
    ...(spec.permissionPolicy === 'bypass' ? ['--dangerously-skip-permissions'] : []),
  ];
}

/** The credential's variable: a login's access token or a setup-token, or an API key. */
export function credentialEnv(credential: HarnessCredential): Record<string, string> {
  switch (credential.kind) {
    case 'claude_oauth':
    case 'claude_setup_token':
      return { CLAUDE_CODE_OAUTH_TOKEN: credential.token };
    case 'anthropic_api_key':
      return { ANTHROPIC_API_KEY: credential.key };
    default:
      throw new HarnessError(
        'credential_mismatch',
        `A ${credential.kind} subscription cannot power Claude Code.`,
      );
  }
}

/** `ANTHROPIC_CUSTOM_HEADERS`: one `Name: value` per line. */
export function customHeaders(headers: HarnessGateway['headers']): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');
}

/** The variables to add: the credential's, the config folder, the gateway's address and headers. */
export function claudeEnv(spec: TerminalSpec): Record<string, string> {
  const env = credentialEnv(spec.credential);
  if (spec.configDir !== null) env.CLAUDE_CONFIG_DIR = spec.configDir;
  if (spec.gateway !== null) {
    env.ANTHROPIC_BASE_URL = spec.gateway.baseUrl;
    const headers = customHeaders(spec.gateway.headers);
    if (headers !== '') env.ANTHROPIC_CUSTOM_HEADERS = headers;
  }
  return env;
}

/** The account variables `env` does not set. */
export function unsetFor(env: Readonly<Record<string, string>>): string[] {
  return CLAUDE_ACCOUNT_VARS.filter((name) => !(name in env));
}
