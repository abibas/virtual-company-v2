import type { TextBody } from '@mwc/tools-core';
import { scopedQuery } from '../../rules/atlassian/query.ts';
import { pageView } from '../../rules/atlassian/render.ts';
import { inScope, outsideSpaces } from '../../rules/atlassian/rights.ts';
import type {
  AtlassianInput,
  CONFLUENCE_READ_TOOLS,
  CONFLUENCE_WRITE_TOOLS,
} from '../../schemas/atlassian.ts';
import { done, refused, spaceKeyOf, spaceRefusal, type ToolContext, type ToolReply } from './context.ts';

/**
 * The Confluence tools (S7.1c): each checks the profile's spaces (by key) before it answers or writes: a search is scoped
 * with `space in (…)` and hits from another space are dropped; a page's space, a space's key are read first. A page is
 * written as its next version, never over a version the agent did not read. Each write is audited as the agent.
 * Nothing deletes.
 */

/** The results a list gives when not told. */
export const LIST_MAX = 25;

type ConfluenceTool = (typeof CONFLUENCE_READ_TOOLS)[number] | (typeof CONFLUENCE_WRITE_TOOLS)[number];

const pageBody = (body: string, format: 'html' | 'markdown' | 'adf' | undefined): TextBody => ({
  format: format ?? 'html',
  text: body,
});

async function search(ctx: ToolContext, input: AtlassianInput<'searchConfluenceUsingCql'>) {
  const scope = ctx.rights.confluenceSpaces;
  const cql = scopedQuery(input.cql, 'space', scope, 'CQL');
  if (!cql.ok) return refused(cql.error);
  const page = await ctx.api.searchConfluence(ctx.signIn, {
    cql: cql.query,
    limit: input.limit ?? LIST_MAX,
    cursor: input.cursor,
  });
  const results = page.items.filter((hit) => hit.spaceKey === null || inScope(scope, hit.spaceKey));
  return done({ cql: cql.query, results, ...(page.cursor === null ? {} : { cursor: page.cursor }) });
}

async function getPage(ctx: ToolContext, input: AtlassianInput<'getConfluencePage'>) {
  const page = await ctx.api.getPage(ctx.signIn, input.pageId);
  const outside = await spaceRefusal(ctx, `Page ${input.pageId}`, page.spaceId);
  return outside === undefined ? done(pageView(page)) : refused(outside);
}

/** The keys a spaces list asks for: those given (a list or comma-separated) within the scope, else the scope's. */
function keysOf(given: string | readonly string[] | undefined, scope: 'all' | readonly string[]) {
  const asked = (typeof given === 'string' ? given.split(',') : (given ?? []))
    .map((key) => key.trim())
    .filter((key) => key !== '');
  if (scope === 'all') return asked.length === 0 ? undefined : asked;
  return asked.length === 0 ? [...scope] : asked.filter((key) => scope.includes(key));
}

async function spaces(ctx: ToolContext, input: AtlassianInput<'getConfluenceSpaces'>) {
  const scope = ctx.rights.confluenceSpaces;
  const keys = keysOf(input.keys, scope);
  if (keys !== undefined && keys.length === 0) return done({ spaces: [] });
  const page = await ctx.api.getSpaces(ctx.signIn, {
    keys,
    limit: input.limit ?? LIST_MAX,
    cursor: input.cursor,
  });
  const found = page.items.filter((space) => inScope(scope, space.key));
  return done({ spaces: found, ...(page.cursor === null ? {} : { cursor: page.cursor }) });
}

async function pagesIn(ctx: ToolContext, input: AtlassianInput<'getPagesInConfluenceSpace'>) {
  const outside = await spaceRefusal(ctx, `Space ${input.spaceId}`, input.spaceId);
  if (outside !== undefined) return refused(outside);
  const page = await ctx.api.getPagesInSpace(ctx.signIn, input.spaceId, {
    limit: input.limit ?? LIST_MAX,
    cursor: input.cursor,
    title: input.title,
    sort: input.sort,
  });
  return done({ pages: page.items, ...(page.cursor === null ? {} : { cursor: page.cursor }) });
}

/** A space named by its id or its key: both, read from Confluence; undefined when there is none such. */
async function spaceNamed(ctx: ToolContext, idOrKey: string) {
  if (/^\d+$/.test(idOrKey)) return { id: idOrKey, key: await spaceKeyOf(ctx, idOrKey) };
  const [space] = (await ctx.api.getSpaces(ctx.signIn, { keys: [idOrKey], limit: 1 })).items;
  return space && { id: space.id, key: space.key };
}

async function create(ctx: ToolContext, input: AtlassianInput<'createConfluencePage'>) {
  const scope = ctx.rights.confluenceSpaces;
  const space = await spaceNamed(ctx, input.spaceId);
  if (space === undefined) return refused(`Confluence has no space ${input.spaceId} the account can see.`);
  if (!inScope(scope, space.key)) return refused(outsideSpaces('The new page', space.key, scope as string[]));
  const made = await ctx.api.createPage(ctx.signIn, {
    spaceId: space.id,
    title: input.title,
    body: pageBody(input.body, input.contentFormat),
    parentId: input.parentId,
  });
  await ctx.audit({
    entityType: 'confluence_page',
    entityId: made.id,
    changes: [
      { field: 'space', new: space.key },
      { field: 'title', new: input.title },
      { field: 'version', new: made.version },
    ],
  });
  return done({ created: made });
}

async function update(ctx: ToolContext, input: AtlassianInput<'updateConfluencePage'>) {
  const current = await ctx.api.getPage(ctx.signIn, input.pageId);
  const outside = await spaceRefusal(ctx, `Page ${input.pageId}`, current.spaceId);
  if (outside !== undefined) return refused(outside);
  const now = current.version ?? 0;
  if (input.version !== undefined && input.version !== now && input.version !== now + 1)
    return refused(
      `Page ${input.pageId} is at version ${now} now, not ${input.version}: it changed since you read it. Read it ` +
        'again (getConfluencePage) and write over that version.',
    );
  const title = input.title ?? current.title;
  const made = await ctx.api.updatePage(ctx.signIn, {
    pageId: input.pageId,
    title,
    body: pageBody(input.body, input.contentFormat),
    version: now + 1,
  });
  const titled = title === current.title ? [] : [{ field: 'title', old: current.title, new: title }];
  await ctx.audit({
    entityType: 'confluence_page',
    entityId: input.pageId,
    changes: [{ field: 'version', old: now, new: made.version ?? now + 1 }, ...titled],
  });
  return done({ updated: made });
}

/** Each Confluence tool. */
export const CONFLUENCE_TOOLS = {
  searchConfluenceUsingCql: search,
  getConfluencePage: getPage,
  getConfluenceSpaces: spaces,
  getPagesInConfluenceSpace: pagesIn,
  createConfluencePage: create,
  updateConfluencePage: update,
} satisfies { [T in ConfluenceTool]: (ctx: ToolContext, input: AtlassianInput<T>) => Promise<ToolReply> };
