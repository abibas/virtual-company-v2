import { agents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runnerTooOldLine } from '../../../../../src/modules/chats/service/server-tools.ts';
import {
  CONFLUENCE_READ_TOOLS,
  JIRA_READ_TOOLS,
} from '../../../../../src/modules/integrations/schemas/atlassian.ts';
import {
  GITHUB_PR_TOOLS,
  GITHUB_READ_TOOLS,
} from '../../../../../src/modules/integrations/schemas/github.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  type Scene,
  turnRow,
  usesOf,
} from '../../../../fixtures/chats/world.ts';
import { putAtlassianPart, READ_AP } from '../../../../fixtures/integrations/atlassian.ts';
import {
  type GitHubScene,
  type GitHubSceneOptions,
  githubScene,
  githubTurn,
  serverToolNames,
  TOKEN,
} from '../../../../fixtures/integrations/github.ts';
import { as } from '../../../../fixtures/members/members.ts';
import { addSignIn, revokeSubscription } from '../../../../fixtures/org.ts';

/**
 * The GitHub tools a turn is offered (S7.1d), by its profile's GitHub part, to a runner that takes them; and the sign-in
 * for git and gh, which goes in the spec only when the part may push and the runner says `caps.github`.
 */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const lastLine = (instructions: string | undefined) => instructions?.split('\n\n').at(-1) ?? '';
const gitUses = async (s: GitHubScene) =>
  (await usesOf(w.t.db, s.signIn.id)).filter((use) => use.purpose === 'tool:git');

describe('the GitHub tools a turn gets', () => {
  it('reads and pull requests with those rights, and the sign-in for git with push, used for tool:git', async () => {
    const s = await githubScene(w);
    const start = await githubTurn(w, s);
    expect(serverToolNames(start)).toEqual([...GITHUB_READ_TOOLS, ...GITHUB_PR_TOOLS]);
    expect(start.spec.github).toEqual({ token: TOKEN, repos: ['airiallc/*', 'abibas/sandbox'] });
    const line = lastLine(start.spec.instructions);
    expect(line).toMatch(
      /^GitHub tools \(from Most Wanted\): as ihor-fake, in AiriaLLC\/\*, abibas\/sandbox: read/,
    );
    expect(line).toContain('git and gh on this machine use this sign-in in this turn (GH_TOKEN;');
    const turn = await turnRow(w.t.db, start.turnId);
    expect(await gitUses(s)).toMatchObject([
      { companyId: s.company.companyId, agentId: s.agentId, chatId: s.chat.id, principalId: turn?.createdBy },
    ]);
    expect(JSON.stringify(turn)).not.toContain('GHLOGINtoken');
    expect(JSON.stringify(start.spec.serverTools)).not.toContain('GHLOGINtoken');
  });

  it('Codex gets them too, through the same bridge', async () => {
    const s = await githubScene(w, { harness: 'codex', rights: { repos: 'all' } });
    const start = await githubTurn(w, s);
    expect(start.spec.harness).toBe('codex');
    expect(start.spec.github).toEqual({ token: TOKEN, repos: 'all' });
  });

  it('reads only without pullRequests, and git gets no sign-in without push', async () => {
    const s = await githubScene(w, { rights: { push: false, pullRequests: false } });
    const start = await githubTurn(w, s);
    expect(serverToolNames(start)).toEqual([...GITHUB_READ_TOOLS]);
    expect(start.spec.github).toBeUndefined();
    expect(lastLine(start.spec.instructions)).toContain('Pushing is off for this profile');
    expect(await gitUses(s)).toEqual([]);
  });

  it('gives no sign-in to a runner that cannot take it, saying so, and the chat names what waits', async () => {
    const s = await githubScene(w, { caps: { github: false } });
    const start = await githubTurn(w, s);
    expect(serverToolNames(start)).toHaveLength(14);
    expect(start.spec.github).toBeUndefined();
    expect(lastLine(start.spec.instructions)).toContain(
      "this machine's runner is too old to give git and gh",
    );
    expect(await gitUses(s)).toEqual([]);
    expect(await runnerUpdateOf(s)).toBe('git push');
  });

  it('says the sign-in could not be opened for git, and sends none', async () => {
    const s = await githubScene(w);
    await revokeSubscription(w.t.db, s.signIn.id);
    const start = await githubTurn(w, s);
    expect(start.spec.github).toBeUndefined();
    expect(lastLine(start.spec.instructions)).toContain(
      'Pushing: the sign-in could not be opened for git now. The GitHub sign-in of this agent',
    );
  });

  it('gives nothing without a part, a sign-in, or a repository reached', async () => {
    const cases: GitHubSceneOptions[] = [{ rights: null }, { noSignIn: true }, { rights: { repos: [] } }];
    for (const options of cases) {
      const s = await githubScene(w, options);
      const start = await githubTurn(w, s);
      expect(start.spec.serverTools).toBeUndefined();
      expect(start.spec.github).toBeUndefined();
      await w.disconnectAll();
    }
  });

  it('sits after the Atlassian tools when the profile has both parts, with both lines', async () => {
    const s = await githubScene(w);
    const atlassian = await addSignIn(w, w.keyring, s.company.owner.userId, 'atlassian_api_token');
    await putAtlassianPart(w.t.db, s.profile.id, { credentialId: atlassian.id, rights: READ_AP });
    const start = await githubTurn(w, s);
    expect(serverToolNames(start)).toEqual([
      ...JIRA_READ_TOOLS,
      ...CONFLUENCE_READ_TOOLS,
      ...GITHUB_READ_TOOLS,
      ...GITHUB_PR_TOOLS,
    ]);
    const [atlassianLine, githubLine] = lastLine(start.spec.instructions).split('\n');
    expect(atlassianLine).toMatch(/^Atlassian tools/);
    expect(githubLine).toMatch(/^GitHub tools/);
  });
});

