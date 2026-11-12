import { MessagesSquare } from 'lucide-react';
import { PublicConfigContext } from '../../../api/config.ts';
import type { PublicConfig } from '../../../api/types.ts';
import type { ChatEarlierLive } from '../../../api/use-chat-live.ts';
import { Composer } from '../../../features/chats/Composer.tsx';
import { HEADER_CONTROL } from '../../../features/chats/header/ChatBar.tsx';
import { OpenInClaudeCode } from '../../../features/chats/header/OpenInClaudeCode.tsx';
import { replierOf, threadAuthors } from '../../../features/chats/thread/authors.ts';
import { ChatThread } from '../../../features/chats/thread/ChatThread.tsx';
import type { RoundSpan, TaskConversation } from '../../../features/flows/conversations/model.ts';
import { ThreadFrame } from '../../../features/flows/conversations/ThreadFrame.tsx';
import { SAMPLE_NODES } from '../org-sample.ts';
import { SAMPLE_COMPANY, SAMPLE_SESSION } from '../records.ts';
import { sampleChat, sampleCwd, sampleTurns } from './conversation-sample.ts';

/** Nothing before the sample turns: no older page, no conversation before a Clear. */
export const NO_EARLIER: ChatEarlierLive = {
  conversations: [],
  more: false,
  left: 0,
  loading: false,
  error: undefined,
  loadOlder: async () => undefined,
};

/** The server's configuration as the composer reads it (no dictation on the samples). */
export const SAMPLE_CONFIG: PublicConfig = {
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
  const authors = threadAuthors({
    agent: replierOf(conversation.agent, SAMPLE_NODES),
    nodes: SAMPLE_NODES,
    reader: SAMPLE_SESSION.user,
  });
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
      <ThreadFrame conversation={conversation} span={span} nodes={SAMPLE_NODES} controls={controls}>
        <ChatThread
          turns={turns}
          agentName={conversation.agent?.name ?? 'the agent'}
          authors={authors}
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
