import { users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { seedAgent } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccessProfileView } from '../../../../src/modules/credentials/schemas/profiles.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { call } from '../../../fixtures/companies/companies.ts';
import { as, type MembersCompany, memberPath, membersCompany } from '../../../fixtures/members/members.ts';
import {
  type AgentDetailView,
  addSignIn,
  agentsPath,
  agentToolsOf,
  fieldAudit,
  makeAgent,
  managerWithReports,
  noSecret,
  PROFILES,
  placedMember,
  putDefault,
  seedProfile,
  seedToolProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person, seedApiKey } from '../../../fixtures/platform/auth.ts';

// An agent's GitHub and Atlassian profiles (S7.1b): given by their owner only, signed in, in a company they administer,
// each of its own tool; taken off by any admin or owner; none by default (no member's default); shown with the account
// its sign-in acts as and its rights, never a secret; audited; and lost when the owner removes the profile or leaves.

const MISSING = '0190f5f0-0000-7000-8000-000000000000';
const keyring = ephemeralKeyring();
let w: AuthWorld;
let company: MembersCompany;
let admin: Person;
beforeAll(async () => {
  w = await authWorld({ keyring });
  company = await membersCompany(w);
  admin = await placedMember(w, company, 'admin');
});
afterAll(() => w.t.close());

const PUSH = { repos: ['AiriaLLC/*'], push: true, pullRequests: true };
const WIKI = { jira: 'read', jiraProjects: ['AP'], confluence: 'write', confluenceSpaces: ['ENG'] } as const;

const patchAgent = (person: Person, agentId: string, body: Record<string, unknown>, requestId?: string) =>
  as(w, person, requestId)('PATCH', agentsPath(company, agentId), body);
const refusal = (status: number, code: string) => ({ status, body: { error: { code } } });

/** A GitHub and an Atlassian profile of `person`'s, each with a sign-in. */
async function toolProfiles(person: Person) {
  const github = await addSignIn(w, keyring, person.userId, 'github_oauth');
  const atlassian = await addSignIn(w, keyring, person.userId, 'atlassian_api_token');
  return {
    github: await seedToolProfile(w.t.db, person.userId, 'github', { credentialId: github.id, rights: PUSH }),
    atlassian: await seedToolProfile(w.t.db, person.userId, 'atlassian', {
      credentialId: atlassian.id,
      rights: { ...WIKI, jiraProjects: [...WIKI.jiraProjects], confluenceSpaces: [...WIKI.confluenceSpaces] },
    }),
  };
}

const ownerName = async (person: Person) =>
  (await rawDb(w.t.db).select().from(users).where(eq(users.id, person.userId)))[0]?.displayName;

