/**
 * The inbox (S6b), as `GET /api/companies/:companyId/inbox` and `GET /api/me/inbox` (and their `/count`) answer it, for
 * `mwc inbox`. The shapes mirror the server's schemas (`apps/server/src/modules/inbox/schemas.ts`) without importing the
 * server; only what the command reads is checked.
 */
import { type ApiResult, apiGet, type Fetch, isObject } from './client.ts';
import type { PrincipalRef } from './tasks.ts';

/** One thing that needs the caller: a task at their step or stuck in a team they lead, or an agent's question. */
export interface InboxItem {
  readonly id: string;
  readonly kind: string;
  readonly company: { readonly id: string; readonly slug: string; readonly name: string };
  readonly title: string;
  readonly subtitle: string;
  readonly reason: string | null;
  readonly from: PrincipalRef | null;
  readonly link: string;
  readonly actions: readonly string[];
  readonly task: { readonly key: string; readonly priority: string } | null;
  readonly at: string;
}

/** A company's count beside its name. */
export interface InboxCompanyCount {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly count: number;
}

export interface Inbox {
  readonly items: readonly InboxItem[];
  readonly count: number;
  /** Across the caller's companies only (`--all`). */
  readonly companies?: readonly InboxCompanyCount[];
}

export interface InboxCount {
  readonly count: number;
  readonly companies?: readonly InboxCompanyCount[];
}

const isItem = (value: unknown): value is InboxItem =>
  isObject(value) &&
  typeof value.kind === 'string' &&
  typeof value.title === 'string' &&
  isObject(value.company) &&
  Array.isArray(value.actions);

const isInbox = (value: unknown): value is Inbox =>
  isObject(value) &&
  typeof value.count === 'number' &&
  Array.isArray(value.items) &&
  value.items.every(isItem);

const isCount = (value: unknown): value is InboxCount => isObject(value) && typeof value.count === 'number';

/** The inbox's path: the company's, or across the caller's companies (`all`). */
const path = (companyId: string, all: boolean, rest = '') =>
  all ? `/api/me/inbox${rest}` : `/api/companies/${encodeURIComponent(companyId)}/inbox${rest}`;

/** `GET …/inbox`: what needs the caller, the most urgent first. */
export const getInbox = (
  fetch: Fetch,
  server: string,
  key: string,
  scope: { readonly companyId: string; readonly all: boolean },
): Promise<ApiResult<Inbox>> => apiGet(fetch, server, key, path(scope.companyId, scope.all), isInbox);

/** `GET …/inbox/count`: how many items need the caller. */
export const getInboxCount = (
  fetch: Fetch,
  server: string,
  key: string,
  scope: { readonly companyId: string; readonly all: boolean },
): Promise<ApiResult<InboxCount>> =>
  apiGet(fetch, server, key, path(scope.companyId, scope.all, '/count'), isCount);
