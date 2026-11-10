import { isHarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import { CODEX_ACCOUNT_VARS } from '../src/args.ts';
import { CodexDriver } from '../src/driver.ts';
import { CODEX_SCENARIOS } from '../src/fixtures.ts';
import { CodexLineParser } from '../src/parser.ts';
import { CHILD_A, childLines, childPath } from './fixtures/children.ts';
import { FILE_NAME, memoryRollouts, THREAD as ROLLOUT_THREAD, TURN_LINES } from './fixtures/rollout.ts';

const THREAD = '019a6f2e-8b3c-7d41-9e2a-5c8f1b4d7a63';
const ASK_EXEC = ['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"'];
const LOGIN_FILE = { name: 'auth.json', contents: FAKE_CREDENTIALS.codex_oauth.authJson, mode: 0o600 };
const DIRECT = ['-c', 'model_provider="openai"'];
const NO_UPDATE = ['-c', 'check_for_update_on_startup=false'];

describe('CodexDriver.turn', () => {
  const driver = new CodexDriver();

  it('starts a new thread with its login in the runner’s own home folder and the prompt on stdin', () => {
    expect(driver.turn(fakeTurnSpec('codex'))).toEqual({
      command: 'codex',
      args: ['exec', '--json', '--skip-git-repo-check', ...NO_UPDATE, ...ASK_EXEC, ...DIRECT, '-'],
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
      ...NO_UPDATE,
      '--model',
      'gpt-5.6-codex',
      '-c',
      'model_reasoning_effort="high"',
      '--dangerously-bypass-approvals-and-sandbox',
      ...DIRECT,
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

  it('runs a ChatGPT login through the gateway as a custom provider, with no notice', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300/backend-api/codex', headers: {} };
    const process = driver.turn(fakeTurnSpec('codex', { gateway }));
    expect(process.args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      ...NO_UPDATE,
      ...ASK_EXEC,
      '-c',
      'model_provider="mwc_gateway"',
      '-c',
      'model_providers.mwc_gateway.name="Most Wanted gateway"',
      '-c',
      'model_providers.mwc_gateway.base_url="http://127.0.0.1:8300/backend-api/codex"',
      '-c',
      'model_providers.mwc_gateway.wire_api="responses"',
      '-c',
      'model_providers.mwc_gateway.requires_openai_auth=true',
      '-',
    ]);
    expect(process.env).toEqual({});
    expect(process.privateDir?.files).toEqual([LOGIN_FILE]);
    expect(process.notices).toEqual([]);
  });

  it('runs an API key through the gateway from CODEX_API_KEY, its headers’ values only in the environment', () => {
    const gateway = {
      baseUrl: 'http://127.0.0.1:8300/v1',
      headers: { 'X-Api-Key': 'gw-secret', 'x-team': 'core' },
    };
    const credential = FAKE_CREDENTIALS.openai_api_key;
    const process = driver.turn(fakeTurnSpec('codex', { gateway, credential }));
    expect(process.args).toContain('model_providers.mwc_gateway.env_key="CODEX_API_KEY"');
    expect(process.args).toContain(
      'model_providers.mwc_gateway.env_http_headers={ "X-Api-Key" = "MWC_GATEWAY_SECRET_HEADER_1", "x-team" = "MWC_GATEWAY_SECRET_HEADER_2" }',
    );
    expect(process.env).toEqual({
      CODEX_API_KEY: 'sk-fake-openai-key',
      MWC_GATEWAY_SECRET_HEADER_1: 'gw-secret',
      MWC_GATEWAY_SECRET_HEADER_2: 'core',
    });
    expect(process.args.join(' ')).not.toMatch(/gw-secret|sk-fake-openai-key/);
    expect(process.unsetEnv).toEqual(['OPENAI_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_BASE_URL']);
    expect(process.notices).toEqual([]);
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
      args: [...NO_UPDATE, '--sandbox', 'workspace-write', '--ask-for-approval', 'on-request', ...DIRECT],
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
      args: ['resume', ...NO_UPDATE, '--dangerously-bypass-approvals-and-sandbox', ...DIRECT, THREAD],
      privateDir: { path: '/c' },
    });
  });

  it('opens the TUI through the gateway: OpenAI auth from its auth.json, the headers in the environment', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300/v1', headers: { 'x-memory-agent': 'slop' } };
    const credential = FAKE_CREDENTIALS.openai_api_key;
    const process = driver.terminal(fakeTerminalSpec('codex', { gateway, credential, sessionId: THREAD }));
    expect(process.args).toEqual([
      'resume',
      ...NO_UPDATE,
      '--sandbox',
      'workspace-write',
      '--ask-for-approval',
      'on-request',
      '-c',
      'model_provider="mwc_gateway"',
      '-c',
      'model_providers.mwc_gateway.name="Most Wanted gateway"',
      '-c',
      'model_providers.mwc_gateway.base_url="http://127.0.0.1:8300/v1"',
      '-c',
      'model_providers.mwc_gateway.wire_api="responses"',
      '-c',
      'model_providers.mwc_gateway.requires_openai_auth=true',
      '-c',
      'model_providers.mwc_gateway.env_http_headers={ "x-memory-agent" = "MWC_GATEWAY_SECRET_HEADER_1" }',
      THREAD,
    ]);
    expect(process.env).toEqual({ MWC_GATEWAY_SECRET_HEADER_1: 'slop' });
    expect(process.notices).toEqual([]);
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

  it("gives a parser that reads the thread's session file in the turn's home folder when it ends", () => {
    const home = '/state/codex/abc';
    const { fs } = memoryRollouts({ [`${home}/sessions/2026/11/09/${FILE_NAME}`]: TURN_LINES.join('\n') });
    const started = JSON.stringify({ type: 'thread.started', thread_id: ROLLOUT_THREAD });
    const reading = new CodexDriver({ rollouts: fs }).parser({ privateDir: home });
    reading.feed(started);
    expect(reading.end(null, '')[0]).toMatchObject({
      type: 'context',
      usedTokens: 35_865,
      model: 'gpt-6.1-sol',
    });
    for (const parser of [
      new CodexDriver({ rollouts: fs }).parser(),
      new CodexDriver().parser({ privateDir: home }),
    ]) {
      parser.feed(started);
      expect(parser.end(null, '')[0]).toMatchObject({ type: 'result', ok: false });
    }
  });

  it("gives a parser that reads each subagent's own file in the turn's home folder once it ends", () => {
    const home = '/state/codex/abc';
    const { fs } = memoryRollouts({
      [childPath(home, CHILD_A)]: childLines(CHILD_A, 'gpt-5.5', 'worker').join('\n'),
    });
    const parser = new CodexDriver({ rollouts: fs }).parser({ privateDir: home });
    const scenario = CODEX_SCENARIOS.subagents;
    const events = scenario.lines.flatMap((line) => parser.feed(line));
    expect(events.find((event) => event.type === 'subagent' && event.status === 'done')).toMatchObject({
      id: CHILD_A,
      agentType: 'Codex worker',
      model: 'gpt-5.5',
      lastStep: 'Ran python3 wait.py',
      summary: 'Slept 41 seconds.',
    });
  });
});
