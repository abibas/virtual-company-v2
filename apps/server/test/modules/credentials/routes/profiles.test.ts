import { accessProfiles } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
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

// `/api/me/access-profiles` (S3.4; generic since 2026-11-13): a person's own profiles, each a name and optional parts;
// here the profile itself and its AI parts (a Claude or an OpenAI subscription, any of the person's gateways), never a
// revoked credential and never someone else's; managed signed in only. Models and efforts are `profiles/model.test.ts`'s,
// tool parts and removing a part agents run on `profiles/parts.test.ts`'s.

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
/** A gateway of the person's (an older one may still say a provider, which is ignored), sealed as the store does. */
const addGateway = (user: LinkedUser, accountMeta: Record<string, unknown> = {}) =>
  credentialSecrets({ db: w.t.db, keyring, clock: w.clock }).storeCredential({
    kind: 'gateway',
    secret: { headers: { 'x-api-key': 'gw-HEADERvalueNEVERshown' } },
    label: 'Memory gateway',
    ownerUserId: user.userId,
    accountMeta: { baseUrl: 'http://127.0.0.1:8300', ...accountMeta },
  });
let names = 0;
const fresh = () => `Profile ${++names}`;

async function create(user: LinkedUser, body: Record<string, unknown>, requestId?: string) {
  const res = await as(user, requestId)('POST', PROFILES, { name: fresh(), ...body });
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
  account: null,
  site: null,
});

const NO_PARTS = { claude: null, openai: null, github: null, atlassian: null };

describe('POST /api/me/access-profiles', () => {
  it('makes a profile of a name alone, with no parts', async () => {
    const view = await create(ihor, { name: '  Empty ' });
    expect(view).toEqual({
      id: view.id,
      name: 'Empty',
      parts: NO_PARTS,
      agents: [],
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    });
  });

  it('makes a Claude part of a subscription, a gateway, a model and an effort, shown as metadata only, and audits it', async () => {
    const [claude, gateway] = [await sub(ihor, 'claude_setup_token'), await sub(ihor, 'gateway')];
    const res = await as(ihor, 'req-profile-1')('POST', PROFILES, {
      name: 'Work',
      parts: {
        claude: {
          credentialId: claude.id,
          gatewayCredentialId: gateway.id,
          model: ' claude-opus-5-5 ',
          effort: 'xhigh',
        },
      },
    });
    expect(res.status).toBe(201);
    const view = res.body as AccessProfileView;
    expect(view.parts).toEqual({
      ...NO_PARTS,
      claude: {
        subscription: shown(claude),
        gateway: shown(gateway),
        model: 'claude-opus-5-5',
        effort: 'xhigh',
      },
    });
    noSecret(view);
    const audit = (await auditRows(w.t.db, 'access_profile', view.id)).map((row) => [
      row.field,
      row.newValue,
      row.action,
      row.requestId,
    ]);
    expect(audit).toEqual(
      [
        ['claudeCredentialId', claude.id],
        ['claudeEffort', 'xhigh'],
        ['claudeGatewayCredentialId', gateway.id],
        ['claudeModel', 'claude-opus-5-5'],
        ['claudePart', true],
        ['name', 'Work'],
        ['openaiPart', false],
        ['ownerUserId', ihor.userId],
      ].map((row) => [...row, 'create', 'req-profile-1']),
    );
  });

  it('holds a Claude and an OpenAI part on one profile, any gateway in either', async () => {
    const [claude, openai] = [await sub(ihor, 'claude_oauth'), await sub(ihor, 'codex_oauth')];
    const memory = await addGateway(ihor);
    const older = await addGateway(ihor, { provider: 'openai' });
    const view = await create(ihor, {
      parts: {
        claude: { credentialId: claude.id, gatewayCredentialId: older.id },
        openai: { credentialId: openai.id, gatewayCredentialId: memory.id },
      },
    });
    expect(view.parts).toMatchObject({
      claude: { subscription: shown(claude), gateway: shown(older), model: null, effort: null },
      openai: { subscription: shown(openai), gateway: shown(memory) },
      github: null,
    });
  });

  it('takes every kind of each AI part’s provider, and none', async () => {
    for (const kind of ['claude_oauth', 'claude_setup_token', 'anthropic_api_key'] as const) {
      const view = await create(ihor, { parts: { claude: { credentialId: (await sub(ihor, kind)).id } } });
      expect(view.parts.claude?.subscription?.kind).toBe(kind);
    }
    for (const kind of ['codex_oauth', 'openai_api_key'] as const) {
      const view = await create(ihor, { parts: { openai: { credentialId: (await sub(ihor, kind)).id } } });
      expect(view.parts.openai?.subscription?.kind).toBe(kind);
    }
    const empty = await create(ihor, { parts: { claude: {} } });
    expect(empty.parts.claude).toEqual({ subscription: null, gateway: null, model: null, effort: null });
  });

  it.each([
    ['claude', 'credentialId', 'openai_api_key'],
    ['claude', 'credentialId', 'codex_oauth'],
    ['claude', 'credentialId', 'gateway'],
    ['claude', 'credentialId', 'github_oauth'],
    ['openai', 'credentialId', 'claude_oauth'],
    ['openai', 'credentialId', 'anthropic_api_key'],
    ['claude', 'gatewayCredentialId', 'claude_setup_token'],
    ['openai', 'gatewayCredentialId', 'codex_oauth'],
  ] as const)('refuses a %s part a %s of kind %s (422)', async (part, field, kind) => {
    const body = { name: fresh(), parts: { [part]: { [field]: (await sub(ihor, kind)).id } } };
    expect(await as(ihor)('POST', PROFILES, body)).toMatchObject({
      status: 422,
      body: { error: { code: 'credential_kind_mismatch' } },
    });
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
      const res = await as(ihor)('POST', PROFILES, {
        name: fresh(),
        parts: { claude: { credentialId: id } },
      });
      expect(res).toMatchObject({ status: 422, body: { error: { code } } });
    }
    expect(await listOf(ihor)).toHaveLength(before);
  });

  it('keeps names unique per person (409), while another person may take the same one', async () => {
    await create(ihor, { name: 'Shared name' });
    const res = await as(ihor)('POST', PROFILES, { name: 'Shared name', parts: { openai: {} } });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'access_profile_name_taken' } } });
    expect((await create(other, { name: 'Shared name' })).name).toBe('Shared name');
  });

  it.each([
    ['no name', {}],
    ['an empty name', { name: '   ' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['an unknown part', { name: 'Ok', parts: { gemini: {} } }],
    ['an unknown field in a part', { name: 'Ok', parts: { claude: { rights: {} } } }],
    ['a subscription that is not a string', { name: 'Ok', parts: { claude: { credentialId: 7 } } }],
  ])('refuses %s (400)', async (_, body) => {
    expect(await as(ihor)('POST', PROFILES, body)).toMatchObject({
      status: 400,
      body: { error: { code: 'invalid_request' } },
    });
  });
});

