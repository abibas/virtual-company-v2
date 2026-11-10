import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import {
  type AgentDetailView,
  agentProfileOf,
  agentsPath,
  defaultPath,
  fieldAudit,
  makeAgent,
  placedMember,
  putDefault,
  putProfile,
  seedProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

// Access profiles fit an agent's harness (since 2026-11-10, docs/subscriptions.md): a Claude Code agent takes a Claude
// profile, a Codex agent an OpenAI one (422 `profile_harness_mismatch` otherwise); a hire without a profile gets the
// hirer's default of its harness's provider; a harness change takes off a profile that no longer fits and says so.

let w: AuthWorld;
let company: MembersCompany;
let admin: Person;
beforeAll(async () => {
  w = await authWorld();
  company = await membersCompany(w);
  admin = await placedMember(w, company, 'admin');
});
afterAll(() => w.t.close());

const patchAgent = (agentId: string, body: Record<string, unknown>, requestId?: string) =>
  as(w, admin, requestId)('PATCH', agentsPath(company, agentId), body);

describe('giving a profile that fits the harness', () => {
  it('gives a Claude profile to a Claude Code agent and an OpenAI one to a Codex agent, refusing the others', async () => {
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude' });
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const coder = await makeAgent(w, company, admin, { name: 'Claude coder', profileId: claude.id });
    expect(coder.profile?.id).toBe(claude.id);
    const codex = await makeAgent(w, company, admin, {
      name: 'Codex coder',
      harness: 'codex',
      profileId: openai.id,
    });
    expect(codex.profile?.id).toBe(openai.id);
    const refused = await as(w, admin)('POST', agentsPath(company), {
      name: 'Refused hire',
      roleTitle: 'Coder',
      harness: 'codex',
      profileId: claude.id,
    });
    expect(refused).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'profile_harness_mismatch',
          message: 'A Codex agent needs an OpenAI profile; this access profile is for Claude',
        },
      },
    });
    const wrong = await patchAgent(coder.id, { profileId: openai.id });
    expect(wrong).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'profile_harness_mismatch',
          message: expect.stringContaining('needs a Claude profile'),
        },
      },
    });
    expect(await agentProfileOf(w.t.db, coder.id)).toBe(claude.id);
  });

  it("hires with the hirer's default of the harness's provider when no profile is given", async () => {
    const hirer = await placedMember(w, company, 'admin');
    const claude = await seedProfile(w.t.db, hirer.userId, { provider: 'claude' });
    const openai = await seedProfile(w.t.db, hirer.userId, { provider: 'openai' });
    const path = defaultPath(company.companyId);
    expect((await as(w, hirer)('PUT', path, { provider: 'claude', profileId: claude.id })).status).toBe(200);
    expect(
      (await makeAgent(w, company, hirer, { name: 'Codex, no default', harness: 'codex' })).profile,
    ).toBeNull();
    expect((await as(w, hirer)('PUT', path, { provider: 'openai', profileId: openai.id })).status).toBe(200);
    const codex = await makeAgent(w, company, hirer, { name: 'Codex hire', harness: 'codex' });
    const coder = await makeAgent(w, company, hirer, { name: 'Claude hire' });
    expect([codex.profile?.id, coder.profile?.id]).toEqual([openai.id, claude.id]);
  });
});

describe('changing the harness', () => {
  const made = async (name: string, body: Record<string, unknown>) =>
    makeAgent(w, company, admin, { name, ...body });

  it('takes off a profile the new harness does not fit, with its audit row and a note in the answer', async () => {
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude', name: 'Work claude' });
    const agent = await made('Switcher', { profileId: claude.id });
    const res = await patchAgent(agent.id, { harness: 'codex', model: 'gpt-5.6-codex' }, 'req-switch');
    expect(res.status).toBe(200);
    const body = res.body as AgentDetailView & { profileCleared?: unknown };
    expect(body).toMatchObject({ harness: 'codex', profile: null });
    expect(body.profileCleared).toEqual({
      profileId: claude.id,
      name: 'Work claude',
      message:
        'Its access profile Work claude is for Claude, so it was taken off: a Codex agent needs an OpenAI profile',
    });
    expect(await agentProfileOf(w.t.db, agent.id)).toBeNull();
    expect(await fieldAudit(w.t.db, 'agent', agent.id, 'profileId')).toEqual([
      [company.companyId, 'create', admin.principalId, expect.any(String), null, claude.id],
      [company.companyId, 'update', admin.principalId, 'req-switch', claude.id, null],
    ]);
  });

  it('keeps a profile that still fits, and gives one named with the new harness', async () => {
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude' });
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const agent = await made('Same harness', { profileId: claude.id });
    const renamed = await patchAgent(agent.id, { name: 'Same harness 2', harness: 'claude_code' });
    expect(renamed.body).toMatchObject({ profile: { id: claude.id } });
    expect(renamed.body).not.toHaveProperty('profileCleared');
    const switched = await patchAgent(agent.id, { harness: 'codex', profileId: openai.id });
    expect(switched).toMatchObject({ status: 200, body: { harness: 'codex', profile: { id: openai.id } } });
    expect(switched.body).not.toHaveProperty('profileCleared');
    const bare = await made('No profile', { profileId: null });
    const moved = await patchAgent(bare.id, { harness: 'codex' });
    expect(moved).toMatchObject({ status: 200, body: { harness: 'codex', profile: null } });
    expect(moved.body).not.toHaveProperty('profileCleared');
  });

  it('refuses a change that names the profile it has with a harness that profile does not fit, writing nothing', async () => {
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude' });
    const agent = await made('Stubborn', { profileId: claude.id });
    const res = await patchAgent(agent.id, { harness: 'codex', profileId: claude.id });
    expect(res).toMatchObject({ status: 422, body: { error: { code: 'profile_harness_mismatch' } } });
    expect(await agentProfileOf(w.t.db, agent.id)).toBe(claude.id);
    const after = await as(w, admin)('GET', agentsPath(company, agent.id));
    expect(after.body).toMatchObject({ harness: 'claude_code' });
  });

  it("takes off another person's profile too, which any admin may", async () => {
    const theirs = await seedProfile(w.t.db, company.owner.userId, { provider: 'openai' });
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Owner codex',
      harness: 'codex',
      profileId: theirs.id,
    });
    const res = await patchAgent(agent.id, { harness: 'claude_code' });
    expect(res).toMatchObject({
      status: 200,
      body: { profile: null, profileCleared: { profileId: theirs.id } },
    });
  });

  it('keeps a profile put on without the rules once the new harness fits it', async () => {
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const agent = await made('Misfit', { profileId: null });
    await putProfile(w.t.db, company.companyId, agent.id, openai.id);
    const res = await patchAgent(agent.id, { harness: 'codex' });
    expect(res).toMatchObject({ status: 200, body: { harness: 'codex', profile: { id: openai.id } } });
    expect(res.body).not.toHaveProperty('profileCleared');
  });
});

describe("a member's default of each provider", () => {
  it('puts each default on the hires of its own harness only', async () => {
    const hirer = await placedMember(w, company, 'admin');
    const openai = await seedProfile(w.t.db, hirer.userId, { provider: 'openai' });
    await putDefault(w.t.db, hirer.membershipId, openai.id, 'openai');
    expect((await makeAgent(w, company, hirer, { name: 'Claude, no default' })).profile).toBeNull();
    expect(
      (await makeAgent(w, company, hirer, { name: 'Codex default', harness: 'codex' })).profile?.id,
    ).toBe(openai.id);
  });
});
