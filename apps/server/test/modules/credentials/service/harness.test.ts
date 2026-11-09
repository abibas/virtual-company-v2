import { credentials } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { CredentialKind } from '@mwc/shared/enums';
import { newId } from '@mwc/shared/ids';
import { captureLogger, LEVEL, TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  credentialSecrets,
  credentialsForHarness,
  type HarnessUse,
} from '../../../../src/modules/credentials/index.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { addUser, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import { FakeProvider, json, jwt, URLS } from '../../../fixtures/credentials/providers.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

const keyring = ephemeralKeyring();
const provider = new FakeProvider();
const { logger, lines } = captureLogger();
let w: AuthWorld;
let ihor: LinkedUser;
let harness: ReturnType<typeof credentialsForHarness>;
let store: ReturnType<typeof credentialSecrets>;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  const deps = { db: w.t.db, keyring, clock: w.clock, logger, providerFetch: provider.fetch };
  harness = credentialsForHarness(deps);
  store = credentialSecrets(deps);
});
afterEach(() => {
  provider.reset();
  lines.length = 0;
});
afterAll(() => w.t.close());

const NOW = new Date(TEST_NOW).getTime();
const USE: HarnessUse = {
  purpose: 'chat_turn',
  companyId: newId(),
  agentId: newId(),
  chatId: newId(),
  principalId: newId(),
};

const add = (kind: CredentialKind, secret: unknown, accountMeta: Record<string, unknown> = {}) =>
  store.storeCredential({ kind, secret, label: kind, ownerUserId: ihor.userId, accountMeta } as never);

const claudeLogin = (accessToken: string | undefined, expiresAt: number, refreshToken = 'refresh-1') => ({
  credentials: { claudeAiOauth: { accessToken, refreshToken, expiresAt } },
  account: null,
});

describe('the credential of a turn', () => {
  it("hands out a Claude login's token as it is while it has over an hour left", async () => {
    const login = await add('claude_oauth', claudeLogin('still-good', NOW + 2 * 3600_000));
    expect(await harness.credential(login.id, ihor.userId, USE)).toEqual({
      ok: true,
      credential: { kind: 'claude_oauth', token: 'still-good' },
    });
    expect(provider.calls).toEqual([]);
  });

  it('marks a login whose refresh is refused as needing a sign-in', async () => {
    const login = await add('claude_oauth', claudeLogin('old', NOW + 10 * 60_000));
    provider.once(URLS.claudeToken, json(400, { error: 'invalid_grant' }));
    expect(await harness.credential(login.id, ihor.userId, USE)).toMatchObject({
      ok: false,
      status: 422,
      code: 'credential_needs_sign_in',
    });
    const [row] = await rawDb(w.t.db).select().from(credentials).where(eq(credentials.id, login.id));
    expect(row?.status).toBe('needs_sign_in');
    expect(lines.find((line) => line.code === 'needs_sign_in')?.level).toBe(LEVEL.warn);
    expect(JSON.stringify(lines)).not.toContain('old');
  });

  it('keeps a token that still works when the provider does not answer, and refuses an expired one', async () => {
    const soon = await add('claude_oauth', claudeLogin('soon', NOW + 10 * 60_000));
    provider.always(URLS.claudeToken, json(503, {}));
    expect(await harness.credential(soon.id, ihor.userId, USE)).toMatchObject({
      ok: true,
      credential: { token: 'soon' },
    });
    const expired = await add('claude_oauth', claudeLogin('gone', NOW - 60_000));
    expect(await harness.credential(expired.id, ihor.userId, USE)).toMatchObject({
      ok: false,
      status: 503,
      code: 'provider_unavailable',
    });
  });

  it('refuses a login without an access token, and a gateway as a harness credential', async () => {
    const empty = await add('claude_oauth', { credentials: {}, account: null });
    expect(await harness.credential(empty.id, ihor.userId, USE)).toMatchObject({
      code: 'credential_needs_sign_in',
    });
    const codex = await add('codex_oauth', { auth: { tokens: {} } });
    expect(await harness.credential(codex.id, ihor.userId, USE)).toMatchObject({
      code: 'credential_needs_sign_in',
    });
    const gateway = await add('gateway', { headers: { 'x-api-key': 'k' } }, { baseUrl: 'https://gw.test' });
    expect(await harness.credential(gateway.id, ihor.userId, USE)).toMatchObject({
      code: 'credential_unusable',
    });
    expect(await harness.credential(newId(), ihor.userId, USE)).toMatchObject({
      code: 'credential_not_found',
    });
  });

  it("refreshes a Codex login near its token's end, and hands out its auth.json as text", async () => {
    const access = jwt(Math.floor(NOW / 1000) + 60);
    const login = await add('codex_oauth', {
      auth: { tokens: { access_token: access, refresh_token: 'r1' } },
    });
    provider.once(URLS.codexToken, json(200, { access_token: 'codex-new', refresh_token: 'r2' }));
    const opened = await harness.credential(login.id, ihor.userId, USE);
    expect(
      opened.ok && opened.credential.kind === 'codex_oauth' && JSON.parse(opened.credential.authJson),
    ).toMatchObject({ tokens: { access_token: 'codex-new', refresh_token: 'r2' } });
  });

  it('maps API keys and a setup-token as they are', async () => {
    const cases = [
      [
        'anthropic_api_key',
        { apiKey: 'sk-ant-api03-key' },
        { kind: 'anthropic_api_key', key: 'sk-ant-api03-key' },
      ],
      ['openai_api_key', { apiKey: 'sk-proj-key' }, { kind: 'openai_api_key', key: 'sk-proj-key' }],
      [
        'claude_setup_token',
        { token: 'sk-ant-oat01-setup' },
        { kind: 'claude_setup_token', token: 'sk-ant-oat01-setup' },
      ],
    ] as const;
    for (const [kind, secret, credential] of cases) {
      const row = await add(kind, secret);
      expect(await harness.credential(row.id, ihor.userId, USE)).toEqual({ ok: true, credential });
    }
  });
});

