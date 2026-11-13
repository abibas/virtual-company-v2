import type { JiraComment, JiraIssue, JiraIssueRef, JiraLink } from '@mwc/tools-core';
import { adfToMarkdown } from './adf/to-markdown.ts';

/**
 * A Jira v3 issue as the port gives it (S7.1c): the usual fields by name (status, type, priority and resolution by
 * their names, people by their display names), the description and comments as Markdown, its parent, sub-tasks and
 * links in short, and the other fields that came, as Jira gave them (`extra`). An issue's answer is trusted for nothing
 * but these: a field of the wrong shape reads as empty.
 */

type Raw = Readonly<Record<string, unknown>>;

const recordOf = (value: unknown): Raw | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Raw) : undefined;

const textOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A named thing's name (`status.name`), a person's display name, a plain string as it is. */
export function nameOf(value: unknown): string | null {
  if (typeof value === 'string') return textOf(value);
  const record = recordOf(value);
  return textOf(record?.name) ?? textOf(record?.displayName) ?? textOf(record?.value) ?? textOf(record?.key);
}

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** The fields the port reads by name; any other that came goes to `extra`. */
const KNOWN = new Set([
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'created',
  'updated',
  'resolution',
  'labels',
  'components',
  'description',
  'project',
  'parent',
  'subtasks',
  'issuelinks',
  'comment',
]);

/** A small issue (a parent, a sub-task, a linked one). */
function refOf(value: unknown): JiraIssueRef | null {
  const record = recordOf(value);
  const key = textOf(record?.key);
  if (record === undefined || key === null) return null;
  const fields = recordOf(record.fields);
  return { key, summary: textOf(fields?.summary), status: nameOf(fields?.status) };
}

function linkOf(value: unknown): JiraLink | null {
  const record = recordOf(value);
  const type = recordOf(record?.type);
  const outward = refOf(record?.outwardIssue);
  const other = outward ?? refOf(record?.inwardIssue);
  if (other === null) return null;
  const relation = textOf(outward ? type?.outward : type?.inward) ?? nameOf(type) ?? 'relates to';
  return { relation, ...other };
}

function commentOf(value: unknown): JiraComment | null {
  const record = recordOf(value);
  const id = textOf(record?.id);
  if (record === undefined || id === null) return null;
  return {
    id,
    author: nameOf(record.author),
    created: textOf(record.created),
    body: adfToMarkdown(record.body),
  };
}

const present = <T>(items: readonly (T | null)[]): T[] => items.filter((item): item is T => item !== null);

/** Its comments, the latest `max` of them, oldest first, and how many it has. */
function commentsOf(value: unknown, max: number): { comments: JiraComment[]; total: number } {
  const record = recordOf(value);
  const all = present(listOf(record?.comments).map(commentOf));
  const total = typeof record?.total === 'number' ? record.total : all.length;
  return { comments: all.slice(-max), total };
}

/** The other fields that came, with a value. */
function extraOf(fields: Raw): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields))
    if (!KNOWN.has(name) && value !== null && value !== undefined) extra[name] = value;
  return extra;
}

/** An issue as the port gives it; `site` makes its address; `commentsMax` the latest comments kept. */
export function issueOf(raw: unknown, site: string, commentsMax: number): JiraIssue {
  const record = recordOf(raw) ?? {};
  const fields = recordOf(record.fields) ?? {};
  const key = textOf(record.key) ?? '';
  const { comments, total } = commentsOf(fields.comment, commentsMax);
  const description = fields.description === undefined ? null : adfToMarkdown(fields.description);
  return {
    id: textOf(record.id) ?? '',
    key,
    url: `https://${site}/browse/${key}`,
    project: textOf(recordOf(fields.project)?.key),
    summary: textOf(fields.summary),
    status: nameOf(fields.status),
    type: nameOf(fields.issuetype),
    priority: nameOf(fields.priority),
    assignee: nameOf(fields.assignee),
    reporter: nameOf(fields.reporter),
    created: textOf(fields.created),
    updated: textOf(fields.updated),
    resolution: nameOf(fields.resolution),
    labels: listOf(fields.labels).filter((label): label is string => typeof label === 'string'),
    components: present(listOf(fields.components).map(nameOf)),
    description: description === '' ? null : description,
    parent: refOf(fields.parent),
    subtasks: present(listOf(fields.subtasks).map(refOf)),
    links: present(listOf(fields.issuelinks).map(linkOf)),
    comments,
    commentsTotal: total,
    extra: extraOf(fields),
  };
}

/** A comment Jira answered with, as the port gives it. */
export const addedCommentOf = (raw: unknown): JiraComment =>
  commentOf(raw) ?? { id: '', author: null, created: null, body: '' };
