import type { InferRequestType, InferResponseType } from 'hono/client';
import { useCallback, useState } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { BOARD_EVERY_MS } from './flows.ts';
import { useEvery } from './notifications.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * The company's tasks across its flows (`GET /api/companies/:companyId/tasks`), for the Tasks page: the first page of
 * a filter, read again every 30 seconds while the page is visible, and the pages after it added below on request.
 */

type TaskRoutes = Api['api']['companies'][':companyId']['tasks'];
export type TaskList = InferResponseType<TaskRoutes['$get'], 200>;
export type TaskRow = TaskList['tasks'][number];
export type TaskListQuery = NonNullable<InferRequestType<TaskRoutes['$get']>['query']>;

export interface LiveTaskList extends Loaded<TaskList> {
  /** The first page's tasks, then those of the pages added with `more`, each once. */
  readonly rows: readonly TaskRow[];
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /** Adds the next page below. */
  more(): Promise<void>;
}

/** The pages after the first, for one filter. */
interface Later {
  readonly key: string;
  readonly rows: readonly TaskRow[];
  readonly next: string | null;
}

/** The company's tasks matching `query`, a page at a time. */
export function useTaskList(companyId: string, query: TaskListQuery): LiveTaskList {
  const api = useApi();
  const key = `tasks:${companyId}:${JSON.stringify(query)}`;
  const routes = api.api.companies[':companyId'].tasks;
  const loaded = useLoad(key, () => call(routes.$get({ param: { companyId }, query })));
  useEvery(BOARD_EVERY_MS, loaded.reload);
  const [later, setLater] = useState<Later>({ key, rows: [], next: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const own = later.key === key ? later : undefined;
  const next = own ? own.next : (loaded.data?.nextCursor ?? null);

  const more = useCallback(async () => {
    if (next === null) return;
    setLoadingMore(true);
    try {
      const page = await call(routes.$get({ param: { companyId }, query: { ...query, cursor: next } }));
      setLater((was) => ({
        key,
        rows: [...(was.key === key ? was.rows : []), ...page.tasks],
        next: page.nextCursor,
      }));
    } finally {
      setLoadingMore(false);
    }
  }, [routes, companyId, query, key, next]);

  const first = loaded.data?.tasks ?? [];
  const shown = new Set(first.map((task) => task.id));
  const rows = [...first, ...(own?.rows ?? []).filter((task) => !shown.has(task.id))];
  return { ...loaded, rows, hasMore: next !== null, loadingMore, more };
}