describe('GET /api/me/access-profiles', () => {
  it('lists only the caller’s own profiles, oldest first', async () => {
    const solo = await addUser(w.t.db, w.fake);
    const first = await create(solo, { name: 'First' });
    const second = await create(solo, { name: 'Second', parts: { openai: {} } });
    await create(other, {});
    expect((await listOf(solo)).map((profile) => profile.id)).toEqual([first.id, second.id]);
    expect((await listOf(other)).map((profile) => profile.id)).not.toContain(first.id);
  });

  it('keeps a part whose subscription is removed, with none', async () => {
    const claude = await sub(ihor, 'anthropic_api_key');
    const profile = await create(ihor, { parts: { claude: { credentialId: claude.id } } });
    expect((await as(ihor)('DELETE', `/api/me/subscriptions/${claude.id}`)).status).toBe(204);
    const [row] = await rawDb(w.t.db).select().from(accessProfiles).where(eq(accessProfiles.id, profile.id));
    expect(row).toMatchObject({ claudePart: true, claudeCredentialId: null });
    const listed = (await listOf(ihor)).find((each) => each.id === profile.id);
    expect(listed?.parts.claude?.subscription).toBeNull();
  });
});

describe('PATCH /api/me/access-profiles/:profileId', () => {
  it('renames it and changes a part’s subscription, writing only what differs, with audit rows', async () => {
    const first = await sub(ihor, 'claude_oauth');
    const second = await sub(ihor, 'claude_setup_token');
    const profile = await create(ihor, { name: 'Before', parts: { claude: { credentialId: first.id } } });
    const path = `${PROFILES}/${profile.id}`;
    const change = { name: 'After', parts: { claude: { credentialId: second.id } } };
    const res = await as(ihor, 'req-profile-2')('PATCH', path, change);
    expect(res).toMatchObject({
      status: 200,
      body: { id: profile.id, name: 'After', parts: { claude: { subscription: { id: second.id } } } },
    });
    expect((await as(ihor, 'req-profile-3')('PATCH', path, change)).status).toBe(200);
    const updates = (await auditRows(w.t.db, 'access_profile', profile.id)).filter(
      (row) => row.action === 'update',
    );
    expect(updates.map((row) => [row.requestId, row.field, row.oldValue, row.newValue])).toEqual([
      ['req-profile-2', 'claudeCredentialId', first.id, second.id],
      ['req-profile-2', 'name', 'Before', 'After'],
    ]);
  });

  it('adds an AI part and removes one no agent runs on, emptying its columns', async () => {
    const openai = await sub(ihor, 'openai_api_key');
    const profile = await create(ihor, { parts: { claude: {} } });
    const path = `${PROFILES}/${profile.id}`;
    const added = await as(ihor)('PATCH', path, {
      parts: { openai: { credentialId: openai.id, model: 'gpt-5.5' } },
    });
    expect(added).toMatchObject({
      status: 200,
      body: {
        parts: {
          claude: { subscription: null },
          openai: { subscription: { id: openai.id }, model: 'gpt-5.5' },
        },
      },
    });
    const removed = await as(ihor, 'req-off')('PATCH', path, { parts: { claude: null, openai: null } });
    expect(removed).toMatchObject({ status: 200, body: { parts: NO_PARTS } });
    const [row] = await rawDb(w.t.db).select().from(accessProfiles).where(eq(accessProfiles.id, profile.id));
    expect(row).toMatchObject({
      claudePart: false,
      openaiPart: false,
      openaiCredentialId: null,
      openaiModel: null,
    });
  });

  it('empties a credential with null, keeps a revoked subscription in place, but refuses putting one in', async () => {
    const gateway = await sub(ihor, 'gateway');
    const claude = await sub(ihor, 'claude_setup_token');
    const profile = await create(ihor, {
      parts: { claude: { gatewayCredentialId: gateway.id, credentialId: claude.id } },
    });
    await revokeSubscription(w.t.db, claude.id);
    const path = `${PROFILES}/${profile.id}`;
    const kept = await as(ihor)('PATCH', path, {
      parts: { claude: { credentialId: claude.id, gatewayCredentialId: null } },
    });
    expect(kept).toMatchObject({
      status: 200,
      body: { parts: { claude: { subscription: { id: claude.id, status: 'revoked' }, gateway: null } } },
    });
    const emptied = await as(ihor)('PATCH', path, { parts: { claude: { credentialId: null } } });
    expect(emptied).toMatchObject({ status: 200, body: { parts: { claude: { subscription: null } } } });
    const back = await as(ihor)('PATCH', path, { parts: { claude: { credentialId: claude.id } } });
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
    const wrong = await as(ihor)('PATCH', `${PROFILES}/${mine.id}`, {
      parts: { openai: { credentialId: MISSING } },
    });
    expect(wrong).toMatchObject({ status: 422, body: { error: { code: 'credential_not_found' } } });
  });
});

