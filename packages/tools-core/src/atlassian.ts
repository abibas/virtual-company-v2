/**
 * The Atlassian port (S7.1c, docs/subscriptions.md "Atlassian tools"): what the server asks of Jira and Confluence for
 * the agents' tools, with one opened sign-in per call, and what comes back, trimmed to what an agent needs. Bodies go
 * in and come out as Markdown (or Confluence's HTML, or Atlassian's ADF as its JSON text); the connector
 * (`@mwc/atlassian`) speaks Atlassian's REST APIs (Jira v3, Confluence v2) and their formats. Every method rejects with
 * `AtlassianError` only. Nothing here deletes or archives anything.
 */

/** A sign-in as the server opened it for one call: the site (`<name>.atlassian.net`) and basic auth's email and token. */
export interface AtlassianSignIn {
  readonly site: string;
  readonly email: string;
  readonly token: string;
}

/** How a body is written: Markdown, Confluence's HTML (its storage format) or ADF as its JSON text. */
export type BodyFormat = 'markdown' | 'html' | 'adf';

/** A body to write. */
export interface TextBody {
  readonly format: BodyFormat;
  readonly text: string;
}

/** A Jira account, as a person picker shows it. */
export interface JiraUser {
  readonly accountId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly active: boolean;
}

export interface JiraComment {
  readonly id: string;
  readonly author: string | null;
  readonly created: string | null;
  /** Markdown, from its ADF. */
  readonly body: string;
}

/** A link to another issue: how it relates (`blocks`, `is blocked by`) and the other issue. */
export interface JiraLink {
  readonly relation: string;
  readonly key: string;
  readonly summary: string | null;
  readonly status: string | null;
}

/** A small issue: a parent or a sub-task. */
export interface JiraIssueRef {
  readonly key: string;
  readonly summary: string | null;
  readonly status: string | null;
}

/**
 * An issue with the fields that were asked for: a field not asked for, or empty, is null (or empty). `extra` holds the
 * other fields asked for by name, as Jira gave them.
 */
