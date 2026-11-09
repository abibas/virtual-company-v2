import { isHarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import { CLAUDE_ACCOUNT_VARS } from '../src/args.ts';
import { ClaudeCodeDriver } from '../src/driver.ts';
import { ClaudeLineParser } from '../src/parser.ts';

const SESSION = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';
const TURN = ['-p', '--output-format', 'stream-json', '--verbose'];

describe('ClaudeCodeDriver.turn', () => {
  const driver = new ClaudeCodeDriver();

  it('starts a new conversation in print mode with the prompt on stdin', () => {
    expect(driver.turn(fakeTurnSpec('claude_code'))).toEqual({
      command: 'claude',
      args: TURN,
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token' },
      unsetEnv: CLAUDE_ACCOUNT_VARS.filter((name) => name !== 'CLAUDE_CODE_OAUTH_TOKEN'),
      stdin: 'What is 2 + 2?',
      notices: [],
    });
  });

  it('resumes the session with the model, the effort and no permission prompts', () => {
    const spec = fakeTurnSpec('claude_code', {
      sessionId: SESSION,
      model: 'claude-opus-5-5',
      effort: 'max',
      permissionPolicy: 'bypass',
      prompt: '-p --help and double it',
    });
    const process = driver.turn(spec);
    expect(process.args).toEqual([
      ...TURN,
      '--resume',
      SESSION,
      '--model',
      'claude-opus-5-5',
      '--effort',
      'max',
      '--dangerously-skip-permissions',
    ]);
    expect(process.stdin).toBe('-p --help and double it');
    expect(process.args).not.toContain(spec.prompt);
  });

  it('asks (no skip flag) under the ask policy, so -p refuses what needs approval', () => {
    expect(driver.turn(fakeTurnSpec('claude_code', { permissionPolicy: 'ask' })).args).toEqual(TURN);
  });

  it('gives each credential kind its variable, with the config folder and the gateway', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'gw' } };
    for (const [credential, variable] of [
      [FAKE_CREDENTIALS.claude_oauth, 'CLAUDE_CODE_OAUTH_TOKEN'],
      [FAKE_CREDENTIALS.claude_setup_token, 'CLAUDE_CODE_OAUTH_TOKEN'],
      [FAKE_CREDENTIALS.anthropic_api_key, 'ANTHROPIC_API_KEY'],
    ] as const) {
      const process = driver.turn(fakeTurnSpec('claude_code', { credential, configDir: '/cfg', gateway }));
      expect(Object.keys(process.env).sort()).toEqual(
        [variable, 'CLAUDE_CONFIG_DIR', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS'].sort(),
      );
      expect(process.unsetEnv).not.toContain(variable);
      expect(process.unsetEnv).not.toContain('CLAUDE_CONFIG_DIR');
      expect(process.env.ANTHROPIC_CUSTOM_HEADERS).toBe('X-Api-Key: gw');
      expect(process.privateDir).toBeUndefined();
    }
  });

  it('uses the program the runner found', () => {
    const found = new ClaudeCodeDriver({ command: '/home/agent/.local/bin/claude' });
    expect(found.turn(fakeTurnSpec('claude_code')).command).toBe('/home/agent/.local/bin/claude');
    expect(found.command).toBe('/home/agent/.local/bin/claude');
  });

  it('refuses an OpenAI credential, a Codex turn, an empty prompt and an option-like session id', () => {
    const cases = [
      [fakeTurnSpec('claude_code', { credential: FAKE_CREDENTIALS.codex_oauth }), 'credential_mismatch'],
      [fakeTurnSpec('claude_code', { credential: FAKE_CREDENTIALS.openai_api_key }), 'credential_mismatch'],
      [fakeTurnSpec('codex'), 'invalid_spec'],
      [fakeTurnSpec('claude_code', { prompt: '  ' }), 'invalid_spec'],
      [fakeTurnSpec('claude_code', { sessionId: '--fork-session' }), 'invalid_spec'],
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

describe('ClaudeCodeDriver.terminal', () => {
  const driver = new ClaudeCodeDriver();

  it('opens the TUI on a new conversation, or resumes one, with no prompt', () => {
    expect(driver.terminal(fakeTerminalSpec('claude_code'))).toEqual({
      command: 'claude',
      args: [],
      env: { CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token' },
      unsetEnv: CLAUDE_ACCOUNT_VARS.filter((name) => name !== 'CLAUDE_CODE_OAUTH_TOKEN'),
      stdin: null,
      notices: [],
    });
    const spec = fakeTerminalSpec('claude_code', {
      sessionId: SESSION,
      model: 'opus',
      permissionPolicy: 'bypass',
    });
    expect(driver.terminal(spec).args).toEqual([
      '--resume',
      SESSION,
      '--model',
      'opus',
      '--dangerously-skip-permissions',
    ]);
  });

  it('refuses a credential of the other family', () => {
    expect(() =>
      driver.terminal(fakeTerminalSpec('claude_code', { credential: FAKE_CREDENTIALS.codex_oauth })),
    ).toThrow('A codex_oauth subscription cannot power Claude Code.');
  });
});

describe('ClaudeCodeDriver', () => {
  it('is the claude_code harness, prints its version with --version and gives a new parser each time', () => {
    const driver = new ClaudeCodeDriver();
    expect(driver.harness).toBe('claude_code');
    expect(driver.versionArgs).toEqual(['--version']);
    const parser = driver.parser();
    expect(parser).toBeInstanceOf(ClaudeLineParser);
    expect(driver.parser()).not.toBe(parser);
  });
});
