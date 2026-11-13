import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import {
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

// A profile serves an agent through the part its harness runs on (generic profiles since 2026-11-13,
// docs/subscriptions.md "Profiles"): a Claude Code agent needs its profile's Claude part, a Codex agent its OpenAI part
// (422 `profile_part_missing` otherwise), a profile with both serves either; a hire without a profile gets the hirer's
// default for its harness when it still has that part; a harness change the profile has no part for is refused.

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
const missing = (message: string) => ({
  status: 422,
  body: { error: { code: 'profile_part_missing', message } },
});

/** A profile of `person`'s with both AI parts. */
const both = (person: Person) => seedProfile(w.t.db, person.userId, { provider: 'claude', openaiPart: true });

describe('giving a profile with the harness’s part', () => {
  it('gives a Claude Code agent a profile with a Claude part, a Codex agent one with an OpenAI part', async () => {
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
    expect(refused).toMatchObject(missing('This profile has no OpenAI part, which a Codex agent runs on'));
    expect(await patchAgent(coder.id, { profileId: openai.id })).toMatchObject(
      missing('This profile has no Claude part, which a Claude Code agent runs on'),
    );
    expect(await agentProfileOf(w.t.db, coder.id)).toBe(claude.id);
  });

  it('gives one profile with both AI parts to a Claude Code and a Codex agent, each running its own part', async () => {
    const shared = await seedProfile(w.t.db, admin.userId, {
      provider: 'claude',
      model: 'claude-opus-5-5',
      openaiPart: true,
      openaiModel: 'gpt-6.1-sol',
    });
    const coder = await makeAgent(w, company, admin, { name: 'Both: Claude', profileId: shared.id });
    const codex = await makeAgent(w, company, admin, {
      name: 'Both: Codex',
      harness: 'codex',
      profileId: shared.id,
    });
    expect(coder.runsWith).toEqual({ model: 'claude-opus-5-5', effort: null, provider: 'claude' });
    expect(codex.runsWith).toEqual({ model: 'gpt-6.1-sol', effort: null, provider: 'openai' });
  });

  it('refuses a profile with only tool parts', async () => {
    const tools = await seedProfile(w.t.db, admin.userId, { provider: null, githubRights: {} });
    const res = await as(w, admin)('POST', agentsPath(company), {
      name: 'Tools only',
      roleTitle: 'Coder',
      profileId: tools.id,
    });
    expect(res).toMatchObject({ status: 422, body: { error: { code: 'profile_part_missing' } } });
  });

  it("hires with the hirer's default for the harness when no profile is given, and none once it lost the part", async () => {
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
    await putDefault(w.t.db, hirer.membershipId, openai.id, 'claude');
    expect((await makeAgent(w, company, hirer, { name: 'Default without part' })).profile).toBeNull();
  });
});

describe('changing the harness', () => {
  const made = async (name: string, body: Record<string, unknown>) =>
    makeAgent(w, company, admin, { name, ...body });

  it('refuses a harness its profile has no part for, writing nothing', async () => {
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude' });
    const agent = await made('Stubborn', { profileId: claude.id });
    for (const body of [{ harness: 'codex' }, { harness: 'codex', profileId: claude.id }]) {
      expect(await patchAgent(agent.id, body)).toMatchObject(
        missing('This profile has no OpenAI part, which a Codex agent runs on'),
      );
    }
    expect(await agentProfileOf(w.t.db, agent.id)).toBe(claude.id);
    expect((await as(w, admin)('GET', agentsPath(company, agent.id))).body).toMatchObject({
      harness: 'claude_code',
    });
  });

  it('keeps a profile with both parts, and takes a new profile or none with the new harness', async () => {
    const shared = await both(admin);
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const agent = await made('Switcher', { profileId: shared.id });
    const kept = await patchAgent(agent.id, { harness: 'codex' }, 'req-switch');
    expect(kept).toMatchObject({ status: 200, body: { harness: 'codex', profile: { id: shared.id } } });
    const other = await made('Other', { profileId: shared.id });
    const given = await patchAgent(other.id, { harness: 'codex', profileId: openai.id });
    expect(given).toMatchObject({ status: 200, body: { harness: 'codex', profile: { id: openai.id } } });
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude' });
    const third = await made('Third', { profileId: claude.id });
    const off = await patchAgent(third.id, { harness: 'codex', profileId: null }, 'req-off');
    expect(off).toMatchObject({ status: 200, body: { harness: 'codex', profile: null } });
    expect((await fieldAudit(w.t.db, 'agent', third.id, 'profileId')).at(-1)).toEqual([
      company.companyId,
      'update',
      admin.principalId,
      'req-off',
      claude.id,
      null,
    ]);
    const bare = await made('No profile', { profileId: null });
    expect(await patchAgent(bare.id, { harness: 'codex' })).toMatchObject({ status: 200 });
  });

  it('keeps a profile put on without the rules once the new harness has its part', async () => {
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const agent = await made('Misfit', { profileId: null });
    await putProfile(w.t.db, company.companyId, agent.id, openai.id);
    const res = await patchAgent(agent.id, { harness: 'codex' });
    expect(res).toMatchObject({ status: 200, body: { harness: 'codex', profile: { id: openai.id } } });
  });
});

describe("a member's default for each AI part", () => {
  it('puts each default on the hires of its own harness only', async () => {
    const hirer = await placedMember(w, company, 'admin');
    const openai = await seedProfile(w.t.db, hirer.userId, { provider: 'openai' });
    await putDefault(w.t.db, hirer.membershipId, openai.id, 'openai');
    expect((await makeAgent(w, company, hirer, { name: 'Claude, no default' })).profile).toBeNull();
    expect(
      (await makeAgent(w, company, hirer, { name: 'Codex default', harness: 'codex' })).profile?.id,
    ).toBe(openai.id);
  });

  it('takes a profile with both parts as either default, and refuses one without the part', async () => {
    const hirer = await placedMember(w, company, 'admin');
    const shared = await both(hirer);
    const path = defaultPath(company.companyId);
    for (const provider of ['claude', 'openai']) {
      expect((await as(w, hirer)('PUT', path, { provider, profileId: shared.id })).status).toBe(200);
    }
    const tools = await seedProfile(w.t.db, hirer.userId, { provider: null, atlassianRights: {} });
    expect(await as(w, hirer)('PUT', path, { provider: 'openai', profileId: tools.id })).toMatchObject(
      missing('This profile has no OpenAI part, so it cannot be your default for Codex agents'),
    );
  });
});
