import { describe, expect, it } from 'vitest';
import {
  claudeLogin,
  codexLogin,
  defaultLabel,
  jwtClaims,
} from '../../../../src/modules/credentials/rules/login-files.ts';
import {
  CLAUDE_ACCOUNT,
  CLAUDE_CONFIG,
  CLAUDE_CREDENTIALS,
  CODEX_AUTH,
  fakeJwt,
} from '../../../fixtures/credentials/sign-in/cli.ts';

const json = (value: unknown) => JSON.stringify(value);

describe('claudeLogin', () => {
  it('keeps the token set and the account, names it by the email, with the plan details', () => {
    expect(claudeLogin({ credentials: json(CLAUDE_CREDENTIALS), config: json(CLAUDE_CONFIG) })).toEqual({
      ok: true,
      result: {
        kind: 'claude_oauth',
        secret: { credentials: CLAUDE_CREDENTIALS, account: CLAUDE_ACCOUNT },
        accountEmail: 'ihor@example.test',
        accountMeta: {
          organizationName: "Ihor's Organization",
          subscriptionType: 'max',
          rateLimitTier: 'default_claude_max_20x',
          scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'],
        },
        label: 'Claude · ihor@example.test',
      },
    });
  });

  it('works without the account config, keeping only the details it has', () => {
    const bare = { claudeAiOauth: { accessToken: 'sk-ant-oat01-x', subscriptionType: null } };
    for (const config of [undefined, 'not json', json({ oauthAccount: 'odd' }), json({})]) {
      expect(claudeLogin({ credentials: json(bare), config })).toEqual({
        ok: true,
        result: {
          kind: 'claude_oauth',
          secret: { credentials: bare, account: null },
          accountEmail: null,
          accountMeta: {},
          label: 'Claude',
        },
      });
    }
  });

  it('fails in plain words for no file, a file that is not JSON, another shape or no access token', () => {
    for (const credentials of [
      undefined,
      '{"claudeAiOauth": {"accessToken": "sk-ant-oat01-SECRET", ',
      json({ claudeAiOauth: 'odd' }),
      json({ claudeAiOauth: { refreshToken: 'only' } }),
      json({}),
    ]) {
      const outcome = claudeLogin({ credentials, config: json(CLAUDE_CONFIG) });
      expect(outcome).toEqual({ ok: false, message: 'Claude finished without saving a login. Start again.' });
    }
  });
});

describe('codexLogin', () => {
  it("keeps auth.json, named by the id_token's email, with the ChatGPT plan", () => {
    expect(codexLogin({ auth: json(CODEX_AUTH) })).toEqual({
      ok: true,
      result: {
        kind: 'codex_oauth',
        secret: { auth: CODEX_AUTH },
        accountEmail: 'ihor@example.test',
        accountMeta: { planType: 'pro' },
        label: 'OpenAI · ihor@example.test',
      },
    });
  });

  it('works with an id_token that says less, or none', () => {
    const tokens = (id_token?: string) => ({
      tokens: { access_token: 'at', ...(id_token ? { id_token } : {}) },
    });
    for (const id of [
      undefined,
      'not-a-jwt',
      fakeJwt({ email: 7 }),
      `x.${Buffer.from('[1]').toString('base64url')}.y`,
    ]) {
      const outcome = codexLogin({ auth: json(tokens(id)) });
      expect(outcome).toMatchObject({
        ok: true,
        result: { accountEmail: null, accountMeta: {}, label: 'OpenAI' },
      });
    }
  });

  it('fails in plain words without an access token', () => {
    for (const auth of [
      undefined,
      '{',
      json({ tokens: { refresh_token: 'r' } }),
      json({ OPENAI_API_KEY: null }),
    ]) {
      expect(codexLogin({ auth })).toEqual({
        ok: false,
        message: 'Codex finished without saving a login. Start again.',
      });
    }
  });
});

describe('jwtClaims', () => {
  it('decodes the claims for display, and nothing for something that is not a JWT', () => {
    expect(jwtClaims(fakeJwt({ email: 'a@b.test' }))).toEqual({ email: 'a@b.test' });
    expect(jwtClaims(undefined)).toBeUndefined();
    expect(jwtClaims('one-part')).toBeUndefined();
    expect(jwtClaims(`a.${Buffer.from('"text"').toString('base64url')}.c`)).toBeUndefined();
  });
});

describe('defaultLabel', () => {
  it('fits the 80 characters of a name', () => {
    expect(defaultLabel('Claude', 'ihor@example.test')).toBe('Claude · ihor@example.test');
    const long = defaultLabel('Claude', `${'x'.repeat(90)}@example.test`);
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
});
