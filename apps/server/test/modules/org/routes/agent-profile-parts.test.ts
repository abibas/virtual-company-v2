import { users } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { defaultRights } from '@mwc/shared/credentials';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { credentialSecrets, type StoreCredentialInput } from '../../../../src/modules/credentials/index.ts';
import { ephemeralKeyring } from '../../../../src/platform/secrets/keyring.ts';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import {
  type AgentDetailView,
  addSignIn,
  agentsPath,
  chartOf,
  makeAgent,
  noSecret,
  PROFILES,
  placedMember,
  SLACK_BOT_SCOPES,
  seedProfile,
} from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld, type Person } from '../../../fixtures/platform/auth.ts';

// An agent's profile with its parts (generic profiles since 2026-11-13): an agent holds one profile, and its view shows
// that profile's parts (what each AI part runs, who each tool part acts as, where, and its rights), never a
// subscription, its account or a secret, on the agent, the list and the chart; it follows the profile's changes.
// Agents have no tool profiles of their own any more.

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
const WIKI = { jira: 'read', jiraProjects: ['AP'], confluence: 'write', confluenceSpaces: ['ENG'] };
const CHAT = { read: true, post: true, channels: ['general'], dms: 'off', search: false, react: false };

/** A Claude setup token of the person's whose account says this email, sealed as the store does. */
const subscription = (person: Person, accountEmail: string) =>
  credentialSecrets({ db: w.t.db, keyring, clock: w.clock }).storeCredential({
    kind: 'claude_setup_token',
    secret: { token: 'sk-ant-oat01-SETUPtokenNEVERshownAGAIN_0123456789' },
    label: 'Max',
    ownerUserId: person.userId,
    accountEmail,
  } as StoreCredentialInput);

/** A Claude profile of `person`'s with a subscription and both tool parts, each with a sign-in. */
async function fullProfile(person: Person) {
  const claude = await subscription(person, 'ihorherasko@airia.test');
  const github = await addSignIn(w, keyring, person.userId, 'github_oauth');
  const atlassian = await addSignIn(w, keyring, person.userId, 'atlassian_api_token');
  const slack = await addSignIn(w, keyring, person.userId, 'slack_bot_token');
  return seedProfile(w.t.db, person.userId, {
    credentialId: claude.id,
    githubCredentialId: github.id,
    githubRights: PUSH,
    atlassianCredentialId: atlassian.id,
    atlassianRights: WIKI,
    slackCredentialId: slack.id,
    slackRights: CHAT,
  });
}

const ownerName = async (person: Person) =>
  (await rawDb(w.t.db).select().from(users).where(eq(users.id, person.userId)))[0]?.displayName;

describe('an agent’s profile with its tool parts', () => {
  it('shows the accounts and rights on the agent, the list and the chart, never a secret', async () => {
    const profile = await fullProfile(company.owner);
    const agent = await makeAgent(w, company, company.owner, { name: 'Toolbox', profileId: profile.id });
    const shown = {
      id: profile.id,
      name: profile.name,
      ownerUserId: company.owner.userId,
      ownerName: await ownerName(company.owner),
      parts: {
        claude: { model: null, effort: null, mode: 'manual' },
        openai: null,
        github: { account: 'ihor-fake', site: null, rights: PUSH },
        atlassian: { account: 'Ihor Herasko', site: 'airia-fake.atlassian.net', rights: WIKI },
        slack: {
          account: 'mw-bot',
          site: 'Airia Fake',
          rights: CHAT,
          asUser: false,
          scopes: SLACK_BOT_SCOPES,
        },
      },
    };
    expect(agent.profile).toEqual(shown);
    noSecret(agent);
    expect(JSON.stringify(agent)).not.toContain('ihorherasko@airia.test');
    const listed = await as(w, admin)('GET', agentsPath(company));
    const row = (listed.body as { agents: AgentDetailView[] }).agents.find((a) => a.id === agent.id);
    expect(row?.profile).toEqual(shown);
    const chart = await chartOf(w, company);
    const node = chart.nodes.find((n) => n.principalId === agent.principalId);
    expect(node).toMatchObject({ kind: 'agent', agent: { profile: shown } });
    noSecret(chart);
  });

  it('shows none of the parts a profile does not have', async () => {
    const plain = await seedProfile(w.t.db, company.owner.userId);
    const agent = await makeAgent(w, company, company.owner, { name: 'Plain', profileId: plain.id });
    expect(agent.profile?.parts).toEqual({
      claude: { model: null, effort: null, mode: 'manual' },
      openai: null,
      github: null,
      atlassian: null,
      slack: null,
    });
  });

  it('shows a part without a sign-in with no account, and follows the profile’s changes', async () => {
    const profile = await seedProfile(w.t.db, company.owner.userId, {
      atlassianRights: defaultRights('atlassian'),
    });
    const agent = await makeAgent(w, company, company.owner, { name: 'Unsigned', profileId: profile.id });
    expect(agent.profile?.parts.atlassian).toEqual({
      account: null,
      site: null,
      rights: defaultRights('atlassian'),
    });
    const signIn = await addSignIn(w, keyring, company.owner.userId, 'github_token');
    const change = { parts: { atlassian: null, github: { credentialId: signIn.id, rights: PUSH } } };
    expect((await as(w, company.owner)('PATCH', `${PROFILES}/${profile.id}`, change)).status).toBe(200);
    const read = await as(w, admin)('GET', agentsPath(company, agent.id));
    expect((read.body as AgentDetailView).profile?.parts).toMatchObject({
      github: { account: 'ihor-pat', site: null, rights: PUSH },
      atlassian: null,
    });
  });

  it('takes no tool profiles of an agent’s own any more: the old fields are not part of an agent', async () => {
    const profile = await fullProfile(company.owner);
    const agent = await makeAgent(w, company, company.owner, {
      name: 'Old fields',
      profileId: null,
      githubProfileId: profile.id,
      atlassianProfileId: profile.id,
    });
    expect(agent).not.toHaveProperty('githubProfile');
    expect(agent).not.toHaveProperty('atlassianProfile');
    expect(agent.profile).toBeNull();
  });
});
