import { describe, expect, it } from 'vitest';
import { checkSpec, checkTurn } from '../src/checks.ts';
import { isHarnessError } from '../src/errors.ts';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '../src/specs.ts';

function codeOf(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (isHarnessError(error)) return error.code;
    throw error;
  }
}

describe('checkSpec', () => {
  it('passes a spec of its harness with a credential of its family', () => {
    for (const credential of [
      FAKE_CREDENTIALS.claude_oauth,
      FAKE_CREDENTIALS.claude_setup_token,
      FAKE_CREDENTIALS.anthropic_api_key,
    ]) {
      expect(
        codeOf(() => checkSpec('claude_code', fakeTerminalSpec('claude_code', { credential }))),
      ).toBeUndefined();
    }
    for (const credential of [FAKE_CREDENTIALS.codex_oauth, FAKE_CREDENTIALS.openai_api_key]) {
      expect(codeOf(() => checkSpec('codex', fakeTerminalSpec('codex', { credential })))).toBeUndefined();
    }
  });

  it('refuses a credential of the other family as credential_mismatch', () => {
    const spec = fakeTerminalSpec('claude_code', { credential: FAKE_CREDENTIALS.codex_oauth });
    expect(codeOf(() => checkSpec('claude_code', spec))).toBe('credential_mismatch');
    expect(() => checkSpec('claude_code', spec)).toThrow(
      'A codex_oauth subscription cannot power Claude Code.',
    );
    const codex = fakeTerminalSpec('codex', { credential: FAKE_CREDENTIALS.anthropic_api_key });
    expect(codeOf(() => checkSpec('codex', codex))).toBe('credential_mismatch');
  });

  it('refuses another harness’s spec, an id or model read as an option and a header on two lines', () => {
    expect(() => checkSpec('codex', fakeTerminalSpec('claude_code'))).toThrow(
      'A Claude Code turn cannot run on Codex.',
    );
    const bad = [
      { sessionId: '--dangerously-skip-permissions' },
      { model: '-x' },
      { model: 'opus sonnet' },
      { gateway: { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Key': 'a\nX-Other: b' } } },
      { gateway: { baseUrl: 'http://127.0.0.1:8300', headers: { 'X Key': 'a' } } },
    ];
    for (const overrides of bad) {
      expect(codeOf(() => checkSpec('claude_code', fakeTerminalSpec('claude_code', overrides)))).toBe(
        'invalid_spec',
      );
    }
    const good = fakeTerminalSpec('claude_code', {
      sessionId: '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47',
      model: 'claude-opus-5-5[1m]',
      gateway: { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'k' } },
    });
    expect(codeOf(() => checkSpec('claude_code', good))).toBeUndefined();
  });
});

describe('checkTurn', () => {
  it('adds an empty prompt to the refusals', () => {
    expect(codeOf(() => checkTurn('codex', fakeTurnSpec('codex')))).toBeUndefined();
    expect(codeOf(() => checkTurn('codex', fakeTurnSpec('codex', { prompt: ' \n' })))).toBe('invalid_spec');
    expect(codeOf(() => checkTurn('codex', fakeTurnSpec('claude_code')))).toBe('invalid_spec');
  });

  it('takes a message to resume up to only as one word, with a session forked', () => {
    const fork = { sessionId: 'parent-session', forkSession: true, resumeAt: 'b7e0c2d4-message' };
    expect(codeOf(() => checkTurn('claude_code', fakeTurnSpec('claude_code', fork)))).toBeUndefined();
    expect(
      codeOf(() => checkTurn('claude_code', fakeTurnSpec('claude_code', { ...fork, forkSession: false }))),
    ).toBe('invalid_spec');
    expect(
      codeOf(() => checkTurn('claude_code', fakeTurnSpec('claude_code', { ...fork, sessionId: null }))),
    ).toBe('invalid_spec');
    expect(
      codeOf(() => checkTurn('claude_code', fakeTurnSpec('claude_code', { ...fork, resumeAt: '-p' }))),
    ).toBe('invalid_spec');
  });
});
