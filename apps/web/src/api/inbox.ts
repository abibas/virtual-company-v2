import type { InferResponseType } from 'hono/client';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { useEvery } from './notifications.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * The signed-in person's inbox across their companies (S6b, `GET /api/me/inbox`): what needs them now, the most urgent
 * first, read again every 30 seconds while the page is visible, when the tab comes back, and after a move made from it.
 * The types are inferred from the server's routes.
 */

type Routes = Api['api']['me']['inbox'];
export type MyInbox = InferResponseType<Routes['$get'], 200>;
export type InboxItem = MyInbox['items'][number];
export type InboxKind = InboxItem['kind'];

/** How often the inbox asks again while the page is visible. */
export const INBOX_EVERY_MS = 30_000;

export function useInbox(): Loaded<MyInbox> {
  const api = useApi();
  const loaded = useLoad('inbox:me', () => call(api.api.me.inbox.$get()));
  useEvery(INBOX_EVERY_MS, loaded.reload);
  return loaded;
}