export interface JiraIssue {
  readonly id: string;
  readonly key: string;
  readonly url: string;
  readonly project: string | null;
  readonly summary: string | null;
  readonly status: string | null;
  readonly type: string | null;
  readonly priority: string | null;
  readonly assignee: string | null;
  readonly reporter: string | null;
  readonly created: string | null;
  readonly updated: string | null;
  readonly resolution: string | null;
  readonly labels: readonly string[];
  readonly components: readonly string[];
  /** Markdown, from its ADF; null when it has none or it was not asked for. */
  readonly description: string | null;
  readonly parent: JiraIssueRef | null;
  readonly subtasks: readonly JiraIssueRef[];
  readonly links: readonly JiraLink[];
  /** The latest comments, oldest first, when they were asked for. */
  readonly comments: readonly JiraComment[];
  readonly commentsTotal: number;
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface JiraSearchPage {
  readonly issues: readonly JiraIssue[];
  readonly nextPageToken: string | null;
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  /** The status it moves to. */
  readonly to: string | null;
}

export interface JiraProject {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly type: string | null;
  /** Its issue types' names, for a create. */
  readonly issueTypes: readonly string[];
}

/** A new issue: its project, type and summary, and the few fields a create may set. */
export interface NewJiraIssue {
  readonly projectKey: string;
  readonly issueTypeName: string;
  readonly summary: string;
  readonly description?: TextBody | undefined;
  readonly labels?: readonly string[] | undefined;
  readonly priority?: string | undefined;
  readonly components?: readonly string[] | undefined;
  readonly parent?: string | undefined;
  readonly assigneeAccountId?: string | undefined;
}

/** An issue's change: its summary, description and labels only. */
export interface JiraEdit {
  readonly summary?: string | undefined;
  readonly description?: TextBody | undefined;
  readonly labels?: readonly string[] | undefined;
}

export interface CreatedIssue {
  readonly id: string;
  readonly key: string;
  readonly url: string;
}

export interface ConfluenceSpace {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly type: string | null;
  readonly url: string | null;
}

export interface ConfluencePageRef {
  readonly id: string;
  readonly title: string;
  readonly spaceId: string;
  readonly parentId: string | null;
  readonly status: string | null;
  readonly version: number | null;
  readonly updated: string | null;
  readonly url: string | null;
}

/** A page with its body as Markdown (from its ADF). */
export interface ConfluencePage extends ConfluencePageRef {
  readonly body: string;
}

/** A search hit: a page, blog post, comment or attachment, with the key of the space it is in when Confluence says. */
export interface ConfluenceHit {
  readonly id: string | null;
  readonly type: string | null;
  readonly title: string;
  readonly spaceKey: string | null;
  readonly excerpt: string | null;
  readonly url: string | null;
  readonly lastModified: string | null;
}

/** A page of results and the cursor of the next one (null: the last). */
export interface Paged<T> {
  readonly items: readonly T[];
  readonly cursor: string | null;
}

/** What the server asks of Jira and Confluence (see above). */
export interface AtlassianApi {
  searchIssues(
    signIn: AtlassianSignIn,
    query: {
      readonly jql: string;
      readonly fields: readonly string[];
      readonly maxResults: number;
      readonly nextPageToken?: string | undefined;
    },
  ): Promise<JiraSearchPage>;
  getIssue(
    signIn: AtlassianSignIn,
    query: { readonly issueIdOrKey: string; readonly fields: readonly string[] },
  ): Promise<JiraIssue>;
  getTransitions(signIn: AtlassianSignIn, issueIdOrKey: string): Promise<readonly JiraTransition[]>;
  searchProjects(
    signIn: AtlassianSignIn,
    query: { readonly query?: string | undefined; readonly maxResults: number },
  ): Promise<readonly JiraProject[]>;
  findUsers(signIn: AtlassianSignIn, query: string): Promise<readonly JiraUser[]>;
  addComment(signIn: AtlassianSignIn, issueIdOrKey: string, body: TextBody): Promise<JiraComment>;
  transitionIssue(signIn: AtlassianSignIn, issueIdOrKey: string, transitionId: string): Promise<void>;
  createIssue(signIn: AtlassianSignIn, issue: NewJiraIssue): Promise<CreatedIssue>;
  editIssue(signIn: AtlassianSignIn, issueIdOrKey: string, edit: JiraEdit): Promise<void>;
  searchConfluence(
    signIn: AtlassianSignIn,
    query: { readonly cql: string; readonly limit: number; readonly cursor?: string | undefined },
  ): Promise<Paged<ConfluenceHit>>;
  getPage(signIn: AtlassianSignIn, pageId: string): Promise<ConfluencePage>;
  getSpace(signIn: AtlassianSignIn, spaceId: string): Promise<ConfluenceSpace>;
  getSpaces(
    signIn: AtlassianSignIn,
    query: {
      readonly keys?: readonly string[] | undefined;
      readonly limit: number;
      readonly cursor?: string | undefined;
    },
  ): Promise<Paged<ConfluenceSpace>>;
  getPagesInSpace(
    signIn: AtlassianSignIn,
    spaceId: string,
    query: {
      readonly limit: number;
      readonly cursor?: string | undefined;
      readonly title?: string | undefined;
      readonly sort?: string | undefined;
    },
  ): Promise<Paged<ConfluencePageRef>>;
  createPage(
    signIn: AtlassianSignIn,
    page: {
      readonly spaceId: string;
      readonly title: string;
      readonly body: TextBody;
      readonly parentId?: string | undefined;
    },
  ): Promise<ConfluencePageRef>;
  updatePage(
    signIn: AtlassianSignIn,
    page: {
      readonly pageId: string;
      readonly title: string;
      readonly body: TextBody;
      readonly version: number;
    },
  ): Promise<ConfluencePageRef>;
}
