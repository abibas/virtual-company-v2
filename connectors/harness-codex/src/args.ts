import { HarnessError, type PrivateFile, type TurnTools } from '@mwc/harness-core';
import { ASK_SERVER, type HarnessCredential, type TerminalSpec, type TurnSpec } from '@mwc/shared/harness';
import { configArg, configFlagArg, configListArg } from './config.ts';
import { providerArgs } from './gateway.ts';

/** Codex's command line, environment and home folder for a turn or a terminal (docs/harness.md, "Codex"). */

/** The program, when the runner gives no full path. */
export const CODEX_COMMAND = 'codex';

/** The variable of Codex's home folder: its login (`auth.json`), its config and its threads. */
export const CODEX_HOME_ENV = 'CODEX_HOME';

/** The login file in Codex's home folder. */
export const CODEX_AUTH_FILE = 'auth.json';

/** The variable `codex exec` reads an API key from (its documented one). */
export const CODEX_API_KEY_ENV = 'CODEX_API_KEY';

/**
 * The variables that pick Codex's account or endpoint. The ones a turn does not set are removed from the runner's own
 * environment, so the access profile alone decides.
 */
export const CODEX_ACCOUNT_VARS = [
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_ACCESS_TOKEN',
  'OPENAI_BASE_URL',
] as const;

export { configArg, configListArg } from './config.ts';

/** The model id that means "Codex's own default" (the agent form's choice for a Codex agent). */
export const CODEX_DEFAULT_MODEL = 'codex-default';

/** A model Codex can be given: not its default marker, and not a Claude id (left over from a harness change). */
const codexModel = (model: string | null): string | null =>
  model === null || model === CODEX_DEFAULT_MODEL || model.startsWith('claude-') ? null : model;

/** The model (none for Codex's default or a Claude id) and the reasoning effort. */
export function modelArgs(spec: TerminalSpec): string[] {
  const model = codexModel(spec.model);
  return [
    ...(model === null ? [] : ['--model', model]),
    ...(spec.effort === undefined ? [] : configArg('model_reasoning_effort', spec.effort)),
  ];
}

/**
 * `bypass`: no sandbox, no approvals. `ask` in a turn: the workspace-write sandbox with approvals off, so what needs
 * more is refused and the model is told (as config overrides, since `codex exec resume` has no `--sandbox`); `ask` in
 * the terminal: the same sandbox, and Codex asks the person on the TUI.
 */
export function permissionArgs(spec: TerminalSpec, mode: 'exec' | 'tui'): string[] {
  if (spec.permissionPolicy === 'bypass') return ['--dangerously-bypass-approvals-and-sandbox'];
  if (mode === 'tui') return ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'];
  return [...configArg('sandbox_mode', 'workspace-write'), ...configArg('approval_policy', 'never')];
}

/**
 * Codex's own update check off (`check_for_update_on_startup`, a top-level config key): no "Update available" notice
 * or update prompt in a turn or the terminal; a machine's CLIs are updated from its card instead.
 */
export const NO_UPDATE_CHECK = configFlagArg('check_for_update_on_startup', false);

/**
 * A turn's overrides for the runner's tools: its MCP server's command and arguments, the variables Codex hands it from
 * its own environment (`env_vars`: the socket and the token, so the token is not on the command line), and its tools
 * approved without asking (a turn's approvals are off). Codex gets no extra instruction line: its
 * `developer_instructions` would replace the agent's own; the tool's description says when to use it.
 */
export function toolArgs(tools: TurnTools): string[] {
  const server = `mcp_servers.${ASK_SERVER}`;
  return [
    ...configArg(`${server}.command`, tools.command),
    ...configListArg(`${server}.args`, tools.args),
    ...configListArg(`${server}.env_vars`, Object.keys(tools.env)),
    ...configArg(`${server}.default_tools_approval_mode`, 'approve'),
  ];
}

/**
 * The variable an API key is in for this mode (`codex exec` reads `CODEX_API_KEY`), which a gateway's provider names as
 * its `env_key`; undefined when the credential is in the login file (a ChatGPT login, an API key in the TUI).
 */
export const keyEnvOf = (credential: HarnessCredential, mode: 'exec' | 'tui'): string | undefined =>
  credential.kind === 'openai_api_key' && mode === 'exec' ? CODEX_API_KEY_ENV : undefined;

/**
 * `codex exec … -` for a new thread, `codex exec resume … <id> -` for the next turn, `codex exec fork … <id> -` for a
 * branch's first turn (a new thread from a copy of the whole thread, Codex 0.167.0; it has no way to fork from an
 * earlier turn, so a spec saying one is refused); the prompt comes on stdin. The provider (the profile's gateway, or
 * OpenAI directly, `gateway.ts`) comes after the permissions, then the runner's tools when it offers them.
 */
export function turnArgs(spec: TurnSpec, tools?: TurnTools): string[] {
  const options = [
    '--json',
    '--skip-git-repo-check',
    ...NO_UPDATE_CHECK,
    ...modelArgs(spec),
    ...permissionArgs(spec, 'exec'),
    ...providerArgs(spec.gateway, keyEnvOf(spec.credential, 'exec')),
    ...(tools === undefined ? [] : toolArgs(tools)),
  ];
  if (spec.resumeAt !== undefined) {
    throw new HarnessError('invalid_spec', 'Codex forks a whole conversation only, never up to a message.');
  }
  if (spec.sessionId === null) return ['exec', ...options, '-'];
  return ['exec', spec.forkSession === true ? 'fork' : 'resume', ...options, spec.sessionId, '-'];
}

/** `codex …` for a new conversation, `codex resume … <id>` for an existing one, with the same provider as a turn. */
export function terminalArgs(spec: TerminalSpec): string[] {
  const options = [
    ...NO_UPDATE_CHECK,
    ...modelArgs(spec),
    ...permissionArgs(spec, 'tui'),
    ...providerArgs(spec.gateway, keyEnvOf(spec.credential, 'tui')),
  ];
  return spec.sessionId === null ? options : ['resume', ...options, spec.sessionId];
}

/** How the credential reaches Codex: variables to add, and files for its home folder. */
export interface CodexAccount {
  readonly env: Record<string, string>;
  readonly files: PrivateFile[];
}

const authFile = (contents: string): PrivateFile => ({ name: CODEX_AUTH_FILE, contents, mode: 0o600 });

/**
 * A login: its `auth.json` in the home folder. An API key: `CODEX_API_KEY` for `codex exec` (its documented variable);
 * the TUI reads no key variable, so the terminal gets it as an `auth.json` holding only `OPENAI_API_KEY`, as
 * `codex login --with-api-key` writes it.
 */
export function codexAccount(credential: HarnessCredential, mode: 'exec' | 'tui'): CodexAccount {
  switch (credential.kind) {
    case 'codex_oauth':
      return { env: {}, files: [authFile(credential.authJson)] };
    case 'openai_api_key':
      return mode === 'exec'
        ? { env: { [CODEX_API_KEY_ENV]: credential.key }, files: [] }
        : { env: {}, files: [authFile(JSON.stringify({ OPENAI_API_KEY: credential.key }))] };
    default:
      throw new HarnessError('credential_mismatch', `A ${credential.kind} subscription cannot power Codex.`);
  }
}

/** The account variables `env` does not set. */
export function unsetFor(env: Readonly<Record<string, string>>): string[] {
  return CODEX_ACCOUNT_VARS.filter((name) => !(name in env));
}
