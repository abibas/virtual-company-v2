import type { AtlassianRights } from '@mwc/shared/credentials';
import type { TurnStart } from '@mwc/shared/runner-protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld } from '../../../../fixtures/chats/world.ts';
import { json } from '../../../../fixtures/credentials/providers.ts';
import {
  type AtlassianScene,
  answerOf,
  atlassianScene,
  atlassianTurn,
  callTool,
  principalOf,
  putAtlassianPart,
  toolAudit,
  WIKI,
} from '../../../../fixtures/integrations/atlassian.ts';

/**
 * The Confluence tools through a live turn (S7.1c): scoped to the profile's spaces by key (a page's space and a space's
 * key read first), writes only with `write`, a page updated as its next version over the one the agent read, each write
 * audited as the agent. One turn serves every test; the part is changed between calls.
 */

let w: ChatsWorld;
let s: AtlassianScene;
let start: TurnStart;
const WRITE: AtlassianRights = {
  jira: 'off',
  jiraProjects: [],
  confluence: 'write',
  confluenceSpaces: ['ENG'],
};
const V2 = `${WIKI}/api/v2`;

const rights = (changed: Partial<AtlassianRights>) =>
  putAtlassianPart(w.t.db, s.profile.id, { credentialId: s.signIn.id, rights: { ...WRITE, ...changed } });

const page = (id: string, spaceId: string, version = 4) => ({
  id,
  title: 'Release notes',
  spaceId,
  status: 'current',
  version: { number: version },
  body: {
    atlas_doc_format: {
      value: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Shipped.' }] }],
      }),
    },
  },
});

/** Confluence's spaces: 100 is ENG, 200 is OPS. */
function spaces() {
  w.provider.route('GET', `${V2}/spaces/100`, json(200, { id: '100', key: 'ENG', name: 'Engineering' }));
  w.provider.route('GET', `${V2}/spaces/200`, json(200, { id: '200', key: 'OPS', name: 'Operations' }));
}

beforeAll(async () => {
  w = await chatsWorld();
});
let made: Promise<void> | undefined;
beforeEach(async () => {
  made ??= (async () => {
    s = await atlassianScene(w, { rights: WRITE });
    start = await atlassianTurn(w, s, 'Write the release notes');
  })();
  await made;
  spaces();
}, 20_000);
afterEach(async () => {
  w.provider.reset();
  await rights({});
});
afterAll(async () => {
  await w.disconnectAll();
  await w.close();
});

describe('the Confluence read tools', () => {
  it('searchConfluenceUsingCql ANDs the CQL with the profile’s spaces and drops hits from others', async () => {
    w.provider.route(
      'GET',
      `${WIKI}/rest/api/search`,
      json(200, {
        results: [
          { content: { id: '1', type: 'page', space: { key: 'ENG' } }, title: 'In' },
          { content: { id: '2', type: 'page', space: { key: 'OPS' } }, title: 'Out' },
        ],
        _links: { next: '/rest/api/search?cursor=c2' },
      }),
    );
    const result = await callTool(s, start, 'searchConfluenceUsingCql', {
      cql: 'type = page order by created',
    });
    const cql = 'space in ("ENG") AND (type = page) order by created';
    expect(answerOf(result)).toMatchObject({ cql, cursor: 'c2' });
    expect((answerOf(result).results as { title: string }[]).map((hit) => hit.title)).toEqual(['In']);
    expect(new URL(w.provider.calls[0]?.url ?? '').searchParams.get('cql')).toBe(cql);
    const bad = await callTool(s, start, 'searchConfluenceUsingCql', { cql: 'title ~ "open' });
    expect(bad.text).toBe('The CQL cannot be used as written: a quoted text in it never ends.');
  });

  it('getConfluencePage reads a page of the profile’s spaces as Markdown, and refuses one in another', async () => {
    w.provider.route('GET', `${V2}/pages/5001`, json(200, page('5001', '100')));
    w.provider.route('GET', `${V2}/pages/6001`, json(200, page('6001', '200')));
    const read = await callTool(s, start, 'getConfluencePage', { pageId: '5001' });
    expect(answerOf(read)).toMatchObject({
      id: '5001',
      title: 'Release notes',
      version: 4,
      body: 'Shipped.',
    });
    const outside = await callTool(s, start, 'getConfluencePage', { pageId: '6001' });
    expect(outside.text).toBe(
      "Page 6001 is in space OPS, outside the Confluence spaces this agent's profile reaches (ENG).",
    );
  });

  it('getConfluenceSpaces asks only for the profile’s spaces; getPagesInConfluenceSpace checks the space', async () => {
    w.provider.route(
      'GET',
      `${V2}/spaces`,
      json(200, { results: [{ id: '100', key: 'ENG', name: 'Engineering' }] }),
    );
    w.provider.route(
      'GET',
      `${V2}/spaces/100/pages`,
      json(200, { results: [{ id: '5001', title: 'Notes' }] }),
    );
    const listed = await callTool(s, start, 'getConfluenceSpaces', {});
    expect(answerOf(listed)).toMatchObject({ spaces: [{ id: '100', key: 'ENG' }] });
    expect(new URL(w.provider.calls[0]?.url ?? '').searchParams.get('keys')).toBe('ENG');
    expect(answerOf(await callTool(s, start, 'getConfluenceSpaces', { keys: 'OPS' }))).toEqual({
      spaces: [],
    });
    const pages = await callTool(s, start, 'getPagesInConfluenceSpace', { spaceId: '100', limit: 5 });
    expect(answerOf(pages)).toMatchObject({ pages: [{ id: '5001', title: 'Notes' }] });
    const other = await callTool(s, start, 'getPagesInConfluenceSpace', { spaceId: '200' });
    expect(other.ok).toBe(false);
  });

  it('every space: no scope added, no space read', async () => {
    await rights({ confluenceSpaces: 'all' });
    w.provider.route('GET', `${V2}/pages/6001`, json(200, page('6001', '200')));
    w.provider.route('GET', `${V2}/spaces`, json(200, { results: [{ id: '200', key: 'OPS' }] }));
    expect((await callTool(s, start, 'getConfluencePage', { pageId: '6001' })).ok).toBe(true);
    expect((await callTool(s, start, 'getConfluenceSpaces', { keys: ['OPS'] })).ok).toBe(true);
    expect(w.provider.calls.map((call) => call.url.split('?')[0])).toEqual([
      `${V2}/pages/6001`,
      `${V2}/spaces`,
    ]);
  });
});

