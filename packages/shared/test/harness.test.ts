import { describe, expect, it } from 'vitest';
import { CredentialKind, Harness } from '../src/enums.ts';
import {
  CODEX_AUTH_JSON_MAX,
  credentialFits,
  HARNESS_CREDENTIAL_KINDS,
  HARNESS_MODEL_PATTERN,
  HarnessCredential,
  HarnessGateway,
  SESSION_ID_PATTERN,
  TerminalSpec,
  TURN_EVENT_TYPES,
  TurnEvent,
  TurnSpec,
} from '../src/harness.ts';

const turn = {
  harness: 'claude_code',
  cwd: '/home/agent/work',
  prompt: 'What is 2 + 2?',
  sessionId: null,
  model: null,
  permissionPolicy: 'ask',
  configDir: null,
  credential: { kind: 'claude_setup_token', token: 'sk-ant-oat01-x' },
  gateway: null,
};

describe('the credentials of each harness', () => {
  it('are the Claude slot for Claude Code and the OpenAI slot for Codex', () => {
    expect(HARNESS_CREDENTIAL_KINDS).toEqual({
      claude_code: ['claude_oauth', 'claude_setup_token', 'anthropic_api_key'],
      codex: ['codex_oauth', 'openai_api_key'],
    });
  });

  it('fit only their own harness, and a gateway fits none', () => {
    for (const harness of Harness.options) {
      for (const kind of CredentialKind.options) {
        expect(credentialFits(harness, kind)).toBe(
          (HARNESS_CREDENTIAL_KINDS[harness] as readonly string[]).includes(kind),
        );
      }
    }
    expect(credentialFits('claude_code', 'gateway')).toBe(false);
    expect(credentialFits('codex', 'claude_oauth')).toBe(false);
  });
});

describe('HarnessCredential', () => {
  it('takes each kind with its secret', () => {
    for (const credential of [
      { kind: 'claude_oauth', token: 't' },
      { kind: 'claude_setup_token', token: 't' },
      { kind: 'anthropic_api_key', key: 'k' },
      { kind: 'codex_oauth', authJson: '{"tokens":{}}' },
      { kind: 'openai_api_key', key: 'k' },
    ]) {
      expect(HarnessCredential.parse(credential)).toEqual(credential);
    }
  });

  it('refuses a missing or oversized secret, an auth.json that is no JSON object, and other kinds', () => {
    const bad = [
      { kind: 'claude_oauth', token: '' },
      { kind: 'anthropic_api_key', key: 'k'.repeat(4097) },
      { kind: 'claude_setup_token', key: 't' },
      { kind: 'codex_oauth', authJson: '[1]' },
      { kind: 'codex_oauth', authJson: 'null' },
      { kind: 'codex_oauth', authJson: '{"tokens":' },
      { kind: 'codex_oauth', authJson: `{"a":"${'x'.repeat(CODEX_AUTH_JSON_MAX)}"}` },
      { kind: 'gateway', headers: {} },
    ];
    for (const credential of bad) expect(HarnessCredential.safeParse(credential).success).toBe(false);
  });
});

describe('HarnessGateway', () => {
  it('takes an http(s) address and up to 20 one-line headers, none too', () => {
    const gateway = { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'k', 'x-team': 'core' } };
    expect(HarnessGateway.parse(gateway)).toEqual(gateway);
    expect(HarnessGateway.safeParse({ baseUrl: 'https://gw.example.com/v1', headers: {} }).success).toBe(
      true,
    );
  });

  it('refuses another scheme, a header name that is not a token, a value on two lines and 21 headers', () => {
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`h${i}`, 'v']));
    for (const gateway of [
      { baseUrl: 'ftp://gw.example.com', headers: {} },
      { baseUrl: 'not a url', headers: {} },
      { baseUrl: 'https://gw.example.com', headers: { 'X Key': 'v' } },
      { baseUrl: 'https://gw.example.com', headers: { 'X-Key': 'v\nX-Other: w' } },
      { baseUrl: 'https://gw.example.com', headers: { 'X-Key': 'v\r' } },
      { baseUrl: 'https://gw.example.com', headers: many },
    ]) {
      expect(HarnessGateway.safeParse(gateway).success).toBe(false);
    }
  });
});

