import { isHarnessError } from '@mwc/harness-core';
import { FAKE_CREDENTIALS, fakeTerminalSpec } from '@mwc/harness-core/fake';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_ACCOUNT_VARS,
  claudeEnv,
  credentialEnv,
  customHeaders,
  sharedArgs,
  unsetFor,
} from '../src/args.ts';

const SESSION = '7f3c9a2e-4b1d-4e8a-9c6f-2d5e8b1a3c47';
const GATEWAY = { baseUrl: 'http://127.0.0.1:8300', headers: { 'X-Api-Key': 'gw-key', 'X-Team': 'core' } };

describe('sharedArgs', () => {
  it('is empty for a new conversation on the defaults that asks', () => {
    expect(sharedArgs(fakeTerminalSpec('claude_code'))).toEqual([]);
  });

  it('adds the resume, the model, the effort and the skip flag, in that order', () => {
    const spec = fakeTerminalSpec('claude_code', {
      sessionId: SESSION,
      model: 'opus',
      effort: 'xhigh',
      permissionPolicy: 'bypass',
    });
    expect(sharedArgs(spec)).toEqual([
      '--resume',
      SESSION,
      '--model',
      'opus',
      '--effort',
      'xhigh',
      '--dangerously-skip-permissions',
    ]);
    expect(sharedArgs(fakeTerminalSpec('claude_code', { model: 'sonnet' }))).toEqual(['--model', 'sonnet']);
    expect(sharedArgs(fakeTerminalSpec('claude_code', { effort: 'low' }))).toEqual(['--effort', 'low']);
  });
});

describe('credentialEnv', () => {
  it('puts a login or a setup-token in CLAUDE_CODE_OAUTH_TOKEN and an API key in ANTHROPIC_API_KEY', () => {
    expect(credentialEnv(FAKE_CREDENTIALS.claude_oauth)).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'fake-claude-access-token',
    });
    expect(credentialEnv(FAKE_CREDENTIALS.claude_setup_token)).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token',
    });
    expect(credentialEnv(FAKE_CREDENTIALS.anthropic_api_key)).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake-key',
    });
  });

  it('refuses an OpenAI credential as credential_mismatch', () => {
    for (const credential of [FAKE_CREDENTIALS.codex_oauth, FAKE_CREDENTIALS.openai_api_key]) {
      expect(() => credentialEnv(credential)).toThrow(
        `A ${credential.kind} subscription cannot power Claude Code.`,
      );
      try {
        credentialEnv(credential);
      } catch (error) {
        expect(isHarnessError(error, 'credential_mismatch')).toBe(true);
      }
    }
  });
});

describe('claudeEnv', () => {
  it('is only the credential on the defaults', () => {
    expect(claudeEnv(fakeTerminalSpec('claude_code'))).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token',
    });
  });

  it('adds the config folder and the gateway with its headers one per line', () => {
    const spec = fakeTerminalSpec('claude_code', {
      credential: FAKE_CREDENTIALS.anthropic_api_key,
      configDir: '/home/agent/.claude-slop',
      gateway: GATEWAY,
    });
    expect(claudeEnv(spec)).toEqual({
      ANTHROPIC_API_KEY: 'sk-ant-api03-fake-key',
      CLAUDE_CONFIG_DIR: '/home/agent/.claude-slop',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8300',
      ANTHROPIC_CUSTOM_HEADERS: 'X-Api-Key: gw-key\nX-Team: core',
    });
  });

  it('sends no custom headers for a gateway without any', () => {
    const spec = fakeTerminalSpec('claude_code', {
      gateway: { baseUrl: 'https://gw.example.com', headers: {} },
    });
    expect(claudeEnv(spec)).toEqual({
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-fake-setup-token',
      ANTHROPIC_BASE_URL: 'https://gw.example.com',
    });
    expect(customHeaders({})).toBe('');
    expect(customHeaders({ A: '1' })).toBe('A: 1');
  });
});

describe('unsetFor', () => {
  it('removes every account variable the turn does not set', () => {
    expect(unsetFor({})).toEqual([...CLAUDE_ACCOUNT_VARS]);
    expect(unsetFor({ CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: '/c' })).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_CUSTOM_HEADERS',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]);
  });
});
