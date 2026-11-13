import { CONFLUENCE_SPACE_PATTERN, JIRA_PROJECT_PATTERN } from '@mwc/shared/credentials';
import { z } from 'zod';

/**
 * The Atlassian tools' names and inputs (S7.1c, docs/subscriptions.md "Atlassian tools"): Atlassian's remote MCP's names
 * and input shapes, so an agent's habits and skills carry over. `cloudId` is taken and ignored (the profile names the
 * site); other arguments of the remote MCP's that change nothing here (`actionSource`, `responseContentFormat`, …) are
 * dropped. What would change something that is not offered (updating a comment, moving a page) is refused by name
 * (`REFUSED_ARGUMENTS`). The server checks every call's input with these schemas; the runner only relays them.
 */

export const JIRA_READ_TOOLS = [
  'searchJiraIssuesUsingJql',
  'getJiraIssue',
  'getTransitionsForJiraIssue',
  'getVisibleJiraProjects',
  'lookupJiraAccountId',
] as const;
export const JIRA_CHANGE_TOOLS = [
  'addCommentToJiraIssue',
  'transitionJiraIssue',
  'createJiraIssue',
  'editJiraIssue',
] as const;
export const CONFLUENCE_READ_TOOLS = [
  'searchConfluenceUsingCql',
  'getConfluencePage',
  'getConfluenceSpaces',
  'getPagesInConfluenceSpace',
] as const;
export const CONFLUENCE_WRITE_TOOLS = ['createConfluencePage', 'updateConfluencePage'] as const;

export const AtlassianTool = z.enum([
  ...JIRA_READ_TOOLS,
  ...JIRA_CHANGE_TOOLS,
  ...CONFLUENCE_READ_TOOLS,
  ...CONFLUENCE_WRITE_TOOLS,
]);
export type AtlassianTool = z.infer<typeof AtlassianTool>;

/** The longest body a tool writes (a comment, a description, a page): what the runner's socket carries. */
export const BODY_MAX = 50_000;

const cloudId = z.string().max(200).optional().describe('Not needed: the site of your profile is used');
const text = (max: number, description: string) => z.string().trim().min(1).max(max).describe(description);

const IssueIdOrKey = z
  .string()
  .trim()
  .regex(/^(?:[A-Za-z][A-Za-z0-9_]*-\d+|\d+)$/, 'an issue key such as AP-301, or an issue id')
  .transform((key) => key.toUpperCase())
  .describe('Issue key (e.g. AP-301) or id');
const ProjectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(JIRA_PROJECT_PATTERN, 'a project key such as AP')
  .describe('Project key');
const NumericId = (what: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,20}$/, `a ${what} id, its digits`)
    .describe(`The ${what}'s id`);
const Fields = z.array(z.string().trim().min(1).max(100)).max(50);
const Cursor = z
  .string()
  .max(2000)
  .optional()
  .describe('The cursor of the next page, from the previous answer');
const SpaceKeys = z
  .union([z.string().max(2000), z.array(z.string().max(100)).max(100)])
  .optional()
  .describe('Space keys, a list or comma-separated');
const JiraFormat = z
  .enum(['markdown', 'adf'])
  .optional()
  .describe('markdown (the default) or adf (a JSON document)');
const PageFormat = z
  .enum(['html', 'markdown', 'adf'])
  .optional()
  .describe('html (Confluence storage format, the default), markdown, or adf (a JSON document)');
const Label = z
  .string()
  .trim()
  .regex(/^\S{1,255}$/, 'a label is one word');
const Named = z.strictObject({ name: z.string().trim().min(1).max(255) });