describe('the command-line words', () => {
  it('take session ids and models that cannot be read as options', () => {
    for (const id of ['7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47', 'thread_1', 'a.b:c']) {
      expect(SESSION_ID_PATTERN.test(id)).toBe(true);
    }
    for (const id of ['', '-x', '--resume', 'a b', 'x'.repeat(201)])
      expect(SESSION_ID_PATTERN.test(id)).toBe(false);
    for (const model of [
      'opus',
      'claude-opus-5-5[1m]',
      'gpt-5.6-codex',
      'us.anthropic.claude-x:0',
      'openai/gpt-5',
    ]) {
      expect(HARNESS_MODEL_PATTERN.test(model)).toBe(true);
    }
    for (const model of ['', '-m', '--model', 'a b', 'a\nb'])
      expect(HARNESS_MODEL_PATTERN.test(model)).toBe(false);
  });
});

describe('TurnSpec and TerminalSpec', () => {
  it('take a full turn, and keep fields a newer server adds', () => {
    const full = {
      ...turn,
      sessionId: '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47',
      model: 'opus',
      effort: 'high',
      permissionPolicy: 'bypass',
      configDir: '/home/agent/.claude-agent',
      gateway: { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'k' } },
      later: true,
    };
    expect(TurnSpec.parse(full)).toEqual(full);
    expect(TerminalSpec.parse(turn)).toMatchObject({ harness: 'claude_code', cwd: '/home/agent/work' });
  });

  it('refuse an empty prompt, a relative folder, an unknown policy, a bad model or session id', () => {
    for (const bad of [
      { prompt: '' },
      { cwd: 'work' },
      { configDir: '~/x' },
      { permissionPolicy: 'never' },
      { model: '-x' },
      { sessionId: '--x' },
      { effort: 'extreme' },
      { harness: 'aider' },
    ]) {
      expect(TurnSpec.safeParse({ ...turn, ...bad }).success).toBe(false);
    }
    const { prompt: _, ...terminal } = turn;
    expect(TurnSpec.safeParse(terminal).success).toBe(false);
    expect(TerminalSpec.safeParse(terminal).success).toBe(true);
  });
});

describe('TurnEvent', () => {
  const events = [
    { type: 'session', sessionId: 's-1' },
    { type: 'text', text: 'Hi' },
    { type: 'tool', id: 't1', name: 'Bash', summary: 'ls' },
    { type: 'tool_result', id: 't1', ok: true, summary: 'a\nb' },
    { type: 'usage', inputTokens: 10, outputTokens: 2, cachedInputTokens: 8, costUsd: 0.01 },
    { type: 'usage', inputTokens: 0, outputTokens: 0 },
    { type: 'notice', level: 'warn', message: 'Refused for permission: Bash' },
    { type: 'result', ok: true, text: 'Hi', durationMs: 12 },
    { type: 'result', ok: false, error: 'Claude Code exited with code 1' },
  ];

  it('takes every event type, one of each listed in order', () => {
    for (const event of events) expect(TurnEvent.parse(event)).toEqual(event);
    expect(new Set(events.map((event) => event.type))).toEqual(new Set(TURN_EVENT_TYPES));
  });

  it('refuses summaries over their limits, negative counts, unknown levels and types', () => {
    for (const bad of [
      { type: 'tool', id: 't', name: 'Bash', summary: 'x'.repeat(201) },
      { type: 'tool', id: '', name: 'Bash', summary: '' },
      { type: 'tool_result', id: 't', ok: true, summary: 'x'.repeat(501) },
      { type: 'usage', inputTokens: -1, outputTokens: 0 },
      { type: 'usage', inputTokens: 1.5, outputTokens: 0 },
      { type: 'notice', level: 'error', message: 'x' },
      { type: 'notice', level: 'info', message: 'x'.repeat(2001) },
      { type: 'result', ok: false, error: 'x'.repeat(2001) },
      { type: 'text', text: '' },
      { type: 'session', sessionId: '-x' },
      { type: 'thinking', text: 'x' },
    ]) {
      expect(TurnEvent.safeParse(bad).success).toBe(false);
    }
  });
});
