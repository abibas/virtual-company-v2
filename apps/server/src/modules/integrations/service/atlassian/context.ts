import type { AtlassianRights } from '@mwc/shared/credentials';
import type { AtlassianApi, AtlassianSignIn, TextBody } from '@mwc/tools-core';
import { answer } from '../../rules/atlassian/render.ts';
import { inScope, outsideProjects, outsideSpaces } from '../../rules/atlassian/rights.ts';

/**
 * What one Atlassian tool call works with (S7.1c): the port, the opened sign-in, the rights, and how it records a change
 * it made (an audit row as the agent, in its turn); with the checks the tools share: an issue's project and a page's or
 * space's key against the profile's allowlists, read from Atlassian before anything is changed.
 */

/** A change a tool made, as its audit rows say it. */
export interface ToolChange {
  readonly entityType: 'jira_issue' | 'confluence_page';
  readonly entityId: string;
  readonly changes: readonly { readonly field: string; readonly old?: unknown; readonly new: unknown }[];
}

export interface ToolContext {
  readonly api: AtlassianApi;
  readonly signIn: AtlassianSignIn;
  readonly rights: AtlassianRights;
  readonly audit: (change: ToolChange) => Promise<void>;
}

/** A tool's answer: what it did or found, or why not, in words. */
export interface ToolReply {
  readonly ok: boolean;
  readonly text: string;
}

export const done = (value: unknown): ToolReply => ({ ok: true, text: answer(value) });
export const refused = (text: string): ToolReply => ({ ok: false, text });

/** What an audit row keeps of a long text: its start. */
export const excerpt = (text: string) => (text.length <= 500 ? text : `${text.slice(0, 499)}…`);

/** A Jira body in the format the call says (Markdown by default). */
export const jiraText = (text: string, format: 'markdown' | 'adf' | undefined): TextBody => ({
  format: format ?? 'markdown',
  text,
});

/** Why the issue is outside the profile's projects, or undefined (no call when they are all). */
export async function issueRefusal(ctx: ToolContext, issueIdOrKey: string): Promise<string | undefined> {
  const scope = ctx.rights.jiraProjects;
  if (scope === 'all') return undefined;
  const issue = await ctx.api.getIssue(ctx.signIn, { issueIdOrKey, fields: ['project'] });
  return inScope(scope, issue.project) ? undefined : outsideProjects(issueIdOrKey, issue.project, scope);
}

/** A space's key, read from Confluence by its id. */
export const spaceKeyOf = async (ctx: ToolContext, spaceId: string) =>
  (await ctx.api.getSpace(ctx.signIn, spaceId)).key;

/** Why the space (by its id) is outside the profile's spaces, or undefined (no call when they are all). */
export async function spaceRefusal(
  ctx: ToolContext,
  what: string,
  spaceId: string,
): Promise<string | undefined> {
  const scope = ctx.rights.confluenceSpaces;
  if (scope === 'all') return undefined;
  const key = await spaceKeyOf(ctx, spaceId);
  return inScope(scope, key) ? undefined : outsideSpaces(what, key, scope);
}
