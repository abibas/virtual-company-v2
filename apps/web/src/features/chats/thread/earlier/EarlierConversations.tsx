import type { ChatConversation } from '../../../../api/types.ts';
import type { EarlierConversations as Loaded } from '../../../../api/use-chat-earlier.ts';
import { ConversationFold } from './ConversationFold.tsx';

/**
 * The conversations before each Clear, one folded bar each above the current conversation, the newest nearest it.
 * A conversation without a turn shows no bar.
 */
export function EarlierConversations({
  conversations,
  earlier,
  agentName,
}: {
  /** Newest first, as the chat's detail lists them. */
  readonly conversations: readonly ChatConversation[];
  readonly earlier: Loaded;
  readonly agentName: string;
}) {
  const shown = conversations
    .map((conversation, index) => ({ conversation, afterSeq: conversations[index + 1]?.clearSeq ?? 0 }))
    .filter(({ conversation }) => conversation.turns > 0)
    .reverse();
  if (shown.length === 0) return null;
  return (
    <ol aria-label="Earlier conversations" className="grid gap-2">
      {shown.map(({ conversation, afterSeq }) => (
        <ConversationFold
          key={conversation.clearTurnId}
          conversation={conversation}
          turns={earlier.loaded.get(conversation.clearTurnId)}
          onLoad={() => earlier.load(conversation, afterSeq)}
          agentName={agentName}
        />
      ))}
    </ol>
  );
}
