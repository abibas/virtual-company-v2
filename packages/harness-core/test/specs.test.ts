import { HarnessCredential, TerminalSpec, TurnSpec } from '@mwc/shared/harness';
import { describe, expect, it } from 'vitest';
import { FAKE_CREDENTIALS, fakeTerminalSpec, fakeTurnSpec } from '../src/specs.ts';

describe('the fake specs', () => {
  it('are valid on the wire, one credential of each kind', () => {
    for (const credential of Object.values(FAKE_CREDENTIALS)) {
      expect(HarnessCredential.parse(credential)).toEqual(credential);
    }
    expect(TurnSpec.parse(fakeTurnSpec('claude_code'))).toMatchObject({
      harness: 'claude_code',
      credential: FAKE_CREDENTIALS.claude_setup_token,
      prompt: 'What is 2 + 2?',
    });
    expect(TerminalSpec.parse(fakeTerminalSpec('codex')).credential).toEqual(FAKE_CREDENTIALS.codex_oauth);
  });

  it('take overrides', () => {
    expect(fakeTurnSpec('codex', { prompt: 'Hi', model: 'gpt-5.6-codex' })).toMatchObject({
      prompt: 'Hi',
      model: 'gpt-5.6-codex',
      sessionId: null,
    });
    expect(fakeTerminalSpec('claude_code', { permissionPolicy: 'bypass' }).permissionPolicy).toBe('bypass');
  });
});
