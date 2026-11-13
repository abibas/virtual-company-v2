import { users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Me } from '../../../../src/modules/identity/schemas.ts';
import { call, joinCompany } from '../../../fixtures/companies/companies.ts';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import {
  type AgentDetailView,
  agentProfileOf,
  agentsPath,
  chartOf,
  defaultPath,
  defaultProfileOf,
  fieldAudit,
  makeAgent,
  placedMember,
  putDefault,
  seedProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person, seedApiKey } from '../../../fixtures/platform/auth.ts';

// Access profiles on agents (S3.4): only a profile's owner gives it, signed in, in a company where they are an admin
// or owner; any admin or owner takes it off; a member's default goes on the agents they hire; agents and the chart
// show the profile's name and owner, never its subscriptions.

const MISSING = '0190f5f0-0000-7000-8000-000000000000';
let w: AuthWorld;
let company: MembersCompany;
let admin: Person;
beforeAll(async () => {
  w = await authWorld();
  company = await membersCompany(w);
  admin = await placedMember(w, company, 'admin');
});
afterAll(() => w.t.close());

const ownerName = async (person: Person) =>
  (await rawDb(w.t.db).select().from(users).where(eq(users.id, person.userId)))[0]?.displayName;

const patchAgent = (person: Person, agentId: string, body: Record<string, unknown>, requestId?: string) =>
  as(w, person, requestId)('PATCH', agentsPath(company, agentId), body);

describe('giving an access profile to an agent', () => {
  it('lets the owner give theirs, and shows it on the agent, the list and the chart, never a secret', async () => {
    const profile = await seedProfile(w.t.db, company.owner.userId, { name: 'Work' });
    const agent = await makeAgent(w, company, company.owner, { name: 'Profiled' });
    expect(agent.profile).toBeNull();
    const res = await patchAgent(company.owner, agent.id, { profileId: profile.id }, 'req-give-1');
    const shown = {
      id: profile.id,
      name: 'Work',
      provider: 'claude',
      ownerUserId: company.owner.userId,
      ownerName: await ownerName(company.owner),
      account: null,
      tools: { github: null, atlassian: null },
    };
    expect(res).toMatchObject({ status: 200, body: { profile: shown } });
    expect(Object.keys((res.body as AgentDetailView).profile ?? {})).toEqual(Object.keys(shown));
    const detail = await as(w, company.owner)('GET', agentsPath(company, agent.id));
    expect((detail.body as AgentDetailView).profile).toEqual(shown);
    const list = await as(w, admin)('GET', agentsPath(company));
    const listed = (list.body as { agents: AgentDetailView[] }).agents.find((a) => a.id === agent.id);
    expect(listed?.profile).toEqual(shown);
    const node = (await chartOf(w, company)).nodes.find((n) => n.principalId === agent.principalId);
    expect(node).toMatchObject({ kind: 'agent', agent: { profile: shown } });
    expect(await fieldAudit(w.t.db, 'agent', agent.id, 'profileId')).toEqual([
      [company.companyId, 'update', company.owner.principalId, 'req-give-1', null, profile.id],
    ]);
  });

  it('names an owner without a name by their email', async () => {
    const nameless = await placedMember(w, company, 'admin');
    await rawDb(w.t.db).update(users).set({ displayName: null }).where(eq(users.id, nameless.userId));
    const profile = await seedProfile(w.t.db, nameless.userId);
    const agent = await makeAgent(w, company, nameless, { name: 'Nameless', profileId: profile.id });
    expect(agent.profile?.ownerName).toBe(`${nameless.subject}@people.test`);
  });

  it('lets another admin take it off, but not give it; the same profile again changes nothing', async () => {
    const owners = await seedProfile(w.t.db, company.owner.userId);
    const agent = await makeAgent(w, company, company.owner, { name: 'Shared', profileId: owners.id });
    const again = await patchAgent(admin, agent.id, { profileId: owners.id, name: 'Shared 2' });
    expect(again).toMatchObject({ status: 200, body: { name: 'Shared 2', profile: { id: owners.id } } });
    const off = await patchAgent(admin, agent.id, { profileId: null }, 'req-off');
    expect(off).toMatchObject({ status: 200, body: { profile: null } });
    const give = await patchAgent(admin, agent.id, { profileId: owners.id, name: 'Taken' });
    expect(give).toMatchObject({ status: 403, body: { error: { code: 'profile_not_yours' } } });
    expect(await agentProfileOf(w.t.db, agent.id)).toBeNull();
    const mine = await seedProfile(w.t.db, admin.userId);
    expect(await patchAgent(admin, agent.id, { profileId: mine.id })).toMatchObject({
      status: 200,
      body: { name: 'Shared 2', profile: { id: mine.id, ownerUserId: admin.userId } },
    });
    expect((await fieldAudit(w.t.db, 'agent', agent.id, 'profileId')).map((row) => row.slice(1))).toEqual([
      ['create', company.owner.principalId, expect.any(String), null, owners.id],
      ['update', admin.principalId, 'req-off', owners.id, null],
      ['update', admin.principalId, expect.any(String), null, mine.id],
    ]);
  });

  it('refuses a profile that does not exist (422) and giving one with an API key (403), which may take one off', async () => {
    const profile = await seedProfile(w.t.db, company.owner.userId);
    const agent = await makeAgent(w, company, company.owner, { name: 'Keyed', profileId: profile.id });
    for (const id of [MISSING, 'not-an-id']) {
      expect(await patchAgent(company.owner, agent.id, { profileId: id })).toMatchObject({
        status: 422,
        body: { error: { code: 'profile_not_found' } },
      });
    }
    const { key } = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: company.owner.principalId,
    });
    const other = await seedProfile(w.t.db, company.owner.userId);
    const keyed = await call(w, key)('PATCH', agentsPath(company, agent.id), { profileId: other.id });
    expect(keyed).toMatchObject({ status: 403, body: { error: { code: 'session_required' } } });
    expect(await agentProfileOf(w.t.db, agent.id)).toBe(profile.id);
    const removed = await call(w, key)('PATCH', agentsPath(company, agent.id), { profileId: null });
    expect(removed).toMatchObject({ status: 200, body: { profile: null } });
  });
});

