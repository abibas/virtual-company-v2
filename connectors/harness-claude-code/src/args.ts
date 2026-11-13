import { join } from 'node:path';
import { HarnessError, type TurnTools } from '@mwc/harness-core';
import {
  ASK_SERVER,
  ASK_TOOL,
  type HarnessCredential,
  type TerminalSpec,
  type TurnSpec,
} from '@mwc/shared/harness';
import { snapshotArgs } from './instructions.ts';
import { customHeaders } from './settings.ts';

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

/**
 * The resume, model, effort and permission arguments a turn and a terminal share, and the system prompt rendered fresh
 * with standing instructions (`instructions.ts`).
 */
export function sharedArgs(spec: TerminalSpec): string[] {
  return [
    ...(spec.sessionId === null ? [] : ['--resume', spec.sessionId]),
    ...(spec.model === null ? [] : ['--model', spec.model]),
    ...(spec.effort === undefined ? [] : ['--effort', spec.effort]),
    ...(spec.permissionPolicy === 'bypass' ? ['--dangerously-skip-permissions'] : []),
    ...snapshotArgs(spec),
  ];
}

/**
 * A branch's first turn (docs/harness.md "Branching"): the resumed session forked into a new one (`--fork-session`, the
 * original untouched), cut after a message of it when the turn says one (`--resume-session-at <uuid>`, a print-mode
 * option `claude --help` does not list; Claude Code 2.1.322 keeps the messages up to and including that one). Nothing
 * for any other turn, or without a session to fork.
 */
export function forkArgs(spec: TurnSpec): string[] {
  if (spec.forkSession !== true || spec.sessionId === null) return [];
  return ['--fork-session', ...(spec.resumeAt === undefined ? [] : ['--resume-session-at', spec.resumeAt])];
}

/** The MCP config a turn with the runner's tools gets, in the turn's folder. */
export const MCP_CONFIG_FILE = 'mcp.json';

/** The line `--append-system-prompt` adds to a turn with the runner's tools: when to ask, and to end the turn then. */
export const ASK_PROMPT =
  `When the person must choose between options, ask them with the ${ASK_TOOL} tool, then end your turn: ` +
  'their answer comes as their next message.';

/** The runner's MCP server as Claude Code's `--mcp-config` names it (its token in `env`, never on a command line). */
export function mcpConfig(tools: TurnTools): string {
  const server = { type: 'stdio', command: tools.command, args: tools.args, env: tools.env };
  return JSON.stringify({ mcpServers: { [ASK_SERVER]: server } });
}

/**
 * An MCP tool's name as Claude Code calls it: `mcp__<server>__<tool>`; only one plain word is allowed: letters, digits
 * and `_` (the server's own tools keep Atlassian's camelCase names, S7.1c).
 */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * What `--allowedTools` takes for the runner's tools: one argument, every tool its server offers as Claude Code names it
 * (`mcp__mwc__ask_user_question,mcp__mwc__task_read,…`; `claude --help` 2.1.322: "Comma or space-separated list of tool
 * names to allow"), so the `ask` policy does not refuse them in print mode. A name that is not one plain word is passed
 * over (it could name another tool); the question tool is always there.
 */
export function allowedTools(tools: TurnTools): string {
  const names = tools.names.filter((name) => TOOL_NAME.test(name));
  const offered = names.includes(ASK_TOOL) ? names : [ASK_TOOL, ...names];
  return offered.map((name) => `mcp__${ASK_SERVER}__${name}`).join(',');
}

/**
 * A turn's arguments for the runner's tools: the MCP config file in the turn's folder, its tools allowed
 * (`allowedTools`), and the line that says when to ask, unless that line goes in the standing instructions' file
 * (`prompt` false).
 */
export function toolArgs(tools: TurnTools, prompt = true): string[] {
  return [
    '--mcp-config',
    join(tools.dir, MCP_CONFIG_FILE),
    '--allowedTools',
    allowedTools(tools),
    ...(prompt ? ['--append-system-prompt', ASK_PROMPT] : []),
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

/** Claude Code's own auto-updater off: no update mid-run; a machine's CLIs are updated from its card instead. */
export const NO_AUTO_UPDATE = { DISABLE_AUTOUPDATER: '1' } as const;

/**
 * The variables to add: the auto-updater off (`NO_AUTO_UPDATE`), the credential's, the config folder, the gateway's address and headers (the private settings
 * file, `settings.ts`, says the same, so a machine's own settings cannot override them).
 */
export function claudeEnv(spec: TerminalSpec): Record<string, string> {
  const env: Record<string, string> = { ...NO_AUTO_UPDATE, ...credentialEnv(spec.credential) };
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
