import { isHarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '@mwc/harness-core/fake';
import { TurnEvent } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { CODEX_ACCOUNT_VARS, GATEWAY_NOTICE } from '../src/args.ts';
import { CodexDriver } from '../src/driver.ts';
import { CodexLineParser } from '../src/parser.ts';

const THREAD = '019a6f2e-8b3c-7d41-9e2a-5c8f1b4d7a63';
const ASK_EXEC = ['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"'];
const LOGIN_FILE = { name: 'auth.json', contents: FAKE_CREDENTIALS.codex_oauth.authJson, mode: 0o600 };

describe('CodexDriver.turn', () => {
  const driver = new CodexDriver();

  it('starts a new thread with its login in the runner’s own home folder and the prompt on stdin', () => {
    expect(driver.turn(fakeTurnSpec('codex'))).toEqual({
      command: 'codex',
      args: ['exec', '--json', '--skip-git-repo-check', ...ASK_EXEC, '-'],
      env: {},
      unsetEnv: [...CODEX_ACCOUNT_VARS],
      stdin: 'What is 2 + 2?',
      privateDir: { env: 'CODEX_HOME', path: null, files: [LOGIN_FILE] },
      notices: [],
    });
  });

  it('resumes the thread in the agent’s own home folder, with the model, the effort and no sandbox', () => {
    const spec = fakeTurnSpec('codex', {
      sessionId: THREAD,
      model: 'gpt-5.6-codex',
      effort: 'high',
      permissionPolicy: 'bypass',
      configDir: '/home/agent/.codex-slop',
      prompt: 'review it, then --help',
    });
    const process = driver.turn(spec);
    expect(process.args).toEqual([
      'exec',
      'resume',
      '--json',
      '--skip-git-repo-check',
      '--model',
      'gpt-5.6-codex',
      '-c',
      'model_reasoning_effort="high"',
      '--dangerously-bypass-approvals-and-sandbox',
      THREAD,
      '-',
    ]);
    expect(process.stdin).toBe('review it, then --help');
    expect(process.privateDir).toEqual({
      env: 'CODEX_HOME',
      path: '/home/agent/.codex-slop',
      files: [LOGIN_FILE],
    });
  });

  it('runs an API key from CODEX_API_KEY, with no file', () => {
    const process = driver.turn(fakeTurnSpec('codex', { credential: FAKE_CREDENTIALS.openai_api_key }));
    expect(process.env).toEqual({ CODEX_API_KEY: 'sk-fake-openai-key' });
    expect(process.unsetEnv).toEqual(['OPENAI_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL']);
    expect(process.privateDir).toEqual({ env: 'CODEX_HOME', path: null, files: [] });
  });

  it('runs without the gateway, saying so in a valid notice', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'gw' } };
    const process = driver.turn(fakeTurnSpec('codex', { gateway }));
    expect(process.notices).toEqual([{ type: 'notice', level: 'warn', message: GATEWAY_NOTICE }]);
    expect(TurnEvent.parse(process.notices[0])).toEqual(process.notices[0]);
    expect(JSON.stringify(process)).not.toContain('8300');
  });

  it('gives a turn with the runner’s tools their overrides and the server’s variables in its environment', () => {
    const tools = {
      dir: '/state/turns/0a1b',
      command: '/usr/bin/node',
      args: ['/opt/runner.mjs', 'mcp'],
      env: { MWC_ASK_SOCKET: '/state/turns/0a1b/ask.sock', MWC_ASK_TOKEN: 'tok' },
    };
    const process = driver.turn(
      fakeTurnSpec('codex', { credential: FAKE_CREDENTIALS.openai_api_key }),
      tools,
    );
    expect(process.args).toContain('mcp_servers.mwc.env_vars=["MWC_ASK_SOCKET","MWC_ASK_TOKEN"]');
    expect(process.env).toEqual({ CODEX_API_KEY: 'sk-fake-openai-key', ...tools.env });
    expect(process.turnFiles).toBeUndefined();
    expect(process.unsetEnv).not.toContain('CODEX_API_KEY');
  });

  it('uses the program the runner found', () => {
    expect(new CodexDriver({ command: '/opt/codex/bin/codex' }).turn(fakeTurnSpec('codex')).command).toBe(
      '/opt/codex/bin/codex',
    );
  });

  it('refuses a Claude credential, a Claude Code turn, an empty prompt and an option-like thread id', () => {
    const cases = [
      [fakeTurnSpec('codex', { credential: FAKE_CREDENTIALS.claude_oauth }), 'credential_mismatch'],
      [fakeTurnSpec('codex', { credential: FAKE_CREDENTIALS.anthropic_api_key }), 'credential_mismatch'],
      [fakeTurnSpec('claude_code'), 'invalid_spec'],
      [fakeTurnSpec('codex', { prompt: '' }), 'invalid_spec'],
      [fakeTurnSpec('codex', { sessionId: '--last' }), 'invalid_spec'],
      [fakeTurnSpec('codex', { model: '-m' }), 'invalid_spec'],
    ] as const;
    for (const [spec, code] of cases) {
      try {
        driver.turn(spec);
        expect.unreachable();
      } catch (error) {
        expect(isHarnessError(error, code)).toBe(true);
      }
    }
  });
});

describe('CodexDriver.terminal', () => {
  const driver = new CodexDriver();

  it('opens the TUI asking on request, or resumes the thread, with no prompt', () => {
    expect(driver.terminal(fakeTerminalSpec('codex'))).toEqual({
      command: 'codex',
      args: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
      env: {},
      unsetEnv: [...CODEX_ACCOUNT_VARS],
      stdin: null,
      privateDir: { env: 'CODEX_HOME', path: null, files: [LOGIN_FILE] },
      notices: [],
    });
    const spec = fakeTerminalSpec('codex', {
      sessionId: THREAD,
      permissionPolicy: 'bypass',
      configDir: '/c',
    });
    expect(driver.terminal(spec)).toMatchObject({
      args: ['resume', '--dangerously-bypass-approvals-and-sandbox', THREAD],
      privateDir: { path: '/c' },
    });
  });

  it('gives an API key to the TUI as auth.json, and refuses a Claude credential', () => {
    const process = driver.terminal(
      fakeTerminalSpec('codex', { credential: FAKE_CREDENTIALS.openai_api_key }),
    );
    expect(process.env).toEqual({});
    expect(process.privateDir?.files).toEqual([
      { name: 'auth.json', contents: '{"OPENAI_API_KEY":"sk-fake-openai-key"}', mode: 0o600 },
    ]);
    expect(() =>
      driver.terminal(fakeTerminalSpec('codex', { credential: FAKE_CREDENTIALS.claude_setup_token })),
    ).toThrow('A claude_setup_token subscription cannot power Codex.');
  });
});

describe('CodexDriver', () => {
  it('is the codex harness, prints its version with --version and gives a new parser each time', () => {
    const driver = new CodexDriver();
    expect(driver.harness).toBe('codex');
    expect(driver.versionArgs).toEqual(['--version']);
    expect(driver.command).toBe('codex');
    const parser = driver.parser();
    expect(parser).toBeInstanceOf(CodexLineParser);
    expect(driver.parser()).not.toBe(parser);
  });
});
