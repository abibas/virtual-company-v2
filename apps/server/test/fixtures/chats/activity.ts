/**
 * The chats' activity tests' reader (2026-11-13): `GET …/chat-activity` opened as a person through the app, its `chat`
 * messages as `{chat, lastTurn}`, and a wait for one that matches.
 */
import type { App } from '@mwc/testkit';
import type { ChatActivityView } from '../../../src/modules/chats/schemas/activity.ts';
import type { Person } from '../platform/auth.ts';
import { type OpenStream, openStream } from './stream.ts';

export const activityPath = (companyId: string) => `/api/companies/${companyId}/chat-activity`;

export interface OpenActivity extends OpenStream {
  /** The `chat` messages so far, in order. */
  chats(): ChatActivityView[];
  /** Waits for a `chat` message that matches (2 s at most); returns the first one. */
  next(what: string, match: (view: ChatActivityView) => boolean): Promise<ChatActivityView>;
}

/** Opens the company's chats' activity as `person`; `close` it after the test. */
export async function openActivity(app: App, companyId: string, person: Person): Promise<OpenActivity> {
  const stream = await openStream(app, activityPath(companyId), {
    authorization: `Bearer fake:${person.subject}`,
  });
  const chats = () =>
    stream.messages.filter((m) => m.event === 'chat').map((m) => m.data as ChatActivityView);
  return {
    ...stream,
    chats,
    async next(what, match) {
      await stream.until(what, () => chats().some(match));
      return chats().find(match) as ChatActivityView;
    },
  };
}

/** A view's chat and its latest turn's status, in short. */
export const brief = (view: ChatActivityView) =>
  `${view.chat.title ?? '-'}: ${view.lastTurn?.status ?? 'none'}`;