describe('the gateway of a turn', () => {
  it('hands out its address and headers, and refuses another kind or one without an address', async () => {
    const gateway = await add(
      'gateway',
      { headers: { 'x-api-key': 'gw-key' } },
      { baseUrl: 'https://gw.test/v1' },
    );
    expect(await harness.gateway(gateway.id, ihor.userId, USE)).toEqual({
      ok: true,
      gateway: { baseUrl: 'https://gw.test/v1', headers: { 'x-api-key': 'gw-key' } },
    });
    const noAddress = await add('gateway', { headers: { 'x-api-key': 'gw-key' } });
    expect(await harness.gateway(noAddress.id, ihor.userId, USE)).toMatchObject({
      code: 'credential_unusable',
    });
    const key = await add('anthropic_api_key', { apiKey: 'sk-ant-api03-key' });
    expect(await harness.gateway(key.id, ihor.userId, USE)).toMatchObject({ code: 'credential_unusable' });
    expect(await harness.gateway(newId(), ihor.userId, USE)).toMatchObject({ code: 'credential_not_found' });
  });
});

describe('rewriteCodexLogin', () => {
  it('seals a rewritten login, and refuses one that is not a login or a credential that is gone', async () => {
    const login = await add('codex_oauth', { auth: { tokens: { access_token: 'a' } } });
    const rewritten = JSON.stringify({ tokens: { access_token: 'b' } });
    expect(await harness.rewriteCodexLogin(login.id, ihor.userId, rewritten, 'chat_turn')).toBe(true);
    const opened = await store.useCredentialSecret(login.id, ihor.userId, 'test');
    expect(opened).toMatchObject({ ok: true, secret: { auth: { tokens: { access_token: 'b' } } } });
    expect(await harness.rewriteCodexLogin(login.id, ihor.userId, 'not json', 'chat_turn')).toBe(false);
    expect(await harness.rewriteCodexLogin(newId(), ihor.userId, rewritten, 'chat_turn')).toBe(false);
    expect(lines.filter((line) => line.level === LEVEL.warn)).toHaveLength(2);
    expect(JSON.stringify(lines)).not.toContain('access_token');
  });
});
