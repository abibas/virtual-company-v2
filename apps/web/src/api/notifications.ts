import type { InferResponseType } from 'hono/client';
import { useCallback, useEffect, useState } from 'react';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * The signed-in person's notifications in one company (S2.9, `/api/companies/:companyId/notifications`): their newest
 * page, refreshed every minute while the page is visible, with the unread count; marking them read; their email
 * setting. The types are inferred from the server's routes.
 */

type Routes = Api['api']['companies'][':companyId']['notifications'];
export type NotificationList = InferResponseType<Routes['$get'], 200>;
export type Notification = NotificationList['notifications'][number];
export type NotificationSettings = InferResponseType<Routes['settings']['$get'], 200>;

/** How often the bell asks again while the page is visible. */
export const NOTIFICATIONS_EVERY_MS = 60_000;

export interface LiveNotifications extends Loaded<NotificationList> {
  /** Marks these read (or all), and shows the answer's count at once. */
  markRead(ids: readonly string[] | 'all'): Promise<void>;
  /** The next older page, added below; nothing when there is none. */
  more(): Promise<void>;
  /** Older pages loaded with `more`, below the newest page. */
  readonly older: readonly Notification[];
  /** There are older ones than those shown. */
  readonly hasMore: boolean;
}

const routesOf = (api: Api) => api.api.companies[':companyId'].notifications;

/** Reloads every `ms` while the document is visible, and at once when it becomes visible again. */
export function useEvery(ms: number, reload: () => void) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, ms);
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ms, reload]);
}

export function useNotifications(companyId: string): LiveNotifications {
  const api = useApi();
  const loaded = useLoad(`notifications:${companyId}`, () =>
    call(routesOf(api).$get({ param: { companyId }, query: {} })),
  );
  const [older, setOlder] = useState<readonly Notification[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const { reload } = loaded;
  useEvery(NOTIFICATIONS_EVERY_MS, reload);
  // A fresh first page starts the older pages over.
  useEffect(() => {
    setOlder([]);
    setNext(loaded.data?.nextBefore ?? null);
  }, [loaded.data]);

  const markRead = useCallback(
    async (ids: readonly string[] | 'all') => {
      const json = ids === 'all' ? { all: true as const } : { ids: [...ids] };
      await call(routesOf(api).read.$post({ param: { companyId }, json }));
      reload();
    },
    [api, companyId, reload],
  );

  const more = useCallback(async () => {
    if (next === null) return;
    const page = await call(routesOf(api).$get({ param: { companyId }, query: { before: next } }));
    setOlder((was) => [...was, ...page.notifications]);
    setNext(page.nextBefore);
  }, [api, companyId, next]);

  return { ...loaded, markRead, more, older, hasMore: next !== null };
}

/** The person's notification settings here, and a save that answers the new ones. */
export function useNotificationSettings(companyId: string) {
  const api = useApi();
  const loaded = useLoad(`notification-settings:${companyId}`, () =>
    call(routesOf(api).settings.$get({ param: { companyId } })),
  );
  const [saved, setSaved] = useState<NotificationSettings>();
  const save = useCallback(
    async (email: boolean) =>
      setSaved(await call(routesOf(api).settings.$put({ param: { companyId }, json: { email } }))),
    [api, companyId],
  );
  return { settings: saved ?? loaded.data, error: loaded.error, save };
}
