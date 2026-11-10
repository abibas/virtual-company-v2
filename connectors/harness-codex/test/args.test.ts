import { isHarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import {
  CODEX_ACCOUNT_VARS,
  codexAccount,
  configArg,
  configListArg,
  keyEnvOf,
  modelArgs,
  permissionArgs,
  terminalArgs,
  toolArgs,
  turnArgs,
  unsetFor,
} from '../src/args.ts';

const THREAD = '019a6f2e-8b3c-7d41-9e2a-5c8f1b4d7a63';
const ASK_EXEC = ['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"'];
const BYPASS = ['--dangerously-bypass-approvals-and-sandbox'];
/** No gateway: Codex's built-in OpenAI provider, whatever a config.toml says. */
const DIRECT = ['-c', 'model_provider="openai"'];

describe('configArg and modelArgs', () => {
  it('write a TOML string override', () => {
    expect(configArg('model_reasoning_effort', 'high')).toEqual(['-c', 'model_reasoning_effort="high"']);
  });

  it('give the model and the reasoning effort when set', () => {
    expect(modelArgs(fakeTerminalSpec('codex'))).toEqual([]);
    expect(modelArgs(fakeTerminalSpec('codex', { model: 'gpt-5.6-codex', effort: 'xhigh' }))).toEqual([
      '--model',
      'gpt-5.6-codex',
      '-c',
      'model_reasoning_effort="xhigh"',
    ]);
    expect(modelArgs(fakeTerminalSpec('codex', { effort: 'max' }))).toEqual([
      '-c',
      'model_reasoning_effort="max"',
    ]);
  });

  it('leave the model to Codex for its default marker and for a Claude id', () => {
    expect(modelArgs(fakeTerminalSpec('codex', { model: 'codex-default' }))).toEqual([]);
    expect(modelArgs(fakeTerminalSpec('codex', { model: 'claude-opus-5-5' }))).toEqual([]);
  });
});

describe('permissionArgs', () => {
  it('bypasses approvals and the sandbox in both modes', () => {
    const spec = fakeTerminalSpec('codex', { permissionPolicy: 'bypass' });
    expect(permissionArgs(spec, 'exec')).toEqual(BYPASS);
    expect(permissionArgs(spec, 'tui')).toEqual(BYPASS);
  });

  it('asks: workspace-write with approvals off in a turn, approvals on request in the terminal', () => {
    const spec = fakeTerminalSpec('codex');
    expect(permissionArgs(spec, 'exec')).toEqual(ASK_EXEC);
    expect(permissionArgs(spec, 'tui')).toEqual([
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'on-request',
    ]);
  });
});

describe('turnArgs', () => {
  it('runs codex exec on a new thread with the prompt from stdin', () => {
    expect(turnArgs(fakeTurnSpec('codex'))).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      ...ASK_EXEC,
      ...DIRECT,
      '-',
    ]);
  });

  it('resumes the thread with its options after resume and the id before the stdin marker', () => {
    const spec = fakeTurnSpec('codex', {
      sessionId: THREAD,
      model: 'gpt-5.6-codex',
      effort: 'low',
      permissionPolicy: 'bypass',
    });
    expect(turnArgs(spec)).toEqual([
      'exec',
      'resume',
      '--json',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.6-codex',
      '-c',
      'model_reasoning_effort="low"',
      ...BYPASS,
      ...DIRECT,
      THREAD,
      '-',
    ]);
  });
});

const TOOLS = {
  dir: '/state/turns/0a1b',
  command: '/usr/local/bin/node',
  args: ['/home/agent/.local/share/mwc-runner/runner.mjs', 'mcp'],
  env: { MWC_ASK_SOCKET: '/state/turns/0a1b/ask.sock', MWC_ASK_TOKEN: 'tok' },
};

const TOOL_ARGS = [
  '-c',
  'mcp_servers.mwc.command="/usr/local/bin/node"',
  '-c',
  'mcp_servers.mwc.args=["/home/agent/.local/share/mwc-runner/runner.mjs","mcp"]',
  '-c',
  'mcp_servers.mwc.env_vars=["MWC_ASK_SOCKET","MWC_ASK_TOKEN"]',
  '-c',
  'mcp_servers.mwc.default_tools_approval_mode="approve"',
];

describe('the runner’s tools', () => {
  it('start its MCP server from config overrides, its variables passed through by name, its tools approved', () => {
    expect(toolArgs(TOOLS)).toEqual(TOOL_ARGS);
    expect(toolArgs(TOOLS).join(' ')).not.toContain('tok"');
    expect(configListArg('k', ['a "b"', 'c\\d'])).toEqual(['-c', 'k=["a \\"b\\"","c\\\\d"]']);
  });

  it('come after the permissions, before the thread and the stdin marker', () => {
    expect(turnArgs(fakeTurnSpec('codex'), TOOLS)).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      ...ASK_EXEC,
      ...DIRECT,
      ...TOOL_ARGS,
      '-',
    ]);
    expect(turnArgs(fakeTurnSpec('codex', { sessionId: THREAD }), TOOLS).slice(-2)).toEqual([THREAD, '-']);
  });
});

