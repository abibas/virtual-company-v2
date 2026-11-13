import type { InferResponseType } from 'hono/client';
import { useEffect, useRef } from 'react';
import { useChatActivity } from './chat-activity.ts';
import type { Api } from './client.ts';
import { useApi } from './context.ts';
import { call } from './errors.ts';
import { useEvery } from './notifications.ts';
import { type Loaded, useLoad } from './use-load.ts';

/**
 * Your direct reports' chats with you (`GET …/me/report-chats`, docs/harness.md "Your direct reports in the rail"): the
 * agents that report to you on the chart, each with its main chat with you and where it stands, read again as soon as
 * the company's chats' activity tells a change in one of those agents' chats (2026-11-13, a burst read once), when its
 * stream opens again, when the tab comes back and after a message sent from the rail; every minute while the page is
 * visible as a safety net. Only members and up read chats: a viewer's list is empty without asking.
 */

type Route = Api['api']['companies'][':companyId']['me']['report-chats']['$get'];
export type ReportChat = InferResponseType<Route, 200>['reports'][number];

/** How often the list asks again while the page is visible, whatever the activity told. */
export const REPORT_CHATS_EVERY_MS = 60_000;

/** How long a burst of the activity's messages is gathered before the list is read again. */
const BURST_MS = 300;

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
  const { reload, data } = loaded;
  const burst = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(burst.current), []);
  const soon = () => {
    clearTimeout(burst.current);
    burst.current = setTimeout(reload, BURST_MS);
  };
  useChatActivity(companyId, readsChats, {
    chat: ({ chat }) => {
      if (data?.reports.some((report) => report.agent.id === chat.agentId)) soon();
    },
    opened: soon,
  });
  return loaded;
}
