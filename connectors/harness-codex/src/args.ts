import { HarnessError, type PrivateFile, type TurnNotice, type TurnTools } from '@mwc/harness-core';
import { ASK_SERVER, type HarnessCredential, type TerminalSpec, type TurnSpec } from '@mwc/shared/harness';

/** Codex's command line, environment and home folder for a turn or a terminal (docs/harness.md, "Codex"). */

/** The program, when the runner gives no full path. */
export const CODEX_COMMAND = 'codex';

/** The variable of Codex's home folder: its login (`auth.json`), its config and its threads. */
export const CODEX_HOME_ENV = 'CODEX_HOME';

/** The login file in Codex's home folder. */
export const CODEX_AUTH_FILE = 'auth.json';

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

/** The notice of a turn whose access profile has a gateway: Codex does not use one yet. */
export const GATEWAY_NOTICE =
  'This access profile’s gateway is not used: Codex does not support a gateway yet, so this connects to OpenAI directly.';

/** A `-c key=value` override; the value is a TOML string. */
export function configArg(key: string, value: string): string[] {
  return ['-c', `${key}=${JSON.stringify(value)}`];
}

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

/** A `-c key=value` override whose value is a TOML array of strings. */
export function configListArg(key: string, values: readonly string[]): string[] {
  return ['-c', `${key}=${JSON.stringify(values)}`];
}

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
 * `codex exec … -` for a new thread, `codex exec resume … <id> -` for the next turn; the prompt comes on stdin. With
 * the runner's tools, their overrides come after the permissions.
 */
export function turnArgs(spec: TurnSpec, tools?: TurnTools): string[] {
  const options = [
    '--json',
    '--skip-git-repo-check',
    ...modelArgs(spec),
    ...permissionArgs(spec, 'exec'),
    ...(tools === undefined ? [] : toolArgs(tools)),
  ];
  return spec.sessionId === null
    ? ['exec', ...options, '-']
    : ['exec', 'resume', ...options, spec.sessionId, '-'];
}

/** `codex …` for a new conversation, `codex resume … <id>` for an existing one. */
export function terminalArgs(spec: TerminalSpec): string[] {
  const options = [...modelArgs(spec), ...permissionArgs(spec, 'tui')];
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
        ? { env: { CODEX_API_KEY: credential.key }, files: [] }
        : { env: {}, files: [authFile(JSON.stringify({ OPENAI_API_KEY: credential.key }))] };
    default:
      throw new HarnessError('credential_mismatch', `A ${credential.kind} subscription cannot power Codex.`);
  }
}

/** The account variables `env` does not set. */
export function unsetFor(env: Readonly<Record<string, string>>): string[] {
  return CODEX_ACCOUNT_VARS.filter((name) => !(name in env));
}

/** A notice when the turn has a gateway Codex cannot use. */
export function gatewayNotices(spec: TerminalSpec): TurnNotice[] {
  return spec.gateway === null ? [] : [{ type: 'notice', level: 'warn', message: GATEWAY_NOTICE }];
}