describe('a gateway in the arguments', () => {
  const gateway = {
    baseUrl: 'http://127.0.0.1:8300/backend-api/codex',
    headers: { 'x-memory-agent': 'gw-secret' },
  };

  it('comes after the permissions and before the tools, the thread and the stdin marker, in a turn and the TUI', () => {
    const turn = turnArgs(fakeTurnSpec('codex', { gateway, sessionId: THREAD }), TOOLS);
    const provider = turn.indexOf('model_provider="mwc_gateway"');
    expect(provider).toBe(turn.indexOf('approval_policy="never"') + 2);
    expect(turn.indexOf('mcp_servers.mwc.command="/usr/local/bin/node"')).toBeGreaterThan(provider);
    expect(turn.slice(-2)).toEqual([THREAD, '-']);
    expect(turn.join(' ')).not.toContain('gw-secret');
    const tui = terminalArgs(fakeTerminalSpec('codex', { gateway, sessionId: THREAD }));
    expect(tui).toContain('model_providers.mwc_gateway.requires_openai_auth=true');
    expect(tui.at(-1)).toBe(THREAD);
    expect(tui.join(' ')).not.toContain('gw-secret');
  });

  it('authenticates an API key from CODEX_API_KEY in codex exec, from its auth.json in the TUI', () => {
    const credential = FAKE_CREDENTIALS.openai_api_key;
    expect(turnArgs(fakeTurnSpec('codex', { gateway, credential }))).toContain(
      'model_providers.mwc_gateway.env_key="CODEX_API_KEY"',
    );
    expect(terminalArgs(fakeTerminalSpec('codex', { gateway, credential }))).toContain(
      'model_providers.mwc_gateway.requires_openai_auth=true',
    );
  });
});

describe('terminalArgs', () => {
  it('opens the TUI, or resumes the thread in it', () => {
    expect(terminalArgs(fakeTerminalSpec('codex'))).toEqual([
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'on-request',
      ...DIRECT,
    ]);
    const spec = fakeTerminalSpec('codex', { sessionId: THREAD, model: 'o4', permissionPolicy: 'bypass' });
    expect(terminalArgs(spec)).toEqual(['resume', '--model', 'o4', ...BYPASS, ...DIRECT, THREAD]);
  });
});

describe('codexAccount', () => {
  it('writes a login’s auth.json in either mode', () => {
    const login = FAKE_CREDENTIALS.codex_oauth;
    const file = { name: 'auth.json', contents: login.authJson, mode: 0o600 };
    expect(codexAccount(login, 'exec')).toEqual({ env: {}, files: [file] });
    expect(codexAccount(login, 'tui')).toEqual({ env: {}, files: [file] });
  });

  it('gives an API key as CODEX_API_KEY to exec, and as an auth.json to the TUI', () => {
    const key = FAKE_CREDENTIALS.openai_api_key;
    expect(codexAccount(key, 'exec')).toEqual({ env: { CODEX_API_KEY: 'sk-fake-openai-key' }, files: [] });
    expect(codexAccount(key, 'tui')).toEqual({
      env: {},
      files: [{ name: 'auth.json', contents: '{"OPENAI_API_KEY":"sk-fake-openai-key"}', mode: 0o600 }],
    });
  });

  it('refuses a Claude credential as credential_mismatch', () => {
    for (const credential of [
      FAKE_CREDENTIALS.claude_oauth,
      FAKE_CREDENTIALS.claude_setup_token,
      FAKE_CREDENTIALS.anthropic_api_key,
    ]) {
      expect(() => codexAccount(credential, 'exec')).toThrow(
        `A ${credential.kind} subscription cannot power Codex.`,
      );
      try {
        codexAccount(credential, 'tui');
      } catch (error) {
        expect(isHarnessError(error, 'credential_mismatch')).toBe(true);
      }
    }
  });
});

describe('unsetFor and keyEnvOf', () => {
  it('remove the account variables the turn does not set', () => {
    expect(unsetFor({})).toEqual([...CODEX_ACCOUNT_VARS]);
    expect(unsetFor({ CODEX_API_KEY: 'k' })).toEqual([
      'OPENAI_API_KEY',
      'CODEX_ACCESS_TOKEN',
      'OPENAI_BASE_URL',
    ]);
  });

  it('name the variable an API key is in for codex exec, and none for a login file', () => {
    expect(keyEnvOf(FAKE_CREDENTIALS.openai_api_key, 'exec')).toBe('CODEX_API_KEY');
    expect(keyEnvOf(FAKE_CREDENTIALS.openai_api_key, 'tui')).toBeUndefined();
    expect(keyEnvOf(FAKE_CREDENTIALS.codex_oauth, 'exec')).toBeUndefined();
  });
});
