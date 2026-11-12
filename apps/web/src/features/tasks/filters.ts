import type { TaskListQuery } from '../../api/tasks.ts';

/**
 * The Tasks page's filters, kept in the address (`?state=done&flow=<id>&who=me&q=login`) so a link opens the same list
 * and Back goes to the one before: the state (Open, the default: queued, active and escalated), the flow, who has it
 * (`me`, or a principal id) and a search on the key and the title.
 */

export type StateFilter = 'open' | 'done' | 'cancelled' | 'all';

export interface TaskFilters {
  readonly state: StateFilter;
  /** A flow's id; empty for every flow. */
  readonly flow: string;
  /** `me`, a principal id, or empty for anyone. */
  readonly who: string;
  readonly q: string;
}

const STATES: readonly StateFilter[] = ['open', 'done', 'cancelled', 'all'];

/** The filters an address's query names; anything unknown is the default. */
export function filtersOf(search: URLSearchParams): TaskFilters {
  const state = search.get('state');
  return {
    state: STATES.find((one) => one === state) ?? 'open',
    flow: search.get('flow') ?? '',
    who: search.get('who') ?? '',
    q: search.get('q') ?? '',
  };
}

/** The address's query for these filters, leaving the defaults out (`?` and the rest, or nothing). */
export function searchOf(filters: TaskFilters): string {
  const params = new URLSearchParams();
  if (filters.state !== 'open') params.set('state', filters.state);
  if (filters.flow) params.set('flow', filters.flow);
  if (filters.who) params.set('who', filters.who);
  if (filters.q.trim()) params.set('q', filters.q);
  const text = params.toString();
  return text ? `?${text}` : '';
}

const API_STATES: Readonly<Record<StateFilter, string | undefined>> = {
  open: 'queued,active,escalated',
  done: 'done',
  cancelled: 'cancelled',
  all: undefined,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id the API takes; a mistyped address's is left out. */
const idOf = (text: string | undefined): string | undefined => (text && UUID.test(text) ? text : undefined);

/** How many tasks a page reads. */
export const TASKS_PAGE = 50;

/** The list API's query for these filters, the latest activity first; `me` is the viewer's principal. */
export function queryOf(filters: TaskFilters, me: string | undefined): TaskListQuery {
  const state = API_STATES[filters.state];
  const assignee = idOf(filters.who === 'me' ? me : filters.who);
  const flowId = idOf(filters.flow);
  const q = filters.q.trim();
  return {
    sort: 'updated',
    limit: String(TASKS_PAGE),
    ...(state ? { state } : {}),
    ...(flowId ? { flowId } : {}),
    ...(assignee ? { assignee } : {}),
    ...(q ? { q } : {}),
  };
}
