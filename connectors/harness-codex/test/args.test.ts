import { isHarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import {
  CODEX_ACCOUNT_VARS,
  codexAccount,
  configArg,
  configListArg,
  GATEWAY_NOTICE,
  gatewayNotices,
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
      ...TOOL_ARGS,
      '-',
    ]);
    expect(turnArgs(fakeTurnSpec('codex', { sessionId: THREAD }), TOOLS).slice(-2)).toEqual([THREAD, '-']);
  });
});

describe('terminalArgs', () => {
  it('opens the TUI, or resumes the thread in it', () => {
    expect(terminalArgs(fakeTerminalSpec('codex'))).toEqual([
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'on-request',
    ]);
    const spec = fakeTerminalSpec('codex', { sessionId: THREAD, model: 'o4', permissionPolicy: 'bypass' });
    expect(terminalArgs(spec)).toEqual(['resume', '--model', 'o4', ...BYPASS, THREAD]);
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

describe('unsetFor and gatewayNotices', () => {
  it('remove the account variables the turn does not set', () => {
    expect(unsetFor({})).toEqual([...CODEX_ACCOUNT_VARS]);
    expect(unsetFor({ CODEX_API_KEY: 'k' })).toEqual([
      'OPENAI_API_KEY',
      'CODEX_ACCESS_TOKEN',
      'OPENAI_BASE_URL',
    ]);
  });

  it('warn when the turn has a gateway Codex cannot use', () => {
    expect(gatewayNotices(fakeTerminalSpec('codex'))).toEqual([]);
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'gw' } };
    expect(gatewayNotices(fakeTerminalSpec('codex', { gateway }))).toEqual([
      { type: 'notice', level: 'warn', message: GATEWAY_NOTICE },
    ]);
  });
});