/** The chat's detail as its owner reads it: what waits for its runner's update. */
async function runnerUpdateOf(s: Scene): Promise<unknown> {
  const res = await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id));
  expect(res.status).toBe(200);
  return (res.body as { runnerUpdateFor: unknown }).runnerUpdateFor;
}

describe('the GitHub tools on a runner too old for the server’s tools', () => {
  const OLD = { caps: { serverTools: false, github: false } } as const;

  it('tells the turn plainly, with the Atlassian tools’ products too, and gives no sign-in', async () => {
    const s = await githubScene(w, OLD);
    const atlassian = await addSignIn(w, w.keyring, s.company.owner.userId, 'atlassian_api_token');
    await putAtlassianPart(w.t.db, s.profile.id, { credentialId: atlassian.id, rights: READ_AP });
    const start = await githubTurn(w, s);
    expect(start.spec.serverTools).toBeUndefined();
    expect(start.spec.github).toBeUndefined();
    expect(lastLine(start.spec.instructions)).toBe(runnerTooOldLine('Jira, Confluence and GitHub'));
    expect(await runnerUpdateOf(s)).toBe('Jira, Confluence and GitHub');
  });

  it('names nothing for a runner that takes both, a profile without a part, or an agent with no profile', async () => {
    expect(await runnerUpdateOf(await githubScene(w))).toBeNull();
    await w.disconnectAll();
    const pushless = await githubScene(w, { caps: { github: false }, rights: { push: false } });
    expect(await runnerUpdateOf(pushless)).toBeNull();
    await w.disconnectAll();
    const none = await githubScene(w, { ...OLD, rights: null });
    expect(await runnerUpdateOf(none)).toBeNull();
    await rawDb(w.t.db).update(agents).set({ profileId: null }).where(eq(agents.id, none.agentId));
    expect(await runnerUpdateOf(none)).toBeNull();
  });
});
