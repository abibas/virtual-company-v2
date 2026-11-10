import { accessProfiles } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { GatewayProvider } from '@mwc/shared/credentials';
import type { CredentialKind } from '@mwc/shared/enums';
import { seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialSecrets } from '../../../../src/modules/credentials/index.ts';
import type { AccessProfileView } from '../../../../src/modules/credentials/schemas/profiles.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import { addSubscription, auditRows, noSecret, PROFILES, revokeSubscription } from '../../../fixtures/org.ts';
import { type AuthWorld, addPerson, authWorld, seedApiKey } from '../../../fixtures/platform/auth.ts';

// `/api/me/access-profiles` (S3.4, one provider each since 2026-11-10): a person's own access profiles, each a Claude
// one (a Claude subscription) or an OpenAI one (an OpenAI subscription) with an optional gateway of its provider (since
// migration 0016), its provider fixed; never a revoked subscription and never someone else's; managed signed in only.

const MISSING = '0190f5f0-0000-7000-8000-000000000000';
const keyring = ephemeralKeyring();
let w: AuthWorld;
let ihor: LinkedUser;
let other: LinkedUser;
beforeAll(async () => {
  w = await authWorld({ keyring });
  ihor = await addUser(w.t.db, w.fake);
  other = await addUser(w.t.db, w.fake);
});
afterAll(() => w.t.close());

const as = (user: LinkedUser, requestId?: string) => call(w, user.token, requestId);
const sub = (user: LinkedUser, kind: CredentialKind) => addSubscription(w, keyring, user.userId, kind);
/** A gateway of the person's for Claude Code (`anthropic`) or Codex (`openai`), sealed as the store does. */
const addGateway = (user: LinkedUser, provider: GatewayProvider) =>
  credentialSecrets({ db: w.t.db, keyring, clock: w.clock }).storeCredential({
    kind: 'gateway',
    secret: { headers: { 'x-api-key': 'gw-HEADERvalueNEVERshown' } },
    label: `${provider} gateway`,
    ownerUserId: user.userId,
    accountMeta: { baseUrl: 'http://127.0.0.1:8300', provider },
  });
let names = 0;
const fresh = () => `Profile ${++names}`;

