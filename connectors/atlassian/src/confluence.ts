import type {
  AtlassianApi,
  AtlassianSignIn,
  ConfluenceHit,
  ConfluencePage,
  ConfluencePageRef,
  ConfluenceSpace,
  Paged,
} from '@mwc/tools-core';
import { adfToMarkdown } from './adf/to-markdown.ts';
import { confluenceBody } from './body.ts';
import type { Call, Request } from './http.ts';

/**
 * Confluence Cloud for the port (S7.1c): search with CQL (the v1 `/wiki/rest/api/search`, the only search there is, its
 * hits with their space's key), and the v2 API for a page (its body as ADF, given as Markdown), a space, the spaces,
 * a space's pages, and a new page or a page's next version. Cursors come from each answer's `_links.next`. No call here
 * deletes or archives anything.
 */

type Raw = Readonly<Record<string, unknown>>;
const recordOf = (value: unknown): Raw => (typeof value === 'object' && value !== null ? (value as Raw) : {});
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : null;

/** The cursor of the next page, from an answer's `_links.next` (a relative address with `cursor=`). */
export function cursorOf(raw: Raw): string | null {
  const next = textOf(recordOf(raw._links).next);
  if (next === null) return null;
  return new URL(next, 'https://x.invalid').searchParams.get('cursor');
}

/** A web address under the site's `/wiki`, from a relative `webui` link. */
const webOf = (site: string, link: unknown): string | null => {
  const path = textOf(link);
  return path === null ? null : `https://${site}/wiki${path.startsWith('/') ? path : `/${path}`}`;
};

function spaceOf(raw: unknown, site: string): ConfluenceSpace {
  const space = recordOf(raw);
  return {
    id: textOf(space.id) ?? '',
    key: textOf(space.key) ?? '',
    name: textOf(space.name) ?? '',
    type: textOf(space.type),
    url: webOf(site, recordOf(space._links).webui),
  };
}

function pageRefOf(raw: unknown, site: string): ConfluencePageRef {
  const page = recordOf(raw);
  const version = recordOf(page.version);
  return {
    id: textOf(page.id) ?? '',
    title: textOf(page.title) ?? '',
    spaceId: textOf(page.spaceId) ?? '',
    parentId: textOf(page.parentId),
    status: textOf(page.status),
    version: typeof version.number === 'number' ? version.number : null,
    updated: textOf(version.createdAt) ?? textOf(page.createdAt),
    url: webOf(site, recordOf(page._links).webui),
  };
}

/** A page's body: its `atlas_doc_format` value (ADF's JSON text) as Markdown. */
function pageBodyOf(page: Raw): string {
  const value = recordOf(recordOf(page.body).atlas_doc_format).value;
  if (typeof value !== 'string') return '';
  try {
    return adfToMarkdown(JSON.parse(value));
  } catch {
    return '';
  }
}

/** Confluence's marks around the matched words in a hit's title and excerpt (`@@@hl@@@`), which go. */
const unmarked = (text: string | null) => text?.replace(/@@@(?:end)?hl@@@/g, '') ?? null;

/** A search hit. */
function hitOf(raw: unknown, site: string): ConfluenceHit {
  const hit = recordOf(raw);
  const content = recordOf(hit.content);
  const excerpt = unmarked(textOf(hit.excerpt));
  return {
    id: textOf(content.id),
    type: textOf(content.type) ?? textOf(hit.entityType),
    title: unmarked(textOf(hit.title) ?? textOf(content.title)) ?? '',
    spaceKey: textOf(recordOf(content.space).key),
    excerpt: excerpt?.trim() || null,
    url: webOf(site, hit.url),
    lastModified: textOf(hit.lastModified),
  };
}

const paged = <T>(raw: unknown, item: (value: unknown) => T): Paged<T> => {
  const record = recordOf(raw);
  return { items: listOf(record.results).map(item), cursor: cursorOf(record) };
};

type ConfluenceApi = Pick<
  AtlassianApi,
  'searchConfluence' | 'getPage' | 'getSpace' | 'getSpaces' | 'getPagesInSpace' | 'createPage' | 'updatePage'
>;

const pagePath = (pageId: string) => `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`;

/** The Confluence half of the port on `request`. */
export function confluenceApi(request: Request): ConfluenceApi {
  const wiki = (signIn: AtlassianSignIn, call: Omit<Call, 'product'>) =>
    request(signIn, { product: 'Confluence', ...call });
  return {
    async searchConfluence(signIn, query) {
      const raw = await wiki(signIn, {
        method: 'GET',
        path: '/wiki/rest/api/search',
        query: { cql: query.cql, limit: query.limit, cursor: query.cursor, expand: 'content.space' },
      });
      return paged(raw, (hit) => hitOf(hit, signIn.site));
    },
    async getPage(signIn, pageId): Promise<ConfluencePage> {
      const raw = recordOf(
        await wiki(signIn, {
          method: 'GET',
          path: pagePath(pageId),
          query: { 'body-format': 'atlas_doc_format' },
        }),
      );
      return { ...pageRefOf(raw, signIn.site), body: pageBodyOf(raw) };
    },
    async getSpace(signIn, spaceId) {
      const path = `/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}`;
      return spaceOf(await wiki(signIn, { method: 'GET', path }), signIn.site);
    },
    async getSpaces(signIn, query) {
      const keys = query.keys === undefined ? undefined : query.keys.join(',');
      const raw = await wiki(signIn, {
        method: 'GET',
        path: '/wiki/api/v2/spaces',
        query: { keys, limit: query.limit, cursor: query.cursor },
      });
      return paged(raw, (space) => spaceOf(space, signIn.site));
    },
    async getPagesInSpace(signIn, spaceId, query) {
      const raw = await wiki(signIn, {
        method: 'GET',
        path: `/wiki/api/v2/spaces/${encodeURIComponent(spaceId)}/pages`,
        query: { limit: query.limit, cursor: query.cursor, title: query.title, sort: query.sort },
      });
      return paged(raw, (page) => pageRefOf(page, signIn.site));
    },
    async createPage(signIn, page) {
      const body = {
        spaceId: page.spaceId,
        status: 'current',
        title: page.title,
        ...(page.parentId === undefined ? {} : { parentId: page.parentId }),
        body: confluenceBody(page.body),
      };
      return pageRefOf(await wiki(signIn, { method: 'POST', path: '/wiki/api/v2/pages', body }), signIn.site);
    },
    async updatePage(signIn, page) {
      const body = {
        id: page.pageId,
        status: 'current',
        title: page.title,
        body: confluenceBody(page.body),
        version: { number: page.version },
      };
      return pageRefOf(await wiki(signIn, { method: 'PUT', path: pagePath(page.pageId), body }), signIn.site);
    },
  };
}