describe('the Confluence write tools', () => {
  it('are refused while Confluence only reads, or is off', async () => {
    await rights({ confluence: 'read' });
    const create = { spaceId: '100', title: 'T', body: '<p>x</p>' };
    expect((await callTool(s, start, 'createConfluencePage', create)).text).toBe(
      "Confluence writing is off for this agent's profile: it may only read.",
    );
    await rights({ confluence: 'off' });
    expect((await callTool(s, start, 'getConfluencePage', { pageId: '1' })).text).toBe(
      "Confluence is off for this agent's profile.",
    );
    await rights({ confluenceSpaces: [] });
    expect((await callTool(s, start, 'getConfluencePage', { pageId: '1' })).text).toBe(
      "This agent's profile reaches no Confluence space.",
    );
  });

  it('createConfluencePage writes in a space of the profile’s, by id or key, and is audited', async () => {
    w.provider.route('GET', `${V2}/spaces`, json(200, { results: [{ id: '100', key: 'ENG' }] }));
    w.provider.route('POST', `${V2}/pages`, json(200, page('7001', '100', 1)));
    const made = await callTool(s, start, 'createConfluencePage', {
      spaceId: 'ENG',
      title: 'Release notes',
      body: '# Notes',
      contentFormat: 'markdown',
      parentId: '5000',
    });
    expect(answerOf(made)).toMatchObject({ created: { id: '7001', version: 1 } });
    const post = w.provider.calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({
      spaceId: '100',
      parentId: '5000',
      body: { representation: 'atlas_doc_format' },
    });
    const agent = await principalOf(w.t.db, s.agentId);
    expect(await toolAudit(w.t.db, 'confluence_page', '7001')).toEqual([
      ['tool:createConfluencePage', agent, start.turnId, 'space', 'ENG'],
      ['tool:createConfluencePage', agent, start.turnId, 'title', 'Release notes'],
      ['tool:createConfluencePage', agent, start.turnId, 'version', 1],
    ]);
    const outside = await callTool(s, start, 'createConfluencePage', {
      spaceId: '200',
      title: 'T',
      body: 'x',
    });
    expect(outside.text).toBe(
      "The new page is in space OPS, outside the Confluence spaces this agent's profile reaches (ENG).",
    );
    w.provider.route('GET', `${V2}/spaces`, json(200, { results: [] }));
    const none = await callTool(s, start, 'createConfluencePage', { spaceId: 'NOPE', title: 'T', body: 'x' });
    expect(none.text).toBe('Confluence has no space NOPE the account can see.');
  });

  it('updateConfluencePage writes the next version over the one read, never over a newer one', async () => {
    w.provider.route('GET', `${V2}/pages/5001`, json(200, page('5001', '100', 4)));
    w.provider.route('PUT', `${V2}/pages/5001`, json(200, page('5001', '100', 5)));
    const stale = await callTool(s, start, 'updateConfluencePage', {
      pageId: '5001',
      body: '<p>x</p>',
      version: 2,
    });
    expect(stale.text).toMatch(/^Page 5001 is at version 4 now, not 2: it changed since you read it\./);
    const moved = await callTool(s, start, 'updateConfluencePage', {
      pageId: '5001',
      body: 'x',
      spaceId: '200',
    });
    expect(moved.text).toBe('Moving a page to another space is not offered.');
    const result = await callTool(s, start, 'updateConfluencePage', {
      pageId: '5001',
      title: 'Notes v2',
      body: '<p>More.</p>',
      version: 4,
    });
    expect(answerOf(result)).toMatchObject({ updated: { id: '5001', version: 5 } });
    const put = w.provider.calls.find((call) => call.method === 'PUT');
    expect(put?.body).toMatchObject({
      title: 'Notes v2',
      version: { number: 5 },
      body: { representation: 'storage', value: '<p>More.</p>' },
    });
    const fields = (await toolAudit(w.t.db, 'confluence_page', '5001')).map((row) => [row[3], row[4]]);
    expect(fields).toEqual([
      ['version', 5],
      ['title', 'Notes v2'],
    ]);
  });
});
