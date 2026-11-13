import { agents } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { TEST_NOW } from '@mwc/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runnerTooOldLine } from '../../../../../src/modules/chats/service/server-tools.ts';
import {
  CONFLUENCE_READ_TOOLS,
  CONFLUENCE_WRITE_TOOLS,
  JIRA_CHANGE_TOOLS,
  JIRA_READ_TOOLS,
} from '../../../../../src/modules/integrations/schemas/atlassian.ts';
import {
  type ChatsWorld,
  chatPath,
  chatsWorld,
  type Scene,
  scene,
  startedTurn,
} from '../../../../fixtures/chats/world.ts';
import {
  atlassianScene,
  atlassianTurn,
  putAtlassianPart,
  serverToolNames,
} from '../../../../fixtures/integrations/atlassian.ts';
import { as } from '../../../../fixtures/members/members.ts';

/** The Atlassian tools a turn is offered (S7.1c): by its profile's Atlassian part, to a runner that takes them. */

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const LINE =
  'Atlassian tools (from Most Wanted): on airia-fake.atlassian.net as Ihor Herasko, Jira: read issues in AP; ' +
  'Confluence: read pages in ENG.';

describe('the Atlassian tools a turn gets', () => {
  it('Claude Code: the read tools for read rights, whole, with one line at the end of its instructions', async () => {
    const s = await atlassianScene(w);
    const start = await atlassianTurn(w, s);
    expect(serverToolNames(start)).toEqual([...JIRA_READ_TOOLS, ...CONFLUENCE_READ_TOOLS]);
    const search = start.spec.serverTools?.[0];
    expect(search).toMatchObject({
      name: 'searchJiraIssuesUsingJql',
      title: 'Search Jira issues',
      readOnly: true,
    });
    expect(search?.inputSchema).toMatchObject({ type: 'object', required: ['jql'] });
    expect(JSON.stringify(start.spec.serverTools)).not.toContain('ATLASSIANtoken');
    const last = start.spec.instructions?.split('\n\n').at(-1) ?? '';
    expect(last.startsWith(LINE)).toBe(true);
    expect(last).toContain('searchJiraIssuesUsingJql, getJiraIssue, getTransitionsForJiraIssue');
    expect(last).toContain('cloudId is not needed; they never delete or archive.');
    expect(start.spec.tools).toBeUndefined();
  });

  it('Codex: the same tools in its spec, through the same bridge', async () => {
    const s = await atlassianScene(w, { harness: 'codex' });
    const start = await atlassianTurn(w, s);
    expect(start.spec.harness).toBe('codex');
    expect(serverToolNames(start)).toEqual([...JIRA_READ_TOOLS, ...CONFLUENCE_READ_TOOLS]);
  });

  it('adds Jira’s changes and Confluence’s writes only with those rights', async () => {
    const s = await atlassianScene(w, { rights: { jira: 'changes', confluence: 'write' } });
    const start = await atlassianTurn(w, s);
    expect(serverToolNames(start)).toEqual([
      ...JIRA_READ_TOOLS,
      ...JIRA_CHANGE_TOOLS,
      ...CONFLUENCE_READ_TOOLS,
      ...CONFLUENCE_WRITE_TOOLS,
    ]);
    const comment = start.spec.serverTools?.find((tool) => tool.name === 'addCommentToJiraIssue');
    expect(comment?.readOnly).toBe(false);
    expect(start.spec.instructions).toContain(
      'Jira: read, comment on, transition, create and edit issues in AP; Confluence: read, create and update pages in ENG.',
    );
  });

  it('gives a product off, or one with no project or space chosen, no tools', async () => {
    const jiraOnly = await atlassianScene(w, { rights: { confluence: 'off', jiraProjects: 'all' } });
    const start = await atlassianTurn(w, jiraOnly);
    expect(serverToolNames(start)).toEqual([...JIRA_READ_TOOLS]);
    expect(start.spec.instructions).toContain('Jira: read issues in every project; Confluence: off.');
    const none = await atlassianScene(w, { rights: { jira: 'off', confluenceSpaces: [] } });
    expect((await atlassianTurn(w, none)).spec.serverTools).toBeUndefined();
  });

  it('gives none without an Atlassian part, without a sign-in, or to a runner that does not take them', async () => {
    const plain = await scene(w, { caps: { serverTools: true } });
    expect((await startedTurn(w, plain)).spec.serverTools).toBeUndefined();
    const unsigned = await atlassianScene(w, { noSignIn: true });
    expect((await atlassianTurn(w, unsigned)).spec.serverTools).toBeUndefined();
    const older = await atlassianScene(w, { caps: { serverTools: false } });
    const start = await atlassianTurn(w, older);
    expect(start.spec.serverTools).toBeUndefined();
    expect(start.spec.instructions).not.toContain('Atlassian tools (from Most Wanted)');
  });

  it('reads the part again for each turn: one taken off gives the next turn none', async () => {
    const s = await atlassianScene(w);
    expect(serverToolNames(await atlassianTurn(w, s))).toHaveLength(9);
    await w.disconnectAll();
    const again = await atlassianScene(w);
    await putAtlassianPart(w.t.db, again.profile.id, { credentialId: null, rights: null });
    expect((await atlassianTurn(w, again)).spec.serverTools).toBeUndefined();
  });
});

/** The chat's detail as its owner reads it: what waits for its runner's update. */
async function runnerUpdateOf(s: Scene): Promise<unknown> {
  const res = await as(w, s.company.owner)('GET', chatPath(s.company, s.chat.id));
  expect(res.status).toBe(200);
  return (res.body as { runnerUpdateFor: unknown }).runnerUpdateFor;
}

describe('the Atlassian tools on a runner too old for them', () => {
  const OLD = { caps: { serverTools: false } } as const;

  it('tells the turn plainly that its tools are not on this machine, and gives it none', async () => {
    const s = await atlassianScene(w, { ...OLD, rights: { jira: 'changes', confluence: 'write' } });
    const start = await atlassianTurn(w, s);
    expect(start.spec.serverTools).toBeUndefined();
    expect(start.spec.instructions?.split('\n\n').at(-1)).toBe(runnerTooOldLine('Jira and Confluence'));
    expect(start.spec.instructions).toContain('Jira and Confluence: configured, but this machine');
  });

  it('names only the products its rights reach, and says nothing for a profile without tools', async () => {
    const jira = await atlassianScene(w, { ...OLD, rights: { confluence: 'off' } });
    expect((await atlassianTurn(w, jira)).spec.instructions).toContain(runnerTooOldLine('Jira'));
    await w.disconnectAll();
    const plain = await scene(w, OLD);
    expect((await startedTurn(w, plain)).spec.instructions).not.toContain('runner is too old');
  });

  it('shows the chat what waits for its runner’s update, and nothing once the runner takes the tools', async () => {
    const old = await atlassianScene(w, OLD);
    expect(await runnerUpdateOf(old)).toBe('Jira and Confluence');
    await w.disconnectAll();
    expect(await runnerUpdateOf(old)).toBeNull();
    const current = await atlassianScene(w);
    expect(await runnerUpdateOf(current)).toBeNull();
  });

  it('shows nothing for a profile without tools, or an agent with no profile', async () => {
    const plain = await scene(w, OLD);
    expect(await runnerUpdateOf(plain)).toBeNull();
    await w.disconnectAll();
    const none = await atlassianScene(w, OLD);
    await rawDb(w.t.db).update(agents).set({ profileId: null }).where(eq(agents.id, none.agentId));
    expect(await runnerUpdateOf(none)).toBeNull();
  });
});
