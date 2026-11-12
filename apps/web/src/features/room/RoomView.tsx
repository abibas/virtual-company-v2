import { MessagesSquare } from 'lucide-react';
import type { Room, RoomMember } from '../../api/room.ts';
import type { ChartNode } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { MessageFace } from '../../components/feed/MessageAuthor.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Tooltip } from '../../components/ui/Tooltip.tsx';
import type { Reader } from '../chats/thread/authors.ts';
import { useFollow } from '../chats/thread/use-follow.ts';
import { memberAuthor, roomAuthor } from './model.ts';
import { RoomComposer } from './RoomComposer.tsx';
import { RoomItem } from './RoomItem.tsx';

/**
 * A flow's team room (docs/processes.md "The team room"): who is in it (the agents' icons, then the people's avatars),
 * its feed scrolled to the latest and following new messages while the reader is at the bottom, the agents answering
 * now, and the message box (with "@" for its agents) or the line for those who only read. The rail draws it narrow
 * (`dense`), the team's page wide; the design gallery draws it on samples.
 */

export interface RoomViewProps {
  readonly room: Room;
  /** The company's chart by principal (faces); none while it loads. */
  readonly nodes: ReadonlyMap<string, ChartNode> | undefined;
  readonly reader: Pick<Reader, 'id'> | undefined;
  /** A task's page by its key. */
  readonly taskHref?: ((key: string) => string) | undefined;
  readonly dense?: boolean;
  readonly onSend: (body: string) => Promise<void>;
}

/** The room's members as a row of faces, each named on hover. */
export function RoomFaces({
  members,
  nodes,
}: {
  readonly members: readonly RoomMember[];
  readonly nodes: ReadonlyMap<string, ChartNode> | undefined;
}) {
  return (
    <ul aria-label="In the room" className="flex min-w-0 flex-wrap items-center gap-1">
      {members.map((member) => (
        <li key={member.principalId}>
          <Tooltip label={member.name} side="bottom">
            <span className="inline-flex">
              <MessageFace author={memberAuthor(member, nodes)} dense />
            </span>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/** The agents answering now: their faces and "replying…". */
function Replying({ room, nodes }: { readonly room: Room; readonly nodes: RoomViewProps['nodes'] }) {
  const byId = new Map(room.members.agents.map((agent) => [agent.principalId, agent]));
  const agents = room.replying.flatMap((turn) => {
    const agent = byId.get(turn.principalId);
    return agent === undefined ? [] : [agent];
  });
  if (agents.length === 0) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-dim" aria-live="polite">
      {agents.map((agent) => (
        <MessageFace key={agent.principalId} author={memberAuthor(agent, nodes)} dense />
      ))}
      <span className="motion-safe:animate-pulse">
        {agents.map((agent) => agent.name).join(', ')} {agents.length === 1 ? 'is' : 'are'} replying…
      </span>
    </p>
  );
}

export function RoomView({ room, nodes, reader, taskHref, dense = false, onSend }: RoomViewProps) {
  const follow = useFollow(room.messages, false);
  const width = 'mx-auto w-full max-w-[44rem]';
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={follow.box}
        onScroll={follow.onScroll}
        className={cx(
          'scroll-quiet min-h-0 flex-1 overflow-y-auto select-text [overflow-anchor:none]',
          dense ? 'px-2 pt-3 pb-2' : 'px-4 pt-5 pb-3 md:px-8',
        )}
      >
        {room.messages.length === 0 ? (
          <EmptyState icon={MessagesSquare} tone="blue" title="No messages yet" size="sm" />
        ) : (
          <ol ref={follow.content} className={cx(width, 'grid', dense ? 'gap-4' : 'gap-5')}>
            {room.messages.map((message) => (
              <li key={message.id} className="min-w-0">
                <RoomItem
                  message={message}
                  who={roomAuthor(message.author, nodes, reader)}
                  taskHref={taskHref}
                  dense={dense}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className={cx(width, dense ? 'px-2 pb-1' : 'px-4 pb-1 md:px-8')}>
        <Replying room={room} nodes={nodes} />
      </div>
      <RoomComposer
        agents={room.members.agents}
        nodes={nodes}
        mayWrite={room.mayWrite}
        dense={dense}
        onSend={onSend}
      />
    </div>
  );
}