async function create(user: LinkedUser, body: Record<string, unknown>, requestId?: string) {
  const res = await as(user, requestId)('POST', PROFILES, { name: fresh(), provider: 'claude', ...body });
  if (res.status !== 201)
    throw new Error(`POST ${PROFILES} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as AccessProfileView;
}

const listOf = async (user: LinkedUser) =>
  ((await as(user)('GET', PROFILES)).body as { profiles: AccessProfileView[] }).profiles;

const shown = (view: { id: string; kind: string; label: string; status: string }) => ({
  id: view.id,
  kind: view.kind,
  label: view.label,
  accountEmail: null,
  status: view.status,
});

describe('POST /api/me/access-profiles', () => {
  it('makes a Claude profile of a subscription and a gateway, shown as metadata only, and audits it', async () => {
    const [claude, gateway] = [await sub(ihor, 'claude_setup_token'), await sub(ihor, 'gateway')];
    const res = await as(ihor, 'req-profile-1')('POST', PROFILES, {
      name: '  Work ',
      provider: 'claude',
      credentialId: claude.id,
      gatewayCredentialId: gateway.id,
    });
    expect(res.status).toBe(201);
    const view = res.body as AccessProfileView;
    expect(view).toEqual({
      id: view.id,
      name: 'Work',
      provider: 'claude',
      subscription: shown(claude),
      gateway: shown(gateway),
      agents: [],
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    });
    noSecret(view);
    const audit = await auditRows(w.t.db, 'access_profile', view.id);
    expect(audit).toEqual(
      [
        ['credentialId', claude.id],
        ['gatewayCredentialId', gateway.id],
        ['name', 'Work'],
        ['ownerUserId', ihor.userId],
        ['provider', 'claude'],
      ].map(([field, value]) => ({
        companyId: null,
        actorKind: 'user',
        actorPrincipalId: null,
        requestId: 'req-profile-1',
        entityType: 'access_profile',
        entityId: view.id,
        action: 'create',
        field,
        oldValue: null,
        newValue: value,
      })),
    );
  });

  it('makes an OpenAI profile of an OpenAI subscription, with no gateway', async () => {
    const openai = await sub(ihor, 'codex_oauth');
    const view = await create(ihor, {
      provider: 'openai',
      credentialId: openai.id,
      gatewayCredentialId: null,
    });
    expect(view).toMatchObject({ provider: 'openai', subscription: shown(openai), gateway: null });
  });

  it('gives each provider a gateway of its own: Anthropic for Claude, OpenAI for Codex, never the other (422)', async () => {
    const anthropic = await addGateway(ihor, 'anthropic');
    const openai = await addGateway(ihor, 'openai');
    const codex = await create(ihor, { provider: 'openai', gatewayCredentialId: openai.id });
    expect(codex).toMatchObject({ provider: 'openai', gateway: shown(openai) });
    const claude = await create(ihor, { gatewayCredentialId: anthropic.id });
    expect(claude).toMatchObject({ provider: 'claude', gateway: shown(anthropic) });
    const refused = await as(ihor)('POST', PROFILES, {
      name: fresh(),
      provider: 'claude',
      gatewayCredentialId: openai.id,
    });
    expect(refused).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'gateway_provider_mismatch',
          message: 'A Claude profile takes a gateway for Claude Code, not one for Codex',
        },
      },
    });
    const swapped = await as(ihor)('PATCH', `${PROFILES}/${codex.id}`, { gatewayCredentialId: anthropic.id });
    expect(swapped).toMatchObject({ status: 422, body: { error: { code: 'gateway_provider_mismatch' } } });
    const emptied = await as(ihor)('PATCH', `${PROFILES}/${codex.id}`, { gatewayCredentialId: null });
    expect(emptied).toMatchObject({ status: 200, body: { gateway: null } });
  });

  it('takes every kind of its provider, and none', async () => {
    for (const kind of ['claude_oauth', 'claude_setup_token', 'anthropic_api_key'] as const) {
      const view = await create(ihor, { credentialId: (await sub(ihor, kind)).id });
      expect([view.provider, view.subscription?.kind]).toEqual(['claude', kind]);
    }
    for (const kind of ['codex_oauth', 'openai_api_key'] as const) {
      const view = await create(ihor, { provider: 'openai', credentialId: (await sub(ihor, kind)).id });
      expect([view.provider, view.subscription?.kind]).toEqual(['openai', kind]);
    }
    const empty = await create(ihor, { credentialId: null });
    expect(empty).toMatchObject({ provider: 'claude', subscription: null, gateway: null });
  });

  it.each([
    ['claude', 'credentialId', 'openai_api_key', 'provider_mismatch'],
    ['claude', 'credentialId', 'codex_oauth', 'provider_mismatch'],
    ['claude', 'credentialId', 'gateway', 'provider_mismatch'],
    ['openai', 'credentialId', 'claude_oauth', 'provider_mismatch'],
    ['openai', 'credentialId', 'anthropic_api_key', 'provider_mismatch'],
    ['claude', 'gatewayCredentialId', 'claude_setup_token', 'credential_kind_mismatch'],
    ['openai', 'gatewayCredentialId', 'gateway', 'gateway_provider_mismatch'],
  ] as const)('refuses a %s profile a %s of kind %s (422 %s)', async (provider, field, kind, code) => {
    const body = { name: fresh(), provider, [field]: (await sub(ihor, kind)).id };
    expect(await as(ihor)('POST', PROFILES, body)).toMatchObject({ status: 422, body: { error: { code } } });
  });

  it('refuses a revoked subscription, someone else’s, an unknown or malformed id, writing nothing', async () => {
    const before = (await listOf(ihor)).length;
    const revoked = await sub(ihor, 'claude_setup_token');
    await revokeSubscription(w.t.db, revoked.id);
    const theirs = await sub(other, 'claude_setup_token');
    for (const [id, code] of [
      [revoked.id, 'credential_revoked'],
      [theirs.id, 'credential_not_found'],
      [MISSING, 'credential_not_found'],
      ['not-an-id', 'credential_not_found'],
    ]) {
      const res = await as(ihor)('POST', PROFILES, { name: fresh(), provider: 'claude', credentialId: id });
      expect(res).toMatchObject({ status: 422, body: { error: { code } } });
    }
    expect(await listOf(ihor)).toHaveLength(before);
  });

  it('keeps names unique per person (409), whatever the provider, while another person may take the same one', async () => {
    await create(ihor, { name: 'Shared name' });
    const res = await as(ihor)('POST', PROFILES, { name: 'Shared name', provider: 'openai' });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'access_profile_name_taken' } } });
    expect((await create(other, { name: 'Shared name' })).name).toBe('Shared name');
  });

  it.each([
    ['no name', { provider: 'claude' }],
    ['an empty name', { name: '   ', provider: 'claude' }],
    ['a name over 80 characters', { name: 'x'.repeat(81), provider: 'claude' }],
    ['no provider', { name: 'Ok' }],
    ['another provider', { name: 'Ok', provider: 'gemini' }],
    ['a subscription that is not a string', { name: 'Ok', provider: 'claude', credentialId: 7 }],
  ])('refuses %s (400)', async (_, body) => {
    expect(await as(ihor)('POST', PROFILES, body)).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_request' } },
    });
  });
});

describe('GET /api/me/access-profiles', () => {
  it('lists only the caller’s own profiles, of both providers, oldest first', async () => {
    const solo = await addUser(w.t.db, w.fake);
    const first = await create(solo, { name: 'First' });
    const second = await create(solo, { name: 'Second', provider: 'openai' });
    await create(other, {});
    expect((await listOf(solo)).map((profile) => [profile.id, profile.provider])).toEqual([
      [first.id, 'claude'],
      [second.id, 'openai'],
    ]);
    expect((await listOf(other)).map((profile) => profile.id)).not.toContain(first.id);
  });

  it('shows a profile emptied when its subscription is removed', async () => {
    const claude = await sub(ihor, 'anthropic_api_key');
    const profile = await create(ihor, { credentialId: claude.id });
    expect((await as(ihor)('DELETE', `/api/me/subscriptions/${claude.id}`)).status).toBe(204);
    const [row] = await rawDb(w.t.db).select().from(accessProfiles).where(eq(accessProfiles.id, profile.id));
    expect(row?.credentialId).toBeNull();
    expect((await listOf(ihor)).find((listed) => listed.id === profile.id)?.subscription).toBeNull();
  });
});

describe('PATCH /api/me/access-profiles/:profileId', () => {
  it('renames it and changes its subscription, writing only what differs, with audit rows', async () => {
    const first = await sub(ihor, 'claude_oauth');
    const second = await sub(ihor, 'claude_setup_token');
    const profile = await create(ihor, { name: 'Before', credentialId: first.id });
    const path = `${PROFILES}/${profile.id}`;
    const res = await as(ihor, 'req-profile-2')('PATCH', path, { name: 'After', credentialId: second.id });
    expect(res).toMatchObject({
      status: 200,
      body: { id: profile.id, name: 'After', provider: 'claude', subscription: { id: second.id } },
    });
    const same = await as(ihor, 'req-profile-3')('PATCH', path, {
      name: 'After',
      provider: 'claude',
      credentialId: second.id,
    });
    expect(same.status).toBe(200);
    const updates = (await auditRows(w.t.db, 'access_profile', profile.id)).filter(
      (row) => row.action === 'update',
    );
    expect(updates.map((row) => [row.requestId, row.field, row.oldValue, row.newValue])).toEqual([
      ['req-profile-2', 'credentialId', first.id, second.id],
      ['req-profile-2', 'name', 'Before', 'After'],
    ]);
  });

  it('keeps its provider: another one, or a subscription of another, is a 422 provider_mismatch', async () => {
    const openai = await sub(ihor, 'openai_api_key');
    const claude = await create(ihor, {});
    const codex = await create(ihor, { provider: 'openai', credentialId: openai.id });
    const turned = await as(ihor)('PATCH', `${PROFILES}/${claude.id}`, { provider: 'openai' });
    expect(turned).toMatchObject({
      status: 422,
      body: {
        error: { code: 'provider_mismatch', message: expect.stringContaining('This is a Claude profile') },
      },
    });
    const wrongKind = await as(ihor)('PATCH', `${PROFILES}/${claude.id}`, { credentialId: openai.id });
    expect(wrongKind).toMatchObject({ status: 422, body: { error: { code: 'provider_mismatch' } } });
    const gateway = await sub(ihor, 'gateway');
    const claudeGateway = await as(ihor)('PATCH', `${PROFILES}/${codex.id}`, {
      gatewayCredentialId: gateway.id,
    });
    expect(claudeGateway).toMatchObject({
      status: 422,
      body: { error: { code: 'gateway_provider_mismatch' } },
    });
    expect(await listOf(ihor)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: claude.id, provider: 'claude', subscription: null }),
        expect.objectContaining({ id: codex.id, provider: 'openai', gateway: null }),
      ]),
    );
  });

  it('empties a credential with null, keeps a revoked subscription in place, but refuses putting one in', async () => {
    const gateway = await sub(ihor, 'gateway');
    const claude = await sub(ihor, 'claude_setup_token');
    const profile = await create(ihor, { gatewayCredentialId: gateway.id, credentialId: claude.id });
    await revokeSubscription(w.t.db, claude.id);
    const path = `${PROFILES}/${profile.id}`;
    const kept = await as(ihor)('PATCH', path, { credentialId: claude.id, gatewayCredentialId: null });
    expect(kept).toMatchObject({
      status: 200,
      body: { subscription: { id: claude.id, status: 'revoked' }, gateway: null },
    });
    const emptied = await as(ihor)('PATCH', path, { credentialId: null });
    expect(emptied).toMatchObject({ status: 200, body: { subscription: null } });
    const back = await as(ihor)('PATCH', path, { credentialId: claude.id });
    expect(back).toMatchObject({ status: 422, body: { error: { code: 'credential_revoked' } } });
  });

  it('answers 404 for another person’s profile or none, 409 for a taken name, 400 for no field', async () => {
    const theirs = await create(other, {});
    const mine = await create(ihor, { name: 'Taken here' });
    const other2 = await create(ihor, {});
    for (const id of [theirs.id, MISSING, 'not-an-id']) {
      const res = await as(ihor)('PATCH', `${PROFILES}/${id}`, { name: 'Mine now' });
      expect(res).toMatchObject({ status: 404, body: { error: { code: 'access_profile_not_found' } } });
    }
    const taken = await as(ihor)('PATCH', `${PROFILES}/${other2.id}`, { name: mine.name });
    expect(taken).toMatchObject({ status: 409, body: { error: { code: 'access_profile_name_taken' } } });
    expect((await as(ihor)('PATCH', `${PROFILES}/${mine.id}`, {})).status).toBe(400);
    const wrong = await as(ihor)('PATCH', `${PROFILES}/${mine.id}`, { credentialId: MISSING });
    expect(wrong).toMatchObject({ status: 422, body: { error: { code: 'credential_not_found' } } });
  });
});

describe('DELETE /api/me/access-profiles/:profileId', () => {
  it('removes the caller’s profile with its audit rows; another person’s is a 404', async () => {
    const theirs = await create(other, {});
    expect(await as(ihor)('DELETE', `${PROFILES}/${theirs.id}`)).toMatchObject({ status: 404 });
    const loner = await addUser(w.t.db, w.fake);
    const mine = await create(loner, { name: 'Gone' });
    expect((await as(loner, 'req-profile-4')('DELETE', `${PROFILES}/${mine.id}`)).status).toBe(204);
    expect(await listOf(loner)).toEqual([]);
    const deleted = (await auditRows(w.t.db, 'access_profile', mine.id)).filter(
      (row) => row.action === 'delete',
    );
    expect(
      deleted.map((row) => [row.companyId, row.requestId, row.field, row.oldValue, row.newValue]),
    ).toEqual([
      [null, 'req-profile-4', 'name', 'Gone', null],
      [null, 'req-profile-4', 'ownerUserId', loner.userId, null],
      [null, 'req-profile-4', 'provider', 'claude', null],
    ]);
    expect((await as(loner)('DELETE', `${PROFILES}/${mine.id}`)).status).toBe(404);
  });
});

describe('who may manage access profiles', () => {
  it('refuses an API key on every route with 403 session_required, even the owner’s own', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const mine = await call(w, `fake:${person.subject}`)('POST', PROFILES, {
      name: 'Keyed',
      provider: 'claude',
    });
    const id = (mine.body as AccessProfileView).id;
    for (const [method, path, body] of [
      ['GET', PROFILES, undefined],
      ['POST', PROFILES, { name: 'Other', provider: 'openai' }],
      ['PATCH', `${PROFILES}/${id}`, { name: 'x' }],
      ['DELETE', `${PROFILES}/${id}`, undefined],
    ] as const) {
      expect(await call(w, key)(method, path, body)).toMatchObject({
        status: 403,
        body: { error: { code: 'session_required' } },
      });
    }
    expect(await call(w, undefined)('GET', PROFILES)).toMatchObject({ status: 401 });
  });
});
