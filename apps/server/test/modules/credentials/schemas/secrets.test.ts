import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseSecret, SECRET_SCHEMAS } from '../../../../src/modules/credentials/schemas/secrets.ts';

describe('the secret shapes', () => {
  it('has one shape per kind', () => {
    expect(Object.keys(SECRET_SCHEMAS).sort()).toEqual([
      'anthropic_api_key',
      'atlassian_api_token',
      'claude_oauth',
      'claude_setup_token',
      'codex_oauth',
      'gateway',
      'github_oauth',
      'github_token',
      'openai_api_key',
    ]);
  });

  it('takes the pasted secrets in their formats, trimmed, and drops anything else', () => {
    expect(parseSecret('claude_setup_token', { token: ' sk-ant-oat01-abc\n', extra: 1 })).toEqual({
      token: 'sk-ant-oat01-abc',
    });
    expect(parseSecret('anthropic_api_key', { apiKey: 'sk-ant-api03-abc' })).toEqual({
      apiKey: 'sk-ant-api03-abc',
    });
    expect(parseSecret('openai_api_key', { apiKey: 'sk-proj-abc' })).toEqual({ apiKey: 'sk-proj-abc' });
    expect(parseSecret('gateway', { headers: { 'x-api-key': 'k', Authorization: 'Bearer t' } })).toEqual({
      headers: { 'x-api-key': 'k', Authorization: 'Bearer t' },
    });
  });

  it('refuses a pasted secret of another shape, naming the field and never the value', () => {
    const cases: [Parameters<typeof parseSecret>[0], unknown][] = [
      ['claude_setup_token', { token: 'sk-ant-api03-wrong-kind' }],
      ['claude_setup_token', { token: 'sk-ant-oat01-has space' }],
      ['claude_setup_token', { token: `sk-ant-oat01-${'x'.repeat(4096)}` }],
      ['anthropic_api_key', { apiKey: 'sk-proj-wrong-kind' }],
      ['openai_api_key', { apiKey: '' }],
      ['gateway', { headers: { 'x-api-key': '' } }],
      ['gateway', { headers: { ['x'.repeat(101)]: 'v' } }],
    ];
    for (const [kind, value] of cases) {
      try {
        parseSecret(kind, value);
        expect.unreachable(`${kind} accepted`);
      } catch (error) {
        expect(error).toBeInstanceOf(ZodError);
        expect((error as Error).message).not.toContain('wrong-kind');
      }
    }
  });

  it('keeps everything a login writes, typing the fields known today', () => {
    const claude = {
      credentials: {
        claudeAiOauth: { accessToken: 'a', subscriptionType: 'max', future: [1] },
        mcpOAuth: {},
      },
      account: null,
      helperVersion: '2.1',
    };
    expect(parseSecret('claude_oauth', claude)).toEqual(claude);
    const codex = { auth: { tokens: { access_token: 'a', account_id: 'acc' }, other: true } };
    expect(parseSecret('codex_oauth', codex)).toEqual(codex);
    expect(() =>
      parseSecret('claude_oauth', { credentials: { claudeAiOauth: { accessToken: 1 } }, account: null }),
    ).toThrow(ZodError);
    expect(() => parseSecret('codex_oauth', {})).toThrow(ZodError);
  });
});