describe('giving an agent its tool profiles', () => {
  it('lets the owner give both when hiring, shows them with account and rights, never secrets, and audits them', async () => {
    const { github, atlassian } = await toolProfiles(company.owner);
    const res = await as(w, company.owner, 'req-tools-hire')('POST', agentsPath(company), {
      name: 'Toolbox',
      roleTitle: 'Coder',
      githubProfileId: github.id,
      atlassianProfileId: atlassian.id,
    });
    expect(res.status).toBe(201);
    const agent = res.body as AgentDetailView;
    const owner = { ownerUserId: company.owner.userId, ownerName: await ownerName(company.owner) };
    const shownGithub = {
      id: github.id,
      name: github.name,
      provider: 'github',
      ...owner,
      account: 'ihor-fake',
      site: null,
      rights: PUSH,
    };
    expect(agent.githubProfile).toEqual(shownGithub);
    expect(agent.atlassianProfile).toEqual({
      id: atlassian.id,
      name: atlassian.name,
      provider: 'atlassian',
      ...owner,
      account: 'Ihor Herasko',
      site: 'airia-fake.atlassian.net',
      rights: WIKI,
    });
    noSecret(res.body);
    const listed = await as(w, admin)('GET', agentsPath(company));
    const row = (listed.body as { agents: AgentDetailView[] }).agents.find((a) => a.id === agent.id);
    expect(row?.githubProfile).toEqual(shownGithub);
    expect(await fieldAudit(w.t.db, 'agent', agent.id, 'githubProfileId')).toEqual([
      [company.companyId, 'create', company.owner.principalId, 'req-tools-hire', null, github.id],
    ]);
    expect(await fieldAudit(w.t.db, 'agent', agent.id, 'atlassianProfileId')).toHaveLength(1);
    const profiles = ((await as(w, company.owner)('GET', PROFILES)).body as { profiles: AccessProfileView[] })
      .profiles;
    expect(profiles.find((p) => p.id === github.id)?.agents.map((a) => a.agentId)).toEqual([agent.id]);
  });

  it('gives none by default, whatever the hirer’s AI default', async () => {
    const claude = await seedProfile(w.t.db, admin.userId);
    await putDefault(w.t.db, admin.membershipId, claude.id);
    const agent = await makeAgent(w, company, admin, { name: 'Plain' });
    expect(agent).toMatchObject({ profile: { id: claude.id }, githubProfile: null, atlassianProfile: null });
  });

  it('lets another admin take one off but not give it; the owner gives it on the agent’s page', async () => {
    const { github, atlassian } = await toolProfiles(company.owner);
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Shared tools',
      githubProfileId: github.id,
    });
    expect(await patchAgent(admin, agent.id, { atlassianProfileId: atlassian.id })).toMatchObject(
      refusal(403, 'profile_not_yours'),
    );
    expect(await patchAgent(admin, agent.id, { githubProfileId: null }, 'req-tools-off')).toMatchObject({
      status: 200,
      body: { githubProfile: null },
    });
    expect(await patchAgent(company.owner, agent.id, { atlassianProfileId: atlassian.id })).toMatchObject({
      status: 200,
      body: { atlassianProfile: { id: atlassian.id } },
    });
    expect(await agentToolsOf(w.t.db, agent.id)).toEqual({
      githubProfileId: null,
      atlassianProfileId: atlassian.id,
    });
    expect(
      (await fieldAudit(w.t.db, 'agent', agent.id, 'githubProfileId')).map((row) => row.slice(1)),
    ).toEqual([
      ['create', company.owner.principalId, expect.any(String), null, github.id],
      ['update', admin.principalId, 'req-tools-off', github.id, null],
    ]);
  });

  it('refuses a profile of another provider in each column, and none at all', async () => {
    const { github, atlassian } = await toolProfiles(company.owner);
    const claude = await seedProfile(w.t.db, company.owner.userId);
    const agent = await makeAgent(w, company, company.owner, { name: 'Picky', profileId: null });
    for (const body of [
      { githubProfileId: claude.id },
      { githubProfileId: atlassian.id },
      { atlassianProfileId: github.id },
    ]) {
      expect(await patchAgent(company.owner, agent.id, body)).toMatchObject(
        refusal(422, 'profile_provider_mismatch'),
      );
    }
    expect(await patchAgent(company.owner, agent.id, { profileId: github.id })).toMatchObject(
      refusal(422, 'profile_harness_mismatch'),
    );
    expect(await patchAgent(company.owner, agent.id, { atlassianProfileId: MISSING })).toMatchObject(
      refusal(422, 'profile_not_found'),
    );
    const hire = await as(w, company.owner)('POST', agentsPath(company), {
      name: 'Wrong',
      roleTitle: 'Coder',
      atlassianProfileId: claude.id,
    });
    expect(hire).toMatchObject(refusal(422, 'profile_provider_mismatch'));
    expect(await agentToolsOf(w.t.db, agent.id)).toEqual({ githubProfileId: null, atlassianProfileId: null });
  });

  it('refuses giving one with an API key or as a member, while an API key may take one off', async () => {
    const { github } = await toolProfiles(company.owner);
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Keyed tools',
      githubProfileId: github.id,
    });
    const { key } = await seedApiKey(w.t.db, {
      companyId: company.companyId,
      principalId: company.owner.principalId,
    });
    const other = await seedToolProfile(w.t.db, company.owner.userId, 'github');
    const keyed = await call(w, key)('PATCH', agentsPath(company, agent.id), { githubProfileId: other.id });
    expect(keyed).toMatchObject(refusal(403, 'session_required'));
    const member = await placedMember(w, company, 'member');
    const theirs = await seedToolProfile(w.t.db, member.userId, 'github');
    expect(await patchAgent(member, agent.id, { githubProfileId: theirs.id })).toMatchObject({ status: 403 });
    const off = await call(w, key)('PATCH', agentsPath(company, agent.id), { githubProfileId: null });
    expect(off).toMatchObject({ status: 200, body: { githubProfile: null } });
  });

  it('shows a profile without a sign-in with no account', async () => {
    const empty = await seedToolProfile(w.t.db, company.owner.userId, 'atlassian');
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Unsigned',
      atlassianProfileId: empty.id,
    });
    expect(agent.atlassianProfile).toMatchObject({ account: null, site: null, rights: { jira: 'read' } });
  });
});

describe('losing a tool profile', () => {
  it('when its owner removes it: off the agent, audited by the owner', async () => {
    const { github, atlassian } = await toolProfiles(company.owner);
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Losing',
      githubProfileId: github.id,
      atlassianProfileId: atlassian.id,
    });
    const removed = await as(w, company.owner, 'req-tools-rm')('DELETE', `${PROFILES}/${github.id}`);
    expect(removed.status).toBe(204);
    expect(await agentToolsOf(w.t.db, agent.id)).toEqual({
      githubProfileId: null,
      atlassianProfileId: atlassian.id,
    });
    expect((await fieldAudit(w.t.db, 'agent', agent.id, 'githubProfileId')).at(-1)).toEqual([
      company.companyId,
      'update',
      company.owner.principalId,
      'req-tools-rm',
      github.id,
      null,
    ]);
  });

  it('when its owner leaves the company: every one of theirs off its agents, each column audited', async () => {
    const team = await managerWithReports(w, company, company.owner);
    const leaver = { userId: team.member.userId } as Person;
    const { github, atlassian } = await toolProfiles(leaver);
    const claude = await seedProfile(w.t.db, team.member.userId);
    const owners = await toolProfiles(company.owner);
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Left behind',
      githubProfileId: owners.github.id,
    });
    const theirs = (
      await seedAgent(w.t.db, company.companyId, {
        reportsTo: company.owner.principalId,
        profileId: claude.id,
        githubProfileId: github.id,
        atlassianProfileId: atlassian.id,
      })
    ).agent;
    const res = await as(w, company.owner, 'req-tools-leave')('DELETE', memberPath(company, team.member.id));
    expect(res.status).toBe(204);
    expect(await agentToolsOf(w.t.db, theirs.id)).toEqual({
      githubProfileId: null,
      atlassianProfileId: null,
    });
    for (const [field, id] of [
      ['profileId', claude.id],
      ['githubProfileId', github.id],
      ['atlassianProfileId', atlassian.id],
    ]) {
      expect(await fieldAudit(w.t.db, 'agent', theirs.id, field as string), field).toEqual([
        [company.companyId, 'update', company.owner.principalId, 'req-tools-leave', id, null],
      ]);
    }
    expect(await agentToolsOf(w.t.db, agent.id)).toMatchObject({ githubProfileId: owners.github.id });
  });
});
