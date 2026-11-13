import type { ReactNode } from 'react';
import type { ChatCalls } from '../../../api/chats.ts';
import type { AccessProfile, AgentDetail, Chat } from '../../../api/types.ts';
import type { ChatLive } from '../../../api/use-chat-live.ts';
import { RunsMenus } from './RunsMenus.tsx';
import { overridable, profileRunsFor, runsView } from './runs-state.ts';

/**
 * The composer's Mode and Model menus for an open chat (the chat page's and the rail's docked one): only in a message
 * chat whose composer is open (not archived, an admin or owner); a change shows at once.
 */
export function chatRunsMenus({
  calls,
  live,
  chat,
  closed,
  agent,
  mine,
}: {
  readonly calls: ChatCalls;
  readonly live: ChatLive;
  readonly chat: Chat;
  /** Why the composer is closed; the menus show only while it is open. */
  readonly closed: string | undefined;
  readonly agent?: Pick<AgentDetail, 'runsWith'> | undefined;
  readonly mine?: readonly AccessProfile[] | undefined;
}): ReactNode {
  if (closed !== undefined || !overridable(chat)) return undefined;
  const view = runsView(chat, profileRunsFor(chat, live.detail.data?.profileRuns, agent, mine));
  return (
    <RunsMenus
      view={view}
      onChange={async (patch) => live.putChat(await calls.overrides(chat.id, patch))}
    />
  );
}