describe('POST /api/companies/:companyId/agents with a profile', () => {
  it('gives the one asked for, none for null, and the caller’s default when it is left out', async () => {
    const hirer = await placedMember(w, company, 'admin');
    const preferred = await seedProfile(w.t.db, hirer.userId);
    const chosen = await seedProfile(w.t.db, hirer.userId);
    expect((await makeAgent(w, company, hirer, { name: 'No default' })).profile).toBeNull();
    expect(
      (
        await as(w, hirer)('PUT', defaultPath(company.companyId), {
          provider: 'claude',
          profileId: preferred.id,
        })
      ).status,
    ).toBe(200);
    const byDefault = await makeAgent(w, company, hirer, { name: 'Default' });
    expect(byDefault.profile?.id).toBe(preferred.id);
    expect((await makeAgent(w, company, hirer, { name: 'None', profileId: null })).profile).toBeNull();
    expect((await makeAgent(w, company, hirer, { name: 'Chosen', profileId: chosen.id })).profile?.id).toBe(
      chosen.id,
    );
    expect(await fieldAudit(w.t.db, 'agent', byDefault.id, 'profileId')).toEqual([
      [company.companyId, 'create', hirer.principalId, expect.any(String), null, preferred.id],
    ]);
    // Someone else's default does not follow them: the owner hires with none.
    expect((await makeAgent(w, company, company.owner, { name: 'Owner hires' })).profile).toBeNull();
  });

  it('refuses someone else’s profile (403), none (422) and one given with an API key (403), hiring nobody', async () => {
    const theirs = await seedProfile(w.t.db, admin.userId);
    const mine = await seedProfile(w.t.db, company.owner.userId);
    const { key } = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: company.owner.principalId,
    });
    for (const [caller, profileId, status, code] of [
      [as(w, company.owner), theirs.id, 403, 'profile_not_yours'],
      [as(w, company.owner), MISSING, 422, 'profile_not_found'],
      [call(w, key), mine.id, 403, 'session_required'],
    ] as const) {
      const res = await caller('POST', agentsPath(company), {
        name: 'Refused',
        roleTitle: 'Coder',
        profileId,
      });
      expect(res).toMatchObject({ status, body: { error: { code } } });
    }
    const all = await as(w, company.owner)('GET', agentsPath(company, undefined, '?status=all'));
    expect((all.body as { agents: AgentDetailView[] }).agents.some((a) => a.name === 'Refused')).toBe(false);
  });

  it('puts the default on an agent hired with an API key: the owner chose it signed in', async () => {
    const hirer = await placedMember(w, company, 'admin');
    const preferred = await seedProfile(w.t.db, hirer.userId);
    await as(w, hirer)('PUT', defaultPath(company.companyId), {
      provider: 'claude',
      profileId: preferred.id,
    });
    const { key } = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: hirer.principalId,
    });
    const res = await call(w, key)('POST', agentsPath(company), { name: 'Key hire', roleTitle: 'Coder' });
    expect(res).toMatchObject({ status: 201, body: { profile: { id: preferred.id } } });
  });
});

