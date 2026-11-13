import { scopedQuery } from '../../rules/atlassian/query.ts';
import { issueView } from '../../rules/atlassian/render.ts';
import { inScope, outsideProjects } from '../../rules/atlassian/rights.ts';
import type { AtlassianInput, JIRA_CHANGE_TOOLS, JIRA_READ_TOOLS } from '../../schemas/atlassian.ts';
import {
  done,
  excerpt,
  issueRefusal,
  jiraText,
  refused,
  type ToolContext,
  type ToolReply,
} from './context.ts';

/**
 * The Jira tools (S7.1c): each checks the profile's projects before it answers or changes anything: a search is scoped
 * with `project in (…)` and what comes back outside it is dropped; an issue's project is read first; a create names its
 * project. Each change is audited as the agent. Nothing deletes or archives.
 */

/** The fields a search and an issue give when none are asked for (the remote MCP's, and an issue's links). */
export const SEARCH_FIELDS = [
  'summary',
  'description',
  'status',
  'issuetype',
  'priority',
  'labels',
  'components',
  'assignee',
  'reporter',
  'created',
  'updated',
  'resolution',
  'project',
];
export const ISSUE_FIELDS = [...SEARCH_FIELDS, 'parent', 'subtasks', 'issuelinks', 'comment'];

/** The results a search gives when not told. */
export const SEARCH_MAX = 25;

/** The fields asked for, with `project` always (the scope is checked on it). */
const withProject = (fields: readonly string[] | undefined, fallback: readonly string[]) => {
  const asked = fields === undefined || fields.length === 0 ? fallback : fields;
  return asked.includes('project') || asked.includes('*all') ? [...asked] : [...asked, 'project'];
};

type JiraTool = (typeof JIRA_READ_TOOLS)[number] | (typeof JIRA_CHANGE_TOOLS)[number];

async function search(ctx: ToolContext, input: AtlassianInput<'searchJiraIssuesUsingJql'>) {
  const scope = ctx.rights.jiraProjects;
  const jql = scopedQuery(input.jql, 'project', scope, 'JQL');
  if (!jql.ok) return refused(jql.error);
  const page = await ctx.api.searchIssues(ctx.signIn, {
    jql: jql.query,
    fields: withProject(input.fields, SEARCH_FIELDS),
    maxResults: input.maxResults ?? SEARCH_MAX,
    nextPageToken: input.nextPageToken,
  });
  const issues = page.issues.filter((issue) => inScope(scope, issue.project));
  return done({
    jql: jql.query,
    issues: issues.map((issue) => issueView(issue, true)),
    ...(page.nextPageToken === null ? {} : { nextPageToken: page.nextPageToken }),
  });
}

async function getIssue(ctx: ToolContext, input: AtlassianInput<'getJiraIssue'>) {
  const scope = ctx.rights.jiraProjects;
  const issue = await ctx.api.getIssue(ctx.signIn, {
    issueIdOrKey: input.issueIdOrKey,
    fields: withProject(input.fields, ISSUE_FIELDS),
  });
  if (!inScope(scope, issue.project))
    return refused(outsideProjects(input.issueIdOrKey, issue.project, scope as string[]));
  return done(issueView(issue));
}

async function transitions(ctx: ToolContext, input: AtlassianInput<'getTransitionsForJiraIssue'>) {
  const outside = await issueRefusal(ctx, input.issueIdOrKey);
  if (outside !== undefined) return refused(outside);
  return done({ transitions: await ctx.api.getTransitions(ctx.signIn, input.issueIdOrKey) });
}

async function projects(ctx: ToolContext, input: AtlassianInput<'getVisibleJiraProjects'>) {
  const found = await ctx.api.searchProjects(ctx.signIn, {
    query: input.searchString,
    maxResults: input.maxResults ?? 50,
  });
  return done({ projects: found.filter((project) => inScope(ctx.rights.jiraProjects, project.key)) });
}