describe('DELETE /api/me/access-profiles/:profileId', () => {
  it('removes the caller’s profile with its audit rows; another person’s is a 404', async () => {
    const theirs = await create(other, {});
    expect(await as(ihor)('DELETE', `${PROFILES}/${theirs.id}`)).toMatchObject({ status: 404 });
    const loner = await addUser(w.t.db, w.fake);
    const mine = await create(loner, { name: 'Gone', parts: { claude: {} } });
    expect((await as(loner, 'req-profile-4')('DELETE', `${PROFILES}/${mine.id}`)).status).toBe(204);
    expect(await listOf(loner)).toEqual([]);
    const deleted = (await auditRows(w.t.db, 'access_profile', mine.id)).filter(
      (row) => row.action === 'delete',
    );
    expect(
      deleted.map((row) => [row.companyId, row.requestId, row.field, row.oldValue, row.newValue]),
    ).toEqual([
      [null, 'req-profile-4', 'claudePart', true, null],
      [null, 'req-profile-4', 'name', 'Gone', null],
      [null, 'req-profile-4', 'openaiPart', false, null],
      [null, 'req-profile-4', 'ownerUserId', loner.userId, null],
    ]);
    expect((await as(loner)('DELETE', `${PROFILES}/${mine.id}`)).status).toBe(404);
  });
});

describe('who may manage profiles', () => {
  it('refuses an API key on every route with 403 session_required, even the owner’s own', async () => {
    const { company } = await seedCompany(w.t.db);
    const person = await addPerson(w.t.db, w.fake, company.id);
    const { key } = await seedApiKey(w.t.db, { companyId: company.id, principalId: person.principalId });
    const mine = await call(w, `fake:${person.subject}`)('POST', PROFILES, { name: 'Keyed' });
    const id = (mine.body as AccessProfileView).id;
    for (const [method, path, body] of [
      ['GET', PROFILES, undefined],
      ['POST', PROFILES, { name: 'Other' }],
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