describe('PUT /api/companies/:companyId/me/default-profile', () => {
  it('sets and clears the caller’s own default, shown on GET /api/me, with audit rows', async () => {
    const person = await placedMember(w, company, 'admin');
    const elsewhere = await membersCompany(w);
    await joinCompany(w.t.db, elsewhere.companyId, person.userId, 'admin');
    const profile = await seedProfile(w.t.db, person.userId);
    const path = defaultPath(company.companyId);
    const codex = await seedProfile(w.t.db, person.userId, { provider: 'openai' });
    const set = await as(w, person, 'req-default-1')('PUT', path, {
      provider: 'claude',
      profileId: profile.id,
    });
    expect(set).toMatchObject({
      status: 200,
      body: { defaultClaudeProfileId: profile.id, defaultOpenaiProfileId: null },
    });
    const both = await as(w, person, 'req-default-o')('PUT', path, {
      provider: 'openai',
      profileId: codex.id,
    });
    expect(both).toMatchObject({
      status: 200,
      body: { defaultClaudeProfileId: profile.id, defaultOpenaiProfileId: codex.id },
    });
    const me = (await as(w, person)('GET', '/api/me')).body as Me;
    const defaults = new Map(
      me.memberships.map((m) => [m.companyId, [m.defaultClaudeProfileId, m.defaultOpenaiProfileId]]),
    );
    expect(defaults).toEqual(
      new Map([
        [company.companyId, [profile.id, codex.id]],
        [elsewhere.companyId, [null, null]],
      ]),
    );
    expect(
      await as(w, person, 'req-default-2')('PUT', path, { provider: 'claude', profileId: profile.id }),
    ).toMatchObject({ status: 200, body: { defaultClaudeProfileId: profile.id } });
    const cleared = await as(w, person, 'req-default-3')('PUT', path, {
      provider: 'claude',
      profileId: null,
    });
    expect(cleared).toMatchObject({
      status: 200,
      body: { defaultClaudeProfileId: null, defaultOpenaiProfileId: codex.id },
    });
    expect(await defaultProfileOf(w.t.db, person.membershipId)).toBeNull();
    expect(await defaultProfileOf(w.t.db, person.membershipId, 'openai')).toBe(codex.id);
    expect(await fieldAudit(w.t.db, 'membership', person.membershipId, 'defaultClaudeProfileId')).toEqual([
      [company.companyId, 'update', person.principalId, 'req-default-1', null, profile.id],
      [company.companyId, 'update', person.principalId, 'req-default-3', profile.id, null],
    ]);
    expect(await fieldAudit(w.t.db, 'membership', person.membershipId, 'defaultOpenaiProfileId')).toEqual([
      [company.companyId, 'update', person.principalId, 'req-default-o', null, codex.id],
    ]);
  });

  it('refuses someone else’s profile, none, one of the other provider, a member or viewer choosing one, and an API key', async () => {
    const path = defaultPath(company.companyId);
    const theirs = await seedProfile(w.t.db, admin.userId);
    const claude = { provider: 'claude' } as const;
    expect(await as(w, company.owner)('PUT', path, { ...claude, profileId: theirs.id })).toMatchObject({
      status: 403,
      body: { error: { code: 'profile_not_yours' } },
    });
    expect(await as(w, company.owner)('PUT', path, { ...claude, profileId: MISSING })).toMatchObject({
      status: 422,
      body: { error: { code: 'profile_not_found' } },
    });
    const codex = await seedProfile(w.t.db, company.owner.userId, { provider: 'openai' });
    expect(await as(w, company.owner)('PUT', path, { ...claude, profileId: codex.id })).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'provider_mismatch',
          message: 'Your Claude default is a Claude profile; this access profile is for OpenAI',
        },
      },
    });
    expect(await defaultProfileOf(w.t.db, company.owner.membershipId)).toBeNull();
    for (const role of ['member', 'viewer'] as const) {
      const person = await placedMember(w, company, role);
      const own = await seedProfile(w.t.db, person.userId);
      expect(await as(w, person)('PUT', path, { ...claude, profileId: own.id })).toMatchObject({
        status: 403,
        body: { error: { code: 'forbidden' } },
      });
      // Clearing is anyone's: a member left with a default from when they were an admin may drop it.
      await putDefault(w.t.db, person.membershipId, own.id);
      expect(await as(w, person)('PUT', path, { ...claude, profileId: null })).toMatchObject({
        status: 200,
        body: { defaultClaudeProfileId: null },
      });
    }
    const mine = await seedProfile(w.t.db, company.owner.userId);
    const { key } = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: company.owner.principalId,
    });
    expect(await call(w, key)('PUT', path, { ...claude, profileId: mine.id })).toMatchObject({
      status: 403,
      body: { error: { code: 'session_required' } },
    });
    expect(await call(w, key)('PUT', path, { ...claude, profileId: null })).toMatchObject({ status: 200 });
  });

  it('answers 404 to a non-member and 400 without a provider or a profileId', async () => {
    const stranger = await membersCompany(w);
    const path = defaultPath(company.companyId);
    expect(await as(w, stranger.owner)('PUT', path, { provider: 'claude', profileId: null })).toMatchObject({
      status: 404,
    });
    expect(await as(w, company.owner)('PUT', path, { provider: 'claude' })).toMatchObject({ status: 400 });
    expect(await as(w, company.owner)('PUT', path, { profileId: null })).toMatchObject({ status: 400 });
  });
});