async function users(ctx: ToolContext, input: AtlassianInput<'lookupJiraAccountId'>) {
  return done({ users: await ctx.api.findUsers(ctx.signIn, input.searchString) });
}

async function comment(ctx: ToolContext, input: AtlassianInput<'addCommentToJiraIssue'>) {
  const outside = await issueRefusal(ctx, input.issueIdOrKey);
  if (outside !== undefined) return refused(outside);
  const added = await ctx.api.addComment(
    ctx.signIn,
    input.issueIdOrKey,
    jiraText(input.commentBody, input.contentFormat),
  );
  await ctx.audit({
    entityType: 'jira_issue',
    entityId: input.issueIdOrKey,
    changes: [{ field: 'comment', new: { id: added.id, text: excerpt(input.commentBody) } }],
  });
  return done({ commented: input.issueIdOrKey, comment: { id: added.id, created: added.created } });
}

async function transition(ctx: ToolContext, input: AtlassianInput<'transitionJiraIssue'>) {
  const outside = await issueRefusal(ctx, input.issueIdOrKey);
  if (outside !== undefined) return refused(outside);
  await ctx.api.transitionIssue(ctx.signIn, input.issueIdOrKey, input.transition.id);
  const changes = [{ field: 'transition', new: input.transition.id }];
  await ctx.audit({ entityType: 'jira_issue', entityId: input.issueIdOrKey, changes });
  return done({ transitioned: input.issueIdOrKey, transition: input.transition.id });
}

async function create(ctx: ToolContext, input: AtlassianInput<'createJiraIssue'>) {
  const scope = ctx.rights.jiraProjects;
  if (!inScope(scope, input.projectKey))
    return refused(outsideProjects('The new issue', input.projectKey, scope as string[]));
  const extra = input.additional_fields;
  const made = await ctx.api.createIssue(ctx.signIn, {
    projectKey: input.projectKey,
    issueTypeName: input.issueTypeName,
    summary: input.summary,
    description: input.description ? jiraText(input.description, input.contentFormat) : undefined,
    parent: input.parent,
    assigneeAccountId: input.assignee_account_id,
    labels: extra?.labels,
    priority: extra?.priority?.name,
    components: extra?.components?.map((component) => component.name),
  });
  await ctx.audit({
    entityType: 'jira_issue',
    entityId: made.key,
    changes: [
      { field: 'project', new: input.projectKey },
      { field: 'issueType', new: input.issueTypeName },
      { field: 'summary', new: input.summary },
    ],
  });
  return done({ created: made });
}

async function edit(ctx: ToolContext, input: AtlassianInput<'editJiraIssue'>) {
  const outside = await issueRefusal(ctx, input.issueIdOrKey);
  if (outside !== undefined) return refused(outside);
  const { summary, description, labels } = input.fields;
  await ctx.api.editIssue(ctx.signIn, input.issueIdOrKey, {
    summary,
    labels,
    description: description === undefined ? undefined : jiraText(description, input.contentFormat),
  });
  const changes = [
    ...(summary === undefined ? [] : [{ field: 'summary', new: summary }]),
    ...(description === undefined ? [] : [{ field: 'description', new: excerpt(description) }]),
    ...(labels === undefined ? [] : [{ field: 'labels', new: labels }]),
  ];
  await ctx.audit({ entityType: 'jira_issue', entityId: input.issueIdOrKey, changes });
  return done({ edited: input.issueIdOrKey, fields: Object.keys(input.fields) });
}

/** Each Jira tool. */
export const JIRA_TOOLS = {
  searchJiraIssuesUsingJql: search,
  getJiraIssue: getIssue,
  getTransitionsForJiraIssue: transitions,
  getVisibleJiraProjects: projects,
  lookupJiraAccountId: users,
  addCommentToJiraIssue: comment,
  transitionJiraIssue: transition,
  createJiraIssue: create,
  editJiraIssue: edit,
} satisfies { [T in JiraTool]: (ctx: ToolContext, input: AtlassianInput<T>) => Promise<ToolReply> };
