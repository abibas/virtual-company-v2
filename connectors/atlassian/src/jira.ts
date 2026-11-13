import type {
  AtlassianApi,
  AtlassianSignIn,
  JiraProject,
  JiraTransition,
  JiraUser,
  NewJiraIssue,
} from '@mwc/tools-core';
import { jiraBody } from './body.ts';
import type { Call, Request } from './http.ts';
import { addedCommentOf, issueOf, nameOf } from './jira-issue.ts';

/**
 * Jira Cloud's REST API v3 for the port (S7.1c): search with JQL (`POST /rest/api/3/search/jql`, its page token), an
 * issue, its transitions, the projects the account sees, people by name or email, and the changes: a comment, a
 * transition, a new issue and an issue's summary, description and labels. No call here deletes or archives anything.
 */

/** The latest comments an issue keeps for an agent. */
export const COMMENTS_MAX = 10;

/** The most people a lookup lists. */
export const USERS_MAX = 20;

type Raw = Readonly<Record<string, unknown>>;
const recordOf = (value: unknown): Raw => (typeof value === 'object' && value !== null ? (value as Raw) : {});
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const issuePath = (issueIdOrKey: string, rest = '') =>
  `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}${rest}`;

function transitionOf(value: unknown): JiraTransition {
  const raw = recordOf(value);
  return { id: text(raw.id), name: text(raw.name), to: nameOf(raw.to) };
}

function projectOf(value: unknown): JiraProject {
  const raw = recordOf(value);
  return {
    id: text(raw.id),
    key: text(raw.key),
    name: text(raw.name),
    type: typeof raw.projectTypeKey === 'string' ? raw.projectTypeKey : null,
    issueTypes: listOf(raw.issueTypes)
      .map(nameOf)
      .filter((name): name is string => name !== null),
  };
}

function userOf(value: unknown): JiraUser {
  const raw = recordOf(value);
  return {
    accountId: text(raw.accountId),
    displayName: text(raw.displayName),
    email: typeof raw.emailAddress === 'string' ? raw.emailAddress : null,
    active: raw.active !== false,
  };
}

type JiraApi = Pick<
  AtlassianApi,
  | 'searchIssues'
  | 'getIssue'
  | 'getTransitions'
  | 'searchProjects'
  | 'findUsers'
  | 'addComment'
  | 'transitionIssue'
  | 'createIssue'
  | 'editIssue'
>;

type Jira = (signIn: AtlassianSignIn, call: Omit<Call, 'product'>) => Promise<unknown>;

/** Jira's reads: search, an issue, its transitions, projects, people. */
function jiraReads(
  jira: Jira,
): Omit<JiraApi, 'addComment' | 'transitionIssue' | 'createIssue' | 'editIssue'> {
  return {
    async searchIssues(signIn, query) {
      const body = {
        jql: query.jql,
        fields: query.fields,
        maxResults: query.maxResults,
        ...(query.nextPageToken === undefined ? {} : { nextPageToken: query.nextPageToken }),
      };
      const raw = recordOf(await jira(signIn, { method: 'POST', path: '/rest/api/3/search/jql', body }));
      const token = raw.nextPageToken;
      return {
        issues: listOf(raw.issues).map((issue) => issueOf(issue, signIn.site, COMMENTS_MAX)),
        nextPageToken: typeof token === 'string' && raw.isLast !== true ? token : null,
      };
    },
    async getIssue(signIn, query) {
      const fields = query.fields.join(',');
      const raw = await jira(signIn, {
        method: 'GET',
        path: issuePath(query.issueIdOrKey),
        query: { fields },
      });
      return issueOf(raw, signIn.site, COMMENTS_MAX);
    },
    async getTransitions(signIn, issueIdOrKey) {
      const raw = recordOf(
        await jira(signIn, { method: 'GET', path: issuePath(issueIdOrKey, '/transitions') }),
      );
      return listOf(raw.transitions).map(transitionOf);
    },
    async searchProjects(signIn, query) {
      const raw = recordOf(
        await jira(signIn, {
          method: 'GET',
          path: '/rest/api/3/project/search',
          query: { query: query.query, maxResults: query.maxResults, expand: 'issueTypes' },
        }),
      );
      return listOf(raw.values).map(projectOf);
    },
    async findUsers(signIn, query) {
      const raw = await jira(signIn, {
        method: 'GET',
        path: '/rest/api/3/user/search',
        query: { query, maxResults: USERS_MAX },
      });
      return listOf(raw).map(userOf);
    },
  };
}

/** The issue's fields a create sets, those given. */
function createFields(issue: NewJiraIssue) {
  return {
    project: { key: issue.projectKey },
    issuetype: { name: issue.issueTypeName },
    summary: issue.summary,
    ...(issue.description === undefined ? {} : { description: jiraBody(issue.description) }),
    ...(issue.labels === undefined ? {} : { labels: issue.labels }),
    ...(issue.priority === undefined ? {} : { priority: { name: issue.priority } }),
    ...(issue.components === undefined ? {} : { components: issue.components.map((name) => ({ name })) }),
    ...(issue.parent === undefined ? {} : { parent: { key: issue.parent } }),
    ...(issue.assigneeAccountId === undefined ? {} : { assignee: { accountId: issue.assigneeAccountId } }),
  };
}

/** Jira's changes: a comment, a transition, a new issue, an issue's summary, description and labels. */
function jiraChanges(
  jira: Jira,
): Pick<JiraApi, 'addComment' | 'transitionIssue' | 'createIssue' | 'editIssue'> {
  return {
    async addComment(signIn, issueIdOrKey, body) {
      const path = issuePath(issueIdOrKey, '/comment');
      return addedCommentOf(await jira(signIn, { method: 'POST', path, body: { body: jiraBody(body) } }));
    },
    async transitionIssue(signIn, issueIdOrKey, transitionId) {
      const path = issuePath(issueIdOrKey, '/transitions');
      await jira(signIn, { method: 'POST', path, body: { transition: { id: transitionId } } });
    },
    async createIssue(signIn, issue) {
      const body = { fields: createFields(issue) };
      const raw = recordOf(await jira(signIn, { method: 'POST', path: '/rest/api/3/issue', body }));
      const key = text(raw.key);
      return { id: text(raw.id), key, url: `https://${signIn.site}/browse/${key}` };
    },
    async editIssue(signIn, issueIdOrKey, edit) {
      const fields = {
        ...(edit.summary === undefined ? {} : { summary: edit.summary }),
        ...(edit.description === undefined ? {} : { description: jiraBody(edit.description) }),
        ...(edit.labels === undefined ? {} : { labels: edit.labels }),
      };
      await jira(signIn, { method: 'PUT', path: issuePath(issueIdOrKey), body: { fields } });
    },
  };
}

/** The Jira half of the port on `request`. */
export function jiraApi(request: Request): JiraApi {
  const jira: Jira = (signIn, call) => request(signIn, { product: 'Jira', ...call });
  return { ...jiraReads(jira), ...jiraChanges(jira) };
}
