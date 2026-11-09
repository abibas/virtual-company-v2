import type { Harness } from '@mwc/shared/enums';
import type { HarnessCredential, HarnessCredentialKind, TerminalSpec, TurnSpec } from '@mwc/shared/harness';

/** Specs for tests: one fake credential of each kind, and a turn or terminal spec with overrides. */

/** A credential of each kind, with fake secrets in their real shapes. */
export const FAKE_CREDENTIALS = {
  claude_oauth: { kind: 'claude_oauth', token: 'fake-claude-access-token' },
  claude_setup_token: { kind: 'claude_setup_token', token: 'sk-ant-oat01-fake-setup-token' },
  anthropic_api_key: { kind: 'anthropic_api_key', key: 'sk-ant-api03-fake-key' },
  codex_oauth: {
    kind: 'codex_oauth',
    authJson: JSON.stringify({ OPENAI_API_KEY: null, tokens: { access_token: 'fake-codex-access-token' } }),
  },
  openai_api_key: { kind: 'openai_api_key', key: 'sk-fake-openai-key' },
} as const satisfies { [K in HarnessCredentialKind]: Extract<HarnessCredential, { kind: K }> };

/** Each harness's usual credential in a fake spec. */
const DEFAULT_CREDENTIAL: Readonly<Record<Harness, HarnessCredential>> = {
  claude_code: FAKE_CREDENTIALS.claude_setup_token,
  codex: FAKE_CREDENTIALS.codex_oauth,
};

/** A new terminal of `harness` in `/home/agent/work`: no session, model, effort, config folder or gateway; `ask`. */
export function fakeTerminalSpec(harness: Harness, overrides: Partial<TerminalSpec> = {}): TerminalSpec {
  return {
    harness,
    cwd: '/home/agent/work',
    sessionId: null,
    model: null,
    permissionPolicy: 'ask',
    configDir: null,
    credential: DEFAULT_CREDENTIAL[harness],
    gateway: null,
    ...overrides,
  };
}

/** A new turn of `harness` saying "What is 2 + 2?", as `fakeTerminalSpec`. */
export function fakeTurnSpec(harness: Harness, overrides: Partial<TurnSpec> = {}): TurnSpec {
  return { ...fakeTerminalSpec(harness), prompt: 'What is 2 + 2?', ...overrides };
}
