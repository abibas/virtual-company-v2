import type { InferResponseType } from 'hono/client';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { useEvery } from './notifications.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * Your direct reports' chats with you (`GET …/me/report-chats`, docs/harness.md "Your direct reports in the rail"): the
 * agents that report to you on the chart, each with its main chat with you and where it stands, read again every 15
 * seconds while the page is visible, when the tab comes back and after a message sent from the rail. Only members and
 * up read chats: a viewer's list is empty without asking.
 */

type Route = Api['api']['companies'][':companyId']['me']['report-chats']['$get'];
export type ReportChat = InferResponseType<Route, 200>['reports'][number];

/** How often the list asks again while the page is visible. */
export const REPORT_CHATS_EVERY_MS = 15_000;

const NONE: { readonly reports: readonly ReportChat[] } = { reports: [] };

export function useReportChats(
  companyId: string,
  readsChats: boolean,
): Loaded<{ readonly reports: readonly ReportChat[] }> {
  const api = useApi();
  const loaded = useLoad(`report-chats:${companyId}:${readsChats}`, () =>
    readsChats
      ? call(api.api.companies[':companyId'].me['report-chats'].$get({ param: { companyId } }))
      : Promise.resolve(NONE),
  );
  useEvery(REPORT_CHATS_EVERY_MS, loaded.reload);
  return loaded;
}