/** Each tool's input. */
export const ATLASSIAN_INPUTS = {
  searchJiraIssuesUsingJql: z.object({
    cloudId,
    jql: text(10_000, 'JQL query'),
    fields: Fields.optional().describe(
      'Issue fields to return; default: summary, description, status, issuetype, priority, labels, components, ' +
        'assignee, reporter, created, updated, resolution, project. Include "comment" for the latest comments.',
    ),
    maxResults: z.int().min(1).max(100).optional().describe('How many, 1 to 100 (25 by default)'),
    nextPageToken: Cursor,
  }),
  getJiraIssue: z.object({
    cloudId,
    issueIdOrKey: IssueIdOrKey,
    fields: Fields.optional().describe(
      'Issue fields to return; by default the usual ones with comments and links',
    ),
    expand: z.string().max(200).optional().describe('Accepted and not needed'),
  }),
  getTransitionsForJiraIssue: z.object({ cloudId, issueIdOrKey: IssueIdOrKey }),
  getVisibleJiraProjects: z.object({
    cloudId,
    searchString: z.string().trim().max(200).optional().describe('Part of a project’s key or name'),
    maxResults: z.int().min(1).max(50).optional(),
  }),
  lookupJiraAccountId: z.object({ cloudId, searchString: text(200, 'A name or an email') }),
  addCommentToJiraIssue: z.object({
    cloudId,
    issueIdOrKey: IssueIdOrKey,
    commentBody: text(BODY_MAX, 'The comment'),
    contentFormat: JiraFormat,
  }),
  transitionJiraIssue: z.object({
    cloudId,
    issueIdOrKey: IssueIdOrKey,
    transition: z.object({
      id: z
        .string()
        .trim()
        .regex(/^\d{1,20}$/, 'a transition id'),
    }),
  }),
  createJiraIssue: z.object({
    cloudId,
    projectKey: ProjectKey,
    issueTypeName: text(100, 'Type (Task, Bug, Story)'),
    summary: text(255, 'The summary'),
    description: z.string().trim().max(BODY_MAX).optional().describe('The description'),
    contentFormat: JiraFormat,
    parent: IssueIdOrKey.optional().describe('A parent, for a sub-task'),
    assignee_account_id: z.string().trim().min(1).max(128).optional().describe('Assignee account id'),
    additional_fields: z
      .strictObject({
        labels: z.array(Label).max(50).optional(),
        priority: Named.optional(),
        components: z.array(Named).max(20).optional(),
      })
      .optional()
      .describe('Only labels, priority ({name}) and components ([{name}])'),
  }),
  editJiraIssue: z.object({
    cloudId,
    issueIdOrKey: IssueIdOrKey,
    fields: z
      .strictObject({
        summary: text(255, 'The summary').optional(),
        description: z.string().trim().max(BODY_MAX).optional(),
        labels: z.array(Label).max(50).optional(),
      })
      .refine((fields) => Object.keys(fields).length > 0, 'set summary, description or labels')
      .describe('summary, description and labels only'),
    contentFormat: JiraFormat,
  }),
  searchConfluenceUsingCql: z.object({
    cloudId,
    cql: text(10_000, 'CQL query (space keys, not names)'),
    limit: z.int().min(1).max(100).optional().describe('How many, 1 to 100 (25 by default)'),
    cursor: Cursor,
  }),
  getConfluencePage: z.object({ cloudId, pageId: NumericId('page') }),
  getConfluenceSpaces: z.object({
    cloudId,
    keys: SpaceKeys,
    limit: z.int().min(1).max(250).optional(),
    cursor: Cursor,
  }),
  getPagesInConfluenceSpace: z.object({
    cloudId,
    spaceId: NumericId('space'),
    limit: z.int().min(1).max(250).optional(),
    cursor: Cursor,
    title: z.string().trim().max(255).optional(),
    sort: z
      .enum([
        'id',
        '-id',
        'created-date',
        '-created-date',
        'modified-date',
        '-modified-date',
        'title',
        '-title',
      ])
      .optional(),
  }),
  createConfluencePage: z.object({
    cloudId,
    spaceId: z
      .string()
      .trim()
      .regex(/^(?:\d{1,20}|~?[A-Za-z0-9][A-Za-z0-9_:-]{0,99})$/, 'a space id or key')
      .describe('The space’s id, or its key'),
    title: text(255, 'The title'),
    body: text(BODY_MAX, 'The body'),
    parentId: NumericId('parent page').optional(),
    contentFormat: PageFormat,
    contentType: z.literal('page').optional(),
  }),
  updateConfluencePage: z.object({
    cloudId,
    pageId: NumericId('page'),
    title: text(255, 'A new title').optional(),
    body: text(BODY_MAX, 'The whole new body'),
    version: z
      .int()
      .min(1)
      .optional()
      .describe('The version you read (getConfluencePage); refused when the page changed since'),
    contentFormat: PageFormat,
    versionMessage: z.string().max(500).optional(),
  }),
} as const satisfies Record<AtlassianTool, z.ZodType>;

export type AtlassianInput<T extends AtlassianTool> = z.output<(typeof ATLASSIAN_INPUTS)[T]>;

/** Arguments of the remote MCP's that would do something not offered here, and why each is refused. */
export const REFUSED_ARGUMENTS: Partial<Record<AtlassianTool, Readonly<Record<string, string>>>> = {
  addCommentToJiraIssue: {
    commentId: 'Updating a comment is not offered: leave out commentId to add a new one.',
  },
  transitionJiraIssue: {
    fields: 'transitionJiraIssue only moves the issue: set fields with editJiraIssue.',
    update: 'transitionJiraIssue only moves the issue: set fields with editJiraIssue.',
  },
  createJiraIssue: { transition: 'Create the issue, then move it with transitionJiraIssue.' },
  updateConfluencePage: {
    spaceId: 'Moving a page to another space is not offered.',
    parentId: 'Moving a page under another parent is not offered.',
  },
};

/** A space key as the rights hold it: the pattern the profile's form takes. */
export const isSpaceKey = (key: string) => CONFLUENCE_SPACE_PATTERN.test(key);
