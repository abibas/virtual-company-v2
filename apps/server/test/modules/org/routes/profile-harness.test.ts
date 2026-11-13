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
  seedProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

// An agent's harness follows its profile (since 2026-11-13, docs/subscriptions.md "Profiles"): a profile has one AI
// part at most, and giving it to an agent, on hire or later, sets the agent's harness from it (Claude Code for a Claude
// part, Codex for an OpenAI part); a profile with no AI part is given to no agent (422 `profile_no_ai_part`); taking
// the profile off keeps the harness; a hire without a profile gets the hirer's Claude default, else their OpenAI one.

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
const NO_AI_PART = {
  status: 422,
  body: { error: { code: 'profile_no_ai_part', message: 'This profile has no AI part' } },
};

describe('hiring with a profile', () => {
  it('runs Claude Code on a Claude part and Codex on an OpenAI part, whatever harness is asked', async () => {
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude', model: 'claude-opus-5-5' });
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai', model: 'gpt-6.1-sol' });
    const coder = await makeAgent(w, company, admin, { name: 'Claude coder', profileId: claude.id });
    expect(coder).toMatchObject({
      harness: 'claude_code',
      profile: { id: claude.id },
      runsWith: { model: 'claude-opus-5-5', provider: 'claude' },
    });
    const codex = await makeAgent(w, company, admin, {
      name: 'Codex coder',
      harness: 'claude_code',
      profileId: openai.id,
    });
    expect(codex).toMatchObject({
      harness: 'codex',
      profile: { id: openai.id },
      runsWith: { model: 'gpt-6.1-sol', provider: 'openai' },
    });
    expect((await fieldAudit(w.t.db, 'agent', codex.id, 'harness')).at(-1)?.at(-1)).toBe('codex');
  });

  it('refuses a profile with only tool parts, and runs Claude Code without a profile', async () => {
    const tools = await seedProfile(w.t.db, admin.userId, { provider: null, githubRights: {} });
    const res = await as(w, admin)('POST', agentsPath(company), {
      name: 'Tools only',
      roleTitle: 'Coder',
      profileId: tools.id,
    });
    expect(res).toMatchObject(NO_AI_PART);
    const bare = await makeAgent(w, company, admin, { name: 'Bare', harness: 'codex', profileId: null });
    expect(bare).toMatchObject({ harness: 'claude_code', profile: null, runsWith: null });
  });
});

describe('hiring without a profile: the defaults', () => {
  it('takes the Claude default, else the OpenAI one, each only while it has its part', async () => {
    const hirer = await placedMember(w, company, 'admin');
    const claude = await seedProfile(w.t.db, hirer.userId, { provider: 'claude' });
    const openai = await seedProfile(w.t.db, hirer.userId, { provider: 'openai' });
    const path = defaultPath(company.companyId);
    expect((await makeAgent(w, company, hirer, { name: 'No defaults' })).profile).toBeNull();
    expect((await as(w, hirer)('PUT', path, { provider: 'openai', profileId: openai.id })).status).toBe(200);
    expect(await makeAgent(w, company, hirer, { name: 'OpenAI default' })).toMatchObject({
      harness: 'codex',
      profile: { id: openai.id },
    });
    expect((await as(w, hirer)('PUT', path, { provider: 'claude', profileId: claude.id })).status).toBe(200);
    expect(await makeAgent(w, company, hirer, { name: 'Claude default' })).toMatchObject({
      harness: 'claude_code',
      profile: { id: claude.id },
    });
    // Defaults that lost their part are passed over: none at all, then the OpenAI one.
    const tools = await seedProfile(w.t.db, hirer.userId, { provider: null, githubRights: {} });
    await putDefault(w.t.db, hirer.membershipId, openai.id, 'claude');
    await putDefault(w.t.db, hirer.membershipId, tools.id, 'openai');
    expect(await makeAgent(w, company, hirer, { name: 'Defaults without parts' })).toMatchObject({
      harness: 'claude_code',
      profile: null,
    });
    await putDefault(w.t.db, hirer.membershipId, openai.id, 'openai');
    expect(await makeAgent(w, company, hirer, { name: 'Passed over' })).toMatchObject({
      harness: 'codex',
      profile: { id: openai.id },
    });
  });

  it('refuses a default without its part', async () => {
    const hirer = await placedMember(w, company, 'admin');
    const claude = await seedProfile(w.t.db, hirer.userId, { provider: 'claude' });
    const path = defaultPath(company.companyId);
    expect(await as(w, hirer)('PUT', path, { provider: 'openai', profileId: claude.id })).toMatchObject({
      status: 422,
      body: {
        error: {
          code: 'profile_part_missing',
          message: 'This profile has no OpenAI part, so it cannot be your default for Codex agents',
        },
      },
    });
  });
});

describe('changing an agent’s profile', () => {
  it('sets the harness from the new profile, audited, and ignores a harness asked for', async () => {
    const claude = await seedProfile(w.t.db, admin.userId, { provider: 'claude' });
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const agent = await makeAgent(w, company, admin, { name: 'Switcher', profileId: claude.id });
    expect(await patchAgent(agent.id, { name: 'Switcher', harness: 'codex' })).toMatchObject({
      status: 200,
      body: { harness: 'claude_code', profile: { id: claude.id } },
    });
    const moved = await patchAgent(agent.id, { profileId: openai.id }, 'req-switch');
    expect(moved).toMatchObject({ status: 200, body: { harness: 'codex', profile: { id: openai.id } } });
    expect((await fieldAudit(w.t.db, 'agent', agent.id, 'harness')).at(-1)).toEqual([
      company.companyId,
      'update',
      admin.principalId,
      'req-switch',
      'claude_code',
      'codex',
    ]);
    const back = await patchAgent(agent.id, { profileId: claude.id });
    expect(back).toMatchObject({ status: 200, body: { harness: 'claude_code', profile: { id: claude.id } } });
  });

  it('keeps the harness when the profile is taken off, and refuses one without an AI part, writing nothing', async () => {
    const openai = await seedProfile(w.t.db, admin.userId, { provider: 'openai' });
    const agent = await makeAgent(w, company, admin, { name: 'Off', profileId: openai.id });
    const off = await patchAgent(agent.id, { profileId: null }, 'req-off');
    expect(off).toMatchObject({ status: 200, body: { harness: 'codex', profile: null } });
    const tools = await seedProfile(w.t.db, admin.userId, { provider: null, atlassianRights: {} });
    const kept = await makeAgent(w, company, admin, { name: 'Kept', profileId: openai.id });
    expect(await patchAgent(kept.id, { profileId: tools.id })).toMatchObject(NO_AI_PART);
    expect(await agentProfileOf(w.t.db, kept.id)).toBe(openai.id);
  });
});
