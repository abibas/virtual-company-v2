import { describe, expect, it } from 'vitest';
import { atlassianClient } from '../src/client.ts';
import { cursorOf } from '../src/confluence.ts';
import { adf, fakeFetch, SIGN_IN } from './fixtures/fetch.ts';

const PAGE = {
  id: '5001',
  title: 'Release notes',
  spaceId: '131073',
  parentId: '5000',
  status: 'current',
  version: { number: 4, createdAt: '2026-11-12T09:00:00Z' },
  body: { atlas_doc_format: { value: JSON.stringify(adf('Shipped v0.6.0.')) } },
  _links: { webui: '/spaces/ENG/pages/5001/Release+notes' },
};

describe('Confluence through the connector', () => {
  it('searches with CQL, the space of each hit with it, and gives the next cursor', async () => {
    const fake = fakeFetch({
      'GET /wiki/rest/api/search': {
        body: {
          results: [
            {
              content: { id: '5001', type: 'page', space: { key: 'ENG' } },
              title: 'Release @@@hl@@@notes@@@endhl@@@',
              excerpt: 'what @@@hl@@@shipped@@@endhl@@@',
              url: '/spaces/ENG/pages/5001',
              lastModified: '2026-11-12',
            },
            { title: 'A space', entityType: 'space', excerpt: '  ' },
          ],
          _links: { next: '/rest/api/search?cql=type%3Dpage&cursor=c-2&limit=25' },
        },
      },
    });
    const page = await atlassianClient({ fetch: fake.fetch }).searchConfluence(SIGN_IN, {
      cql: 'space in ("ENG") AND (type = page)',
      limit: 25,
    });
    expect(Object.fromEntries(fake.calls[0]?.url.searchParams ?? [])).toEqual({
      cql: 'space in ("ENG") AND (type = page)',
      limit: '25',
      expand: 'content.space',
    });
    expect(page).toEqual({
      items: [
        {
          id: '5001',
          type: 'page',
          title: 'Release notes',
          spaceKey: 'ENG',
          excerpt: 'what shipped',
          url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/5001',
          lastModified: '2026-11-12',
        },
        {
          id: null,
          type: 'space',
          title: 'A space',
          spaceKey: null,
          excerpt: null,
          url: null,
          lastModified: null,
        },
      ],
      cursor: 'c-2',
    });
  });

  it('reads a page with its body as Markdown, a space, the spaces by key and a space’s pages', async () => {
    const fake = fakeFetch({
      'GET /wiki/api/v2/pages/5001': { body: PAGE },
      'GET /wiki/api/v2/spaces/131073': {
        body: { id: 131073, key: 'ENG', name: 'Engineering', type: 'global' },
      },
      'GET /wiki/api/v2/spaces': {
        body: { results: [{ id: '131073', key: 'ENG', name: 'Engineering' }], _links: {} },
      },
      'GET /wiki/api/v2/spaces/131073/pages': {
        body: {
          results: [{ id: '5001', title: 'Release notes', spaceId: '131073' }],
          _links: { next: '/wiki/api/v2/spaces/131073/pages?cursor=p2' },
        },
      },
    });
    const api = atlassianClient({ fetch: fake.fetch });
    expect(await api.getPage(SIGN_IN, '5001')).toEqual({
      id: '5001',
      title: 'Release notes',
      spaceId: '131073',
      parentId: '5000',
      status: 'current',
      version: 4,
      updated: '2026-11-12T09:00:00Z',
      url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/5001/Release+notes',
      body: 'Shipped v0.6.0.',
    });
    expect(fake.calls[0]?.url.searchParams.get('body-format')).toBe('atlas_doc_format');
    expect(await api.getSpace(SIGN_IN, '131073')).toEqual({
      id: '131073',
      key: 'ENG',
      name: 'Engineering',
      type: 'global',
      url: null,
    });
    const spaces = await api.getSpaces(SIGN_IN, { keys: ['ENG', 'OPS'], limit: 25 });
    expect(fake.calls[2]?.url.searchParams.get('keys')).toBe('ENG,OPS');
    expect(spaces.cursor).toBeNull();
    const pages = await api.getPagesInSpace(SIGN_IN, '131073', {
      limit: 10,
      title: 'Release',
      sort: '-modified-date',
    });
    expect(pages.items[0]).toMatchObject({ id: '5001', version: null, parentId: null });
    expect(pages.cursor).toBe('p2');
    expect(fake.calls[3]?.url.search).toBe('?limit=10&title=Release&sort=-modified-date');
  });

  it('reads a body that is not ADF as empty', async () => {
    const fake = fakeFetch({
      'GET /wiki/api/v2/pages/1': { body: { ...PAGE, body: { atlas_doc_format: { value: '{nope' } } } },
      'GET /wiki/api/v2/pages/2': { body: { ...PAGE, body: {} } },
    });
    const api = atlassianClient({ fetch: fake.fetch });
    expect((await api.getPage(SIGN_IN, '1')).body).toBe('');
    expect((await api.getPage(SIGN_IN, '2')).body).toBe('');
  });

  it('creates a page from Markdown as ADF, or from HTML as storage, and updates one with its next version', async () => {
    const fake = fakeFetch({
      'POST /wiki/api/v2/pages': { body: PAGE },
      'PUT /wiki/api/v2/pages/5001': { body: { ...PAGE, version: { number: 5 } } },
    });
    const api = atlassianClient({ fetch: fake.fetch });
    const made = await api.createPage(SIGN_IN, {
      spaceId: '131073',
      title: 'Release notes',
      body: { format: 'markdown', text: 'Shipped.' },
      parentId: '5000',
    });
    expect(made.id).toBe('5001');
    expect(fake.calls[0]?.body).toEqual({
      spaceId: '131073',
      status: 'current',
      title: 'Release notes',
      parentId: '5000',
      body: { representation: 'atlas_doc_format', value: JSON.stringify(adf('Shipped.')) },
    });
    await api.createPage(SIGN_IN, {
      spaceId: '131073',
      title: 'T',
      body: { format: 'html', text: '<p>Hi</p>' },
    });
    expect(fake.calls[1]?.body).toMatchObject({ body: { representation: 'storage', value: '<p>Hi</p>' } });
    const updated = await api.updatePage(SIGN_IN, {
      pageId: '5001',
      title: 'Release notes',
      body: { format: 'markdown', text: 'More.' },
      version: 5,
    });
    expect(updated.version).toBe(5);
    expect(fake.calls[2]?.body).toMatchObject({ id: '5001', status: 'current', version: { number: 5 } });
  });

  it('reads a cursor only from a next link that has one', () => {
    expect(cursorOf({ _links: { next: '/wiki/api/v2/spaces?limit=2&cursor=abc%3D' } })).toBe('abc=');
    expect(cursorOf({ _links: { next: '/wiki/api/v2/spaces?limit=2' } })).toBeNull();
    expect(cursorOf({})).toBeNull();
  });
});
