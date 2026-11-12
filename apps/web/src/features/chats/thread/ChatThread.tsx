import { ArrowDown, MessagesSquare } from 'lucide-react';
import { type ReactNode, type RefObject, useMemo } from 'react';
import type { ChatTurnWithEvents } from '../../../api/types.ts';
import type { EarlierConversations as Folds } from '../../../api/use-chat-earlier.ts';
import type { ChatEarlierLive } from '../../../api/use-chat-live.ts';
import { cx } from '../../../components/cx.ts';
import { EmptyState } from '../../../components/ui/EmptyState.tsx';
import { branchState } from '../branch/branch-state.ts';
import { type ThreadAuthors, ThreadLookContext } from './authors.ts';
import { EarlierConversations } from './earlier/EarlierConversations.tsx';
import { LoadOlder } from './earlier/LoadOlder.tsx';
import { useKeepScroll } from './earlier/use-keep-scroll.ts';
import type { Answering } from './question/QuestionCard.tsx';
import { answerTurnIds } from './question/question-model.ts';
import { sentTurnIds } from './question/use-question-draft.ts';
import type { RunsOn } from './status/WorkingStatus.tsx';
import { TurnView } from './TurnView.tsx';
import { useFollow } from './use-follow.ts';

/** The thread's reading column (and the composer's): a comfortable measure that still fits code and tables. */
export const THREAD_WIDTH = 'mx-auto w-full max-w-[44rem]';

function JumpToLatest({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full bg-surface px-3.5 text-xs font-semibold text-ink-2 shadow-float ring-1 ring-line-2 ring-inset transition-colors hover:text-ink motion-safe:animate-roll-in"
    >
      <ArrowDown size={14} aria-hidden="true" />
      Jump to latest
    </button>
  );
}

/** What the thread shows above the current conversation: its older turns left out, the conversations before Clears. */
export interface ThreadHistory {
  readonly live: ChatEarlierLive;
  readonly folds: Folds;
}

/** The current conversation: from the last Clear on (a Clear made just now, until the fresh detail folds what it ended). */
function currentOf(turns: readonly ChatTurnWithEvents[]) {
  const from = turns.findLastIndex((turn) => turn.kind === 'clear');
  return from > 0 ? turns.slice(from) : turns;
}

/**
 * The chat's turns as a thread (S5.1c, S5.2), scrolled to the latest on open and following the live output while the
 * person is at the bottom (`useFollow`). Scrolling up to read stops the following and shows "Jump to latest". Above
 * the current conversation: a bar for each conversation before a Clear (folded), and "Load older messages" while older
 * turns of the current one are left out, which keeps the reader's place as they go in.
 */
export interface ChatThreadProps {
  readonly turns: readonly ChatTurnWithEvents[];
  readonly agentName: string;
  /** Who writes here: the agent's face on its replies, each prompt's writer (`useThreadAuthors`). */
  readonly authors: ThreadAuthors;
  readonly chatInit: RunsOn | undefined;
  /** How the person answers the agent's questions (S5.2 step 4). */
  readonly answering: Answering | undefined;
  readonly history: ThreadHistory;
  /** Branch under the replies (admins and owners): the chat's harness and what a branch does; none hides it. */
  readonly branching?: Branching | undefined;
  /** A line at the thread's top (a branch's "Branched from"). */
  readonly lead?: ReactNode;
  /** Narrow (the right rail's docked chat): tighter margins. */
  readonly dense?: boolean;
}

/** How the replies branch: the chat's harness (how far it forks) and the action on a turn. */
export interface Branching {
  readonly harness: 'claude_code' | 'codex';
  readonly onBranch: (turnId: string) => Promise<void>;
}

/** Above the current conversation: the folded conversations before Clears, then "Load older messages" when due. */
function Above({
  history,
  root,
  onLoadOlder,
  agentName,
}: {
  readonly history: ThreadHistory;
  readonly root: RefObject<HTMLDivElement | null>;
  readonly onLoadOlder: () => void;
  readonly agentName: string;
}) {
  const { live, folds } = history;
  return (
    <>
      <EarlierConversations conversations={live.conversations} earlier={folds} agentName={agentName} />
      {live.more && (
        <LoadOlder
          root={root}
          left={live.left}
          loading={live.loading}
          failed={live.error !== undefined}
          onLoad={onLoadOlder}
        />
      )}
    </>
  );
}

/** A turn's Branch: its state in the thread and what it does, when the thread branches. */
function branchFor(
  branching: Branching | undefined,
  current: readonly ChatTurnWithEvents[],
  turn: ChatTurnWithEvents,
) {
  if (branching === undefined) return undefined;
  return {
    state: branchState(branching.harness, current, turn),
    onBranch: () => branching.onBranch(turn.id),
  };
}

export function ChatThread({
  turns,
  agentName,
  authors,
  chatInit,
  answering,
  history,
  branching,
  lead,
  dense = false,
}: ChatThreadProps) {
  const current = currentOf(turns);
  const streaming = current.some((turn) => turn.status === 'running');
  const answers = new Set([...answerTurnIds(current), ...sentTurnIds()]);
  const follow = useFollow(current, streaming);
  const hold = useKeepScroll(follow.box, follow.content, current[0]?.id);
  const loadOlder = () => {
    hold();
    void history.live.loadOlder();
  };
  const empty = current.length === 0 && history.live.conversations.length === 0;
  const look = useMemo(() => ({ authors, dense }), [authors, dense]);
  return (
    <ThreadLookContext value={look}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={follow.box}
          onScroll={follow.onScroll}
          aria-busy={streaming || undefined}
          className={cx(
            'scroll-quiet min-h-0 flex-1 overflow-y-auto select-text [overflow-anchor:none]',
            dense ? 'px-2 pt-4 pb-3' : 'px-4 pt-6 pb-4 md:px-8',
          )}
        >
          {lead && <div className={cx(THREAD_WIDTH, 'mb-6')}>{lead}</div>}
          {empty ? (
            <EmptyState icon={MessagesSquare} tone="blue" title="No messages yet" size="sm">
              Write to {agentName} below. It answers from its folder on its machine, with its own tools.
            </EmptyState>
          ) : (
            <div className={cx(THREAD_WIDTH, 'grid', dense ? 'gap-6' : 'gap-8')}>
              <Above history={history} root={follow.box} onLoadOlder={loadOlder} agentName={agentName} />
              <ol ref={follow.content} className={cx('grid', dense ? 'gap-6' : 'gap-8')}>
                {current.map((turn, index) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    agentName={agentName}
                    chatInit={chatInit}
                    place={{
                      last: index === current.length - 1,
                      answer: answers.has(turn.id),
                      answering,
                      branch: branchFor(branching, current, turn),
                    }}
                  />
                ))}
              </ol>
            </div>
          )}
        </div>
        {follow.away && <JumpToLatest onClick={follow.jump} />}
      </div>
    </ThreadLookContext>
  );
}
