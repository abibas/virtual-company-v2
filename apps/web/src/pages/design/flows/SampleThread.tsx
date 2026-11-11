import { MessagesSquare } from 'lucide-react';
import { PublicConfigContext } from '../../../api/config.ts';
import type { PublicConfig } from '../../../api/types.ts';
import type { ChatEarlierLive } from '../../../api/use-chat-live.ts';
import { nodesById } from '../../../components/org/chart.ts';
import { Composer } from '../../../features/chats/Composer.tsx';
import { HEADER_CONTROL } from '../../../features/chats/header/ChatBar.tsx';
import { OpenInClaudeCode } from '../../../features/chats/header/OpenInClaudeCode.tsx';
import { ChatThread } from '../../../features/chats/thread/ChatThread.tsx';
import type { RoundSpan, TaskConversation } from '../../../features/flows/conversations/model.ts';
import { ThreadFrame } from '../../../features/flows/conversations/ThreadFrame.tsx';
import { SAMPLE_CHART } from '../org-sample.ts';
import { SAMPLE_COMPANY } from '../records.ts';
import { sampleChat, sampleCwd, sampleTurns } from './conversation-sample.ts';

const NODES = nodesById(SAMPLE_CHART.nodes);

/** Nothing before the sample turns: no older page, no conversation before a Clear. */
const NO_EARLIER: ChatEarlierLive = {
  conversations: [],
  more: false,
  left: 0,
  loading: false,
  error: undefined,
  loadOlder: async () => undefined,
};

/** The server's configuration as the composer reads it (no dictation on the samples). */
const SAMPLE_CONFIG: PublicConfig = {
  identity: 'none',
  webOrigin: 'http://localhost:9951',
  apiUrl: 'http://localhost:9950',
  publicUrl: null,
  localPower: false,
  speech: false,
  composeFile: null,
};

const refuse = () => Promise.reject(new Error('Sample data: nothing is sent here'));

/** A task conversation's thread on the samples, in the page's frame, with a composer that sends nothing. */
function SampleThread({
  conversation,
  span,
}: {
  readonly conversation: TaskConversation;
  readonly span: RoundSpan | undefined;
}) {
  const turns = sampleTurns(conversation.chatId);
  const controls = (
    <>
      <a href="#chat" className={HEADER_CONTROL}>
        <MessagesSquare size={13} aria-hidden="true" />
        Open as chat
      </a>
      <OpenInClaudeCode
        companyId={SAMPLE_COMPANY.id}
        chat={sampleChat(conversation)}
        placement={undefined}
        sessionCwd={sampleCwd(conversation)}
      />
    </>
  );
  return (
    <PublicConfigContext value={SAMPLE_CONFIG}>
      <ThreadFrame conversation={conversation} span={span} nodes={NODES} controls={controls}>
        <ChatThread
          turns={turns}
          agentName={conversation.agent?.name ?? 'the agent'}
          chatInit={{ model: 'claude-opus-5-5', effort: 'high' }}
          answering={undefined}
          history={{ live: NO_EARLIER, folds: { loaded: new Map(), load: () => undefined } }}
        />
        <Composer
          running={turns.some((turn) => turn.status === 'running')}
          choices={undefined}
          disabled={undefined}
          placeholder="Reply in this conversation"
          onSend={refuse}
          onStop={refuse}
        />
      </ThreadFrame>
    </PublicConfigContext>
  );
}

/** The gallery's `TaskRuns.thread`. */
export const sampleThread = (conversation: TaskConversation, span: RoundSpan | undefined) => (
  <SampleThread key={conversation.chatId} conversation={conversation} span={span} />
);
