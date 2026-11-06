import { accessProfiles } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import type { CredentialKind } from '@mwc/shared/enums';
import { seedCompany } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../src/modules/credentials/schemas/profiles.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { addUser, call, type LinkedUser } from '../../../fixtures/companies/companies.ts';
import { addSubscription, auditRows, noSecret, PROFILES, revokeSubscription } from '../../../fixtures/org.ts';
import { type AuthWorld, addPerson, authWorld, seedApiKey } from '../../../fixtures/platform/auth.ts';

// `/api/me/access-profiles` (S3.4): a person's own named bundles of their subscriptions, one per slot, each of a kind
// the slot takes, never a revoked one and never someone else's; managed signed in only.

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

const slotView = (view: { id: string; kind: string; label: string; status: string }) => ({
  id: view.id,
  kind: view.kind,
  label: view.label,
  accountEmail: null,
  status: view.status,
});

describe('POST /api/me/access-profiles', () => {
  it('bundles the caller’s subscriptions, shown as metadata only, and audits the creation', async () => {
    const [claude, openai, gateway] = [
      await sub(ihor, 'claude_setup_token'),
      await sub(ihor, 'codex_oauth'),
      await sub(ihor, 'gateway'),
    ];
    const res = await as(ihor, 'req-profile-1')('POST', PROFILES, {
      name: '  Work ',
      claudeCredentialId: claude.id,
      openaiCredentialId: openai.id,
      gatewayCredentialId: gateway.id,
    });
    expect(res.status).toBe(201);
    const view = res.body as AccessProfileView;
    expect(view).toEqual({
      id: view.id,
      name: 'Work',
      claude: slotView(claude),
      openai: slotView(openai),
      gateway: slotView(gateway),
      agents: [],
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    });
    noSecret(view);
    const audit = await auditRows(w.t.db, 'access_profile', view.id);
    expect(audit).toEqual(
      [
        ['claudeCredentialId', claude.id],
        ['gatewayCredentialId', gateway.id],
        ['name', 'Work'],
        ['openaiCredentialId', openai.id],
        ['ownerUserId', ihor.userId],
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

  it('takes every kind its slot fits, and leaves slots empty', async () => {
    for (const kind of ['claude_oauth', 'claude_setup_token', 'anthropic_api_key'] as const) {
      expect((await create(ihor, { claudeCredentialId: (await sub(ihor, kind)).id })).claude?.kind).toBe(
        kind,
      );
    }
    for (const kind of ['codex_oauth', 'openai_api_key'] as const) {
      expect((await create(ihor, { openaiCredentialId: (await sub(ihor, kind)).id })).openai?.kind).toBe(
        kind,
      );
    }
    const empty = await create(ihor, { claudeCredentialId: null });
    expect(empty).toMatchObject({ claude: null, openai: null, gateway: null });
  });

  it.each([
    ['claudeCredentialId', 'openai_api_key'],
    ['claudeCredentialId', 'codex_oauth'],
    ['claudeCredentialId', 'gateway'],
    ['openaiCredentialId', 'claude_oauth'],
    ['openaiCredentialId', 'anthropic_api_key'],
    ['gatewayCredentialId', 'claude_setup_token'],
  ] as const)('refuses %s a %s subscription (422)', async (slot, kind) => {
    const res = await as(ihor)('POST', PROFILES, { name: fresh(), [slot]: (await sub(ihor, kind)).id });
    expect(res).toMatchObject({ status: 422, body: { error: { code: 'credential_kind_mismatch' } } });
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
      const res = await as(ihor)('POST', PROFILES, { name: fresh(), claudeCredentialId: id });
      expect(res).toMatchObject({ status: 422, body: { error: { code } } });
    }
    expect(await listOf(ihor)).toHaveLength(before);
  });

  it('keeps names unique per person (409), while another person may take the same one', async () => {
    await create(ihor, { name: 'Shared name' });
    const res = await as(ihor)('POST', PROFILES, { name: 'Shared name' });
    expect(res).toMatchObject({ status: 409, body: { error: { code: 'access_profile_name_taken' } } });
    expect((await create(other, { name: 'Shared name' })).name).toBe('Shared name');
  });

  it.each([
    ['no name', {}],
    ['an empty name', { name: '   ' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['a slot that is not a string', { name: 'Ok', claudeCredentialId: 7 }],
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
    const second = await create(solo, { name: 'Second' });
    await create(other, {});
    expect((await listOf(solo)).map((profile) => profile.id)).toEqual([first.id, second.id]);
    expect((await listOf(other)).map((profile) => profile.id)).not.toContain(first.id);
  });

  it('shows a slot emptied when its subscription is removed', async () => {
    const claude = await sub(ihor, 'anthropic_api_key');
    const profile = await create(ihor, { claudeCredentialId: claude.id });
    expect((await as(ihor)('DELETE', `/api/me/subscriptions/${claude.id}`)).status).toBe(204);
    const [row] = await rawDb(w.t.db).select().from(accessProfiles).where(eq(accessProfiles.id, profile.id));
    expect(row?.claudeCredentialId).toBeNull();
    expect((await listOf(ihor)).find((listed) => listed.id === profile.id)?.claude).toBeNull();
  });
});

describe('PATCH /api/me/access-profiles/:profileId', () => {
  it('renames it and changes its slots, writing only what differs, with audit rows', async () => {
    const first = await sub(ihor, 'claude_oauth');
    const second = await sub(ihor, 'claude_setup_token');
    const profile = await create(ihor, { name: 'Before', claudeCredentialId: first.id });
    const path = `${PROFILES}/${profile.id}`;
    const res = await as(ihor, 'req-profile-2')('PATCH', path, {
      name: 'After',
      claudeCredentialId: second.id,
    });
    expect(res).toMatchObject({
      status: 200,
      body: { id: profile.id, name: 'After', claude: { id: second.id } },
    });
    const same = await as(ihor, 'req-profile-3')('PATCH', path, {
      name: 'After',
      claudeCredentialId: second.id,
    });
    expect(same.status).toBe(200);
    const updates = (await auditRows(w.t.db, 'access_profile', profile.id)).filter(
      (row) => row.action === 'update',
    );
    expect(updates.map((row) => [row.requestId, row.field, row.oldValue, row.newValue])).toEqual([
      ['req-profile-2', 'claudeCredentialId', first.id, second.id],
      ['req-profile-2', 'name', 'Before', 'After'],
    ]);
  });

  it('empties a slot with null, keeps a revoked subscription in place, but refuses putting one in', async () => {
    const gateway = await sub(ihor, 'gateway');
    const claude = await sub(ihor, 'claude_setup_token');
    const profile = await create(ihor, { gatewayCredentialId: gateway.id, claudeCredentialId: claude.id });
    await revokeSubscription(w.t.db, claude.id);
    const path = `${PROFILES}/${profile.id}`;
    const kept = await as(ihor)('PATCH', path, { claudeCredentialId: claude.id, gatewayCredentialId: null });
    expect(kept).toMatchObject({
      status: 200,
      body: { claude: { id: claude.id, status: 'revoked' }, gateway: null },
    });
    const emptied = await as(ihor)('PATCH', path, { claudeCredentialId: null });
    expect(emptied).toMatchObject({ status: 200, body: { claude: null } });
    const back = await as(ihor)('PATCH', path, { claudeCredentialId: claude.id });
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
    const wrong = await as(ihor)('PATCH', `${PROFILES}/${mine.id}`, { openaiCredentialId: MISSING });
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
    ]);
    expect((await as(loner)('DELETE', `${PROFILES}/${mine.id}`)).status).toBe(404);
  });
});

describe('who may manage access profiles', () => {
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
